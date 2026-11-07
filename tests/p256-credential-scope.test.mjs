// Actual SDK/WebAuthn/keyring crypto over synthetic credentials and chain. No provider/native claim.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createPassportAccounts } from '../packages/account/dist/index.js';
import { createFakePorts } from '../packages/account/dist/testing/index.js';
import { webauthnPasskey } from '../packages/adapter-webauthn/dist/index.js';
import { recipeDeviceKeyring } from '../packages/keys/dist/index.js';
import { pureCircuits } from '../packages/contract/generated/acc-s3r1.1/index.js';
import { softwareAuthenticator, ORIGIN, RP } from './fixtures/software-authenticator.mjs';

/** @param {ReturnType<typeof softwareAuthenticator>['container']} container */
function adapter(container) {
  /** @type {string[]} */ const purposes = [];
  return {
    ...webauthnPasskey({
      rpId: RP,
      origin: ORIGIN,
      credentials: container,
      beforeCeremony: ({ purpose }) => {
        purposes.push(purpose);
      },
    }),
    purposes,
  };
}

/** @param {ReturnType<typeof createFakePorts>} fake @param {ReturnType<typeof adapter>} selected */
const ports = (fake, selected) => ({
  ...fake,
  credentials: selected.credentials,
  authoriser: selected.p256,
  viewingKey: recipeDeviceKeyring(selected.prf),
});

/** @param {'enabled'|'results'} [atCreate] */
async function created(atCreate = 'results') {
  const auth = softwareAuthenticator({ atCreate });
  const fake = createFakePorts({ binding: { pureCircuits } });
  const selected = adapter(auth.container);
  const account = await createPassportAccounts(ports(fake, selected)).createAccount({
    userName: 'credential-scope',
    retireAuthority: true,
  });
  const ledger = fake.ledger.get(account.address);
  assert.ok(ledger);
  ledger.specVersion = 3;
  return { auth, fake, selected, account, ledger };
}

for (const atCreate of /** @type {const} */ (['results', 'enabled'])) {
  test(`P-256 creation reuses one PRF scope (${atCreate}) without skipping strict signatures`, async () => {
    const { auth, selected, fake } = await created(atCreate);
    assert.equal(auth.creates.length, 1);
    assert.equal(auth.gets.length, atCreate === 'results' ? 3 : 4);
    assert.equal(selected.purposes.filter((v) => v === 'verify-created').length, 1);
    assert.equal(
      selected.purposes.filter((v) => v === 'derive-keys').length,
      atCreate === 'results' ? 0 : 1,
    );
    assert.equal(selected.purposes.filter((v) => v === 'sign').length, 2);
    assert.equal(fake.ledger.size, 1);
    const before = auth.gets.length;
    (await selected.prf.deviceSecret()).fill(0);
    assert.equal(auth.gets.length, before + 1, 'completion releases the operation-local PRF');
  });
}

test('cold P-256 address recovery is the first open and requires exactly one verified assertion', async () => {
  const { auth, fake, account } = await created();
  const fresh = adapter(auth.container);
  const api = createPassportAccounts(ports(fake, fresh));
  assert.ok(api.openAccountAt);
  const before = auth.gets.length;
  const opened = await api.openAccountAt(account.address);
  assert.equal(opened.address, account.address);
  assert.equal(auth.gets.length, before + 1);
  assert.deepEqual(fresh.purposes, ['identify-and-unlock']);
});

for (const invalid of [
  'signature',
  'missing-registration',
  'duplicate-registration',
  'removed-owner',
]) {
  test(`cold P-256 address recovery refuses ${invalid} without another credential request`, async () => {
    const { auth, fake, account, ledger } = await created();
    if (invalid === 'missing-registration')
      ledger.inboxEntries = ledger.inboxEntries?.filter((entry) => entry[0] !== 0xd5);
    if (invalid === 'duplicate-registration') {
      const registration = ledger.inboxEntries?.find((entry) => entry[0] === 0xd5);
      assert.ok(registration);
      ledger.inboxEntries?.push(registration.slice());
    }
    if (invalid === 'removed-owner') ledger.entries.clear();
    const container =
      invalid === 'signature'
        ? {
            ...auth.container,
            async get(/** @type {Parameters<typeof auth.container.get>[0]} */ options) {
              const credential = await auth.container.get(options);
              assert.ok(credential);
              return {
                ...credential,
                response: {
                  ...credential.response,
                  signature: Uint8Array.of(0x30, 6, 2, 1, 1, 2, 1, 1).buffer,
                },
              };
            },
          }
        : auth.container;
    const fresh = adapter(container);
    const api = createPassportAccounts(ports(fake, fresh));
    assert.ok(api.openAccountAt);
    const before = auth.gets.length;
    const effects = fake.context.log.filter(([point]) => point === 'chain.call').length;
    await assert.rejects(api.openAccountAt(account.address), {
      code: invalid === 'removed-owner' ? 'AccountNotFound' : 'NotAuthorised',
    });
    assert.equal(auth.gets.length, before + 1);
    assert.equal(fake.context.log.filter(([point]) => point === 'chain.call').length, effects);
    assert.deepEqual(fresh.purposes, ['identify-and-unlock']);
  });
}

test('P-256 creation refuses a cancelled PRF before deploying and does not retry', async () => {
  const auth = softwareAuthenticator({ atCreate: 'enabled' });
  auth.prfControl.cancelled = true;
  const fake = createFakePorts({ binding: { pureCircuits } });
  const selected = adapter(auth.container);
  await assert.rejects(
    createPassportAccounts(ports(fake, selected)).createAccount({
      userName: 'cancelled',
      retireAuthority: true,
    }),
    { code: 'UserCancelled' },
  );
  assert.equal(fake.ledger.size, 0);
  assert.equal(auth.creates.length, 1);
  assert.equal(auth.gets.length, 2, 'one strict probe and one cancelled PRF only');
});
