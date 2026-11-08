// Real credential signing and key derivation; synthetic ledger and host only.
import assert from 'node:assert/strict';
import test from 'node:test';
import { sha256 } from '@noble/hashes/sha2.js';
import { webauthnPasskey } from '../packages/adapter-webauthn/dist/index.js';
import { createPassportAccounts } from '../packages/account/dist/index.js';
import { createFakePorts } from '../packages/account/dist/testing/index.js';
import { withLoginSession } from '../packages/account/dist/with-login-session.js';
import {
  prfSalt,
  PRF_LABEL_ROOT,
  recipeDeviceKeyring,
  seedFromRoot,
} from '../packages/keys/dist/index.js';
import { pureCircuits } from '../packages/contract/generated/acc-s3r1.1/index.js';
import { softwareAuthenticator, ID, RP, ORIGIN } from './fixtures/software-authenticator.mjs';

/** @typedef {import('../packages/adapter-webauthn/dist/index.js').PasskeyLoginKeys} LoginKeys */
/** @typedef {import('../packages/account/dist/ports/index.js').PassportPorts} PassportPorts */
/** @param {ReturnType<typeof softwareAuthenticator>['container']} container */
function adapterFor(container) {
  const adapter = webauthnPasskey({ rpId: RP, origin: ORIGIN, credentials: container });
  const login = adapter.credentials.withLoginSession?.bind(adapter.credentials);
  assert.ok(login);
  return { ...adapter, login };
}

test('login handoff exposes only fresh root-derived wallet seed copies for the selected credential', async () => {
  const auth = softwareAuthenticator();
  const adapter = adapterFor(auth.container);
  assert.throws(() => adapter.readLoginKeys(ID), { code: 'NotAuthorised' });
  await adapter.login(async () => {
    assert.throws(() => adapter.readLoginKeys(ID), { code: 'NotAuthorised' });
    const identity = await adapter.credentials.identify();
    assert.throws(() => adapter.readLoginKeys(undefined), { code: 'NotAuthorised' });
    assert.throws(() => adapter.readLoginKeys(Uint8Array.of(9)), { code: 'NotAuthorised' });
    const keys = adapter.readLoginKeys(identity.credentialId);
    assert.deepEqual(Object.keys(keys), ['deriveWalletSeed']);
    assert.equal(Object.isFrozen(keys), true);
    const first = keys.deriveWalletSeed();
    const second = keys.deriveWalletSeed();
    const expected = seedFromRoot(sha256(prfSalt(PRF_LABEL_ROOT)));
    try {
      assert.equal(first.length, 64);
      assert.deepEqual(first, expected);
      first.fill(0);
      assert.deepEqual(second, expected, 'returned buffers are independently owned');
      assert.equal(auth.gets.length, 1, 'derivation makes no additional browser call');
    } finally {
      first.fill(0);
      second.fill(0);
      expected.fill(0);
    }
  });
  assert.throws(() => adapter.readLoginKeys(ID), { code: 'NotAuthorised' });
});

test('retained handoff getters refuse after scope end and during a later login', async () => {
  const auth = softwareAuthenticator();
  const adapter = adapterFor(auth.container);
  /** @type {LoginKeys | undefined} */
  let previous;
  await adapter.login(async () => {
    await adapter.credentials.identify();
    previous = adapter.readLoginKeys(ID);
  });
  assert.ok(previous);
  assert.throws(() => previous?.deriveWalletSeed(), { code: 'NotAuthorised' });
  await adapter.login(async () => {
    await adapter.credentials.identify();
    assert.throws(() => previous?.deriveWalletSeed(), { code: 'NotAuthorised' });
    adapter.readLoginKeys(ID).deriveWalletSeed().fill(0);
  });
  assert.equal(auth.gets.length, 2);
});

test('mutating the caller credential buffer cannot change the handoff binding', async () => {
  const auth = softwareAuthenticator();
  const adapter = adapterFor(auth.container);
  await adapter.login(async () => {
    const identity = await adapter.credentials.identify();
    const selected = identity.credentialId.slice();
    const keys = adapter.readLoginKeys(selected);
    selected.fill(0);
    keys.deriveWalletSeed().fill(0);
    identity.credentialId.fill(0);
    assert.throws(() => adapter.readLoginKeys(identity.credentialId), { code: 'NotAuthorised' });
    keys.deriveWalletSeed().fill(0);
  });
  assert.equal(auth.gets.length, 1);
});

async function activeAccount() {
  const auth = softwareAuthenticator();
  const fake = createFakePorts({ binding: { pureCircuits } });
  /** @param {ReturnType<typeof adapterFor>} adapter @returns {PassportPorts} */
  const ports = (adapter) => ({
    ...fake,
    credentials: adapter.credentials,
    authoriser: adapter.p256,
    viewingKey: recipeDeviceKeyring(adapter.prf),
  });
  const created = await createPassportAccounts(ports(adapterFor(auth.container))).createAccount({
    userName: 'synthetic-login-handoff',
    retireAuthority: true,
  });
  const ledger = fake.ledger.get(created.address);
  assert.ok(ledger);
  ledger.specVersion = 3;
  return { auth, fake, ports, created, ledger };
}

