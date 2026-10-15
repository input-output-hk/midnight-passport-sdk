import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createPassportAccounts } from '../packages/account/dist/index.js';
import { createFakePorts } from '../packages/account/dist/testing/index.js';
import { recipeDeviceKeyring } from '../packages/keys/dist/index.js';
import { pureCircuits } from '../packages/contract/generated/acc-s3r1.1/index.js';

const viewingKey = () =>
  recipeDeviceKeyring({
    withSession: (operation) => operation(),
    deriveSecret: async () => new Uint8Array(32).fill(9),
    deviceSecret: async () => new Uint8Array(32).fill(9),
  });

test('P-256 create publishes sealed key entries and reload opens the ledger key', async () => {
  const fake = createFakePorts({ binding: { pureCircuits } });
  const ports = { ...fake, viewingKey: viewingKey() };
  const created = await createPassportAccounts(ports).createAccount({
    userName: 'sealed',
    retireAuthority: true,
  });
  const ledger = fake.ledger.get(created.address);
  assert.ok(ledger);
  assert.deepEqual(
    ledger.inboxEntries.map((entry) => entry[0]),
    [0xd1, 0xd5],
  );
  assert.equal(ledger.authNonce, 2n);
  assert.notDeepEqual(ledger.encKey, await fake.encryptionKey.publicKey('undeployed'));
  const hint = [...fake.directory.hints.values()][0];
  assert.equal(hint?.status, 'active');
  assert.deepEqual(hint.keyEntries, ledger.inboxEntries);

  const reopened = await createPassportAccounts({
    ...ports,
    viewingKey: viewingKey(),
  }).openAccount();
  assert.equal(reopened.address, created.address);
  ledger.inboxEntries.shift();
  await assert.rejects(createPassportAccounts(ports).openAccount(), {
    code: 'EncryptionKeyMismatch',
  });
});

test('P-256 open resumes an interrupted sealed-entry publication', async () => {
  const fake = createFakePorts();
  let interrupted = false;
  const chain = {
    ...fake.chain,
    async call(
      /** @type {import('../packages/account/dist/ports/index.js').CallRequest} */ request,
    ) {
      if (request.circuit === 'append_inbox_with_p256' && !interrupted) {
        interrupted = true;
        throw new Error('publication interrupted');
      }
      return fake.chain.call(request);
    },
  };
  const ports = { ...fake, chain, viewingKey: viewingKey() };
  await assert.rejects(
    createPassportAccounts(ports).createAccount({ userName: 'resume', retireAuthority: true }),
    /publication interrupted/,
  );
  const hint = [...fake.directory.hints.values()][0];
  assert.equal(hint?.status, 'deployed');
  const opened = await createPassportAccounts(ports).openAccount();
  const ledger = fake.ledger.get(opened.address);
  assert.ok(ledger);
  assert.equal(ledger.inboxEntries.length, 2);
  assert.equal(ledger.authNonce, 2n);
  assert.equal([...fake.directory.hints.values()][0]?.status, 'active');
  await assert.rejects(opened.rotateEncryptionKey(new Uint8Array(32)), {
    code: 'BindingUnsupported',
    message: /roster-safe viewing-key rotation/,
  });
});

test('P-256 sealed create rejects incomplete key delivery before deployment', async () => {
  const fake = createFakePorts();
  const keyring = viewingKey();
  const ports = {
    ...fake,
    viewingKey: {
      ...keyring,
      createKeys: async (
        /** @type {string} */ networkId,
        /** @type {import('../packages/account/dist/ports/index.js').CreateAccountKeys} */ request,
      ) => {
        const keys = await keyring.createKeys(networkId, request);
        return { ...keys, registrations: [] };
      },
    },
  };
  await assert.rejects(
    createPassportAccounts(ports).createAccount({ userName: 'broken', retireAuthority: true }),
    /one envelope and one registration/,
  );
  assert.equal(fake.ledger.size, 0);
});

test('sealed P-256 adapter refuses a deterministic-key prototype account explicitly', async () => {
  const fake = createFakePorts();
  await createPassportAccounts(fake).createAccount({ userName: 'legacy', retireAuthority: true });
  await assert.rejects(
    createPassportAccounts({ ...fake, viewingKey: viewingKey() }).openAccount(),
    {
      code: 'BindingUnsupported',
      message: /legacy adapter or migrate/,
    },
  );
});