test('verified core login invokes its handoff before scope disposal with exactly one browser request', async () => {
  const { auth, ports, created, ledger } = await activeAccount();
  const adapter = adapterFor(auth.container);
  let calls = 0;
  /** @type {LoginKeys | undefined} */
  let retained;
  const api = createPassportAccounts({
    ...ports(adapter),
    async onAccountOpened(account) {
      calls++;
      assert.equal(account.address, created.address);
      retained = adapter.readLoginKeys(account.credentialId);
      await Promise.resolve();
      retained.deriveWalletSeed().fill(0);
    },
  });
  const before = auth.gets.length;
  await api.openAccount();
  assert.equal(calls, 1);
  assert.equal(auth.gets.length, before + 1);
  assert.throws(() => retained?.deriveWalletSeed(), { code: 'NotAuthorised' });
  assert.ok(api.openAccountAt);
  await api.openAccountAt(created.address);
  assert.equal(calls, 2);
  assert.equal(auth.gets.length, before + 2);
  assert.equal(ledger.entries.size, 1, 'routine handoff never enrolls a companion owner');
});

test('failed verification never invokes the account-opened hook or exposes login keys', async () => {
  const { auth, ports, ledger } = await activeAccount();
  const adapter = adapterFor(auth.container);
  let calls = 0;
  ledger.entries.clear();
  const api = createPassportAccounts({
    ...ports(adapter),
    async onAccountOpened() {
      calls++;
    },
  });
  await assert.rejects(api.openAccount(), { code: 'AccountNotFound' });
  assert.equal(calls, 0);
  assert.throws(() => adapter.readLoginKeys(ID), { code: 'NotAuthorised' });
});

test('a failing host handoff rejects open and always disposes the native login scope', async () => {
  const { auth, ports } = await activeAccount();
  const adapter = adapterFor(auth.container);
  /** @type {LoginKeys | undefined} */
  let retained;
  const api = createPassportAccounts({
    ...ports(adapter),
    async onAccountOpened(account) {
      retained = adapter.readLoginKeys(account.credentialId);
      throw new Error('Host refused this handoff');
    },
  });
  const before = auth.gets.length;
  await assert.rejects(api.openAccount(), /Host refused this handoff/);
  assert.equal(auth.gets.length, before + 1, 'failure never triggers another PRF request');
  assert.throws(() => retained?.deriveWalletSeed(), { code: 'NotAuthorised' });
});

test('the neutral hook works with a legacy credential port without inventing a PRF scope', async () => {
  const fake = createFakePorts();
  const api = createPassportAccounts(fake);
  const created = await api.createAccount({ userName: 'legacy', retireAuthority: true });
  let calls = 0;
  const wrapped = withLoginSession(
    fake.credentials,
    {
      ...api,
      createAccount: async () => created,
    },
    async (account) => {
      calls++;
      assert.equal(account.address, created.address);
    },
  );
  await wrapped.openAccount();
  assert.equal(calls, 1);
  await wrapped.createAccount({ userName: 'another', retireAuthority: true });
  assert.equal(calls, 1, 'creation does not run a successful-login hook');
});

/** @returns {{wait: Promise<void>; release: () => void}} */
function deferred() {
  /** @type {() => void} */
  let release = () => {};
  const wait = new Promise((resolve) => {
    release = () => resolve(undefined);
  });
  return { wait, release };
}

for (const pending of /** @type {const} */ (['create', 'identify'])) {
  test(`in-flight legacy ${pending} refuses a reverse-overlapping login and another selector`, async () => {
    const auth = softwareAuthenticator();
    const gate = deferred();
    const entered = deferred();
    const container = {
      ...auth.container,
      async create(/** @type {Parameters<typeof auth.container.create>[0]} */ request) {
        if (pending === 'create') {
          entered.release();
          await gate.wait;
        }
        return auth.container.create(request);
      },
      async get(/** @type {Parameters<typeof auth.container.get>[0]} */ request) {
        if (pending === 'identify') {
          entered.release();
          await gate.wait;
        }
        return auth.container.get(request);
      },
    };
    const adapter = adapterFor(container);
    const selecting =
      pending === 'create'
        ? adapter.credentials.create({ name: 'synthetic-selector-race' })
        : adapter.credentials.identify();
    await entered.wait;
    await assert.rejects(
      adapter.login(async () => adapter.credentials.identify()),
      {
        code: 'NotAuthorised',
      },
    );
    await assert.rejects(adapter.credentials.create({ name: 'overlap' }), {
      code: 'NotAuthorised',
    });
    await assert.rejects(adapter.credentials.identify(), { code: 'NotAuthorised' });
    gate.release();
    await selecting;
    await adapter.login(async () => {
      await adapter.credentials.identify();
      adapter.readLoginKeys(ID).deriveWalletSeed().fill(0);
    });
    assert.equal(
      auth.gets.length,
      2,
      'one original assertion and one later login, no overlap access',
    );
    assert.equal(auth.creates.length, pending === 'create' ? 1 : 0);
  });
}
