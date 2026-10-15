import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createPassportAccounts } from '../packages/account/dist/index.js';
import { createFakePorts } from '../packages/account/dist/testing/index.js';
import { recipeDeviceKeyring } from '../packages/keys/dist/index.js';
import { pureCircuits } from '../packages/contract/generated/acc-s3r1.1/index.js';
import { sealInboxCoin } from '../packages/keys/dist/inbox-coin.js';
import { x25519 } from '@noble/curves/ed25519.js';
import {
  fakeAuthoriser,
  fakeCredentials,
  FAKE_POLICY,
} from '../packages/account/dist/testing/index.js';

const viewingKey = (value = 9) =>
  recipeDeviceKeyring({
    withSession: (operation) => operation(),
    deriveSecret: async () => new Uint8Array(32).fill(value),
    deviceSecret: async () => new Uint8Array(32).fill(value),
  });
const hex = (/** @type {Uint8Array} */ bytes) => Buffer.from(bytes).toString('hex');

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

test('P-256 sealed accounts read only chain-confirmed shielded holdings', async () => {
  const fake = createFakePorts({ binding: { pureCircuits } });
  /** @type {number[]} */
  let held = [];
  const ports = {
    ...fake,
    viewingKey: viewingKey(),
    authoriser: {
      ...fake.authoriser,
      withKeySession: async (/** @type {() => Promise<any>} */ operation) => operation(),
    },
    holdings: { selectHeldEntries: async () => held },
  };
  const account = await createPassportAccounts(ports).createAccount({
    userName: 'holdings',
    retireAuthority: true,
  });
  assert.ok(account.readShieldedHoldings);
  const ledger = fake.ledger.get(account.address);
  assert.ok(ledger);
  ledger.specVersion = 3;
  assert.deepEqual(await account.readShieldedHoldings(), []);
  const coin = { nonce: new Uint8Array(32).fill(4), color: new Uint8Array(32).fill(5), value: 7n };
  ledger.inboxEntries.push(await sealInboxCoin(ledger.encKey, coin));
  held = [2];
  assert.deepEqual(await account.readShieldedHoldings(), [{ inboxIndex: 2, coin }]);
  held = [1];
  await assert.rejects(account.readShieldedHoldings(), { code: 'InternalError' });
  const { holdings: _holdings, ...withoutHoldingPorts } = ports;
  const withoutVerification = await createPassportAccounts(withoutHoldingPorts).openAccount();
  assert.ok(withoutVerification.readShieldedHoldings);
  await assert.rejects(withoutVerification.readShieldedHoldings(), {
    code: 'BindingUnsupported',
  });
  const selected = await ports.authoriser.devicePublicKey();
  const wrongPasskey = await createPassportAccounts({
    ...ports,
    authoriser: {
      ...ports.authoriser,
      devicePublicKey: async () => ({ x: selected.x + 1n, y: selected.y }),
    },
  }).openAccount();
  assert.ok(wrongPasskey.readShieldedHoldings);
  await assert.rejects(wrongPasskey.readShieldedHoldings(), { code: 'NotAuthorised' });
});

test('P-256 rotation reseals verified holdings and preserves the live reader', async () => {
  const fake = createFakePorts();
  /** @type {number[]} */
  let held = [];
  const ports = {
    ...fake,
    viewingKey: viewingKey(),
    authoriser: {
      ...fake.authoriser,
      withKeySession: async (/** @type {() => Promise<any>} */ operation) => operation(),
    },
    holdings: { selectHeldEntries: async () => held },
    readGrants: {
      readActiveReadGrantTargets: async () => ({
        authNonce: [...fake.ledger.values()][0]?.authNonce ?? 0n,
        targets: [],
      }),
    },
  };
  const account = await createPassportAccounts(ports).createAccount({
    userName: 'rotation',
    retireAuthority: true,
  });
  const ledger = fake.ledger.get(account.address);
  assert.ok(ledger);
  ledger.specVersion = 3;
  const originalKey = ledger.encKey.slice();
  const coin = { nonce: new Uint8Array(32).fill(4), color: new Uint8Array(32).fill(5), value: 7n };
  ledger.inboxEntries.push(await sealInboxCoin(originalKey, coin));
  held = [2];
  assert.ok(account.rotateViewingKey);
  const result = await account.rotateViewingKey();
  assert.notDeepEqual(ledger.encKey, originalKey);
  assert.deepEqual(result.droppedDeviceEntries, []);
  assert.deepEqual(result.unsealedGrantIds, []);
  assert.equal(ledger.inboxEntries.at(-2)?.[0], 0xd1);
  held = [ledger.inboxEntries.length - 1];
  assert.deepEqual(await account.readShieldedHoldings?.(), [{ inboxIndex: held[0], coin }]);
  assert.deepEqual((await createPassportAccounts(ports).openAccount()).address, account.address);
});

test('P-256 rotation refuses a live device without a unique reader registration', async () => {
  const fake = createFakePorts();
  const ports = {
    ...fake,
    viewingKey: viewingKey(),
    authoriser: {
      ...fake.authoriser,
      withKeySession: async (/** @type {() => Promise<any>} */ operation) => operation(),
    },
    holdings: { selectHeldEntries: async () => [] },
    readGrants: {
      readActiveReadGrantTargets: async () => ({
        authNonce: [...fake.ledger.values()][0]?.authNonce ?? 0n,
        targets: [],
      }),
    },
  };
  const account = await createPassportAccounts(ports).createAccount({
    userName: 'unregistered',
    retireAuthority: true,
  });
  const ledger = fake.ledger.get(account.address);
  assert.ok(ledger);
  ledger.specVersion = 3;
  ledger.entries.add('ab'.repeat(32));
  const nonce = ledger.authNonce;
  if (!account.rotateViewingKey) throw new Error('Rotation is unavailable.');
  await assert.rejects(account.rotateViewingKey(), { code: 'DeviceRosterInvalid' });
  assert.equal(ledger.authNonce, nonce);
});

for (const mode of ['all', 'one', 'one-unsealed'])
  test(`P-256 ${mode} revocation handles the read-grant roster`, async () => {
    const fake = createFakePorts();
    const grantId = 'cd'.repeat(32);
    const survivorId = 'ef'.repeat(32);
    let generation = 7n;
    let entries = [
      { id: grantId, active: true, read: true },
      { id: survivorId, active: true, read: true },
    ];
    const pure = fake.binding.pureCircuits;
    const ports = {
      ...fake,
      network: { ...fake.network, bindingId: 'acc-s3r1.1' },
      binding: {
        pureCircuits: {
          ...pure,
          challenge_revoke_all_grants_with_p256: () => new Uint8Array(32).fill(3),
          challenge_revoke_grant_with_p256: () => new Uint8Array(32).fill(4),
        },
      },
      viewingKey: viewingKey(),
      authoriser: {
        ...fake.authoriser,
        withKeySession: async (/** @type {() => Promise<any>} */ operation) => operation(),
      },
      holdings: { selectHeldEntries: async () => [] },
      readGrants: {
        readActiveReadGrantTargets: async () => ({
          authNonce: [...fake.ledger.values()][0]?.authNonce ?? 0n,
          targets: [
            { grantId, readPublicKey: hex(x25519.getPublicKey(new Uint8Array(32).fill(7))) },
            {
              grantId: survivorId,
              ...(mode !== 'one-unsealed' && {
                readPublicKey: hex(x25519.getPublicKey(new Uint8Array(32).fill(8))),
              }),
            },
          ],
        }),
      },
      grantRoster: {
        readGrantRoster: async () => ({
          authNonce: [...fake.ledger.values()][0]?.authNonce ?? 0n,
          generation,
          entries,
        }),
      },
      grantDetails: {
        /** @param {string} _account @param {string} id */
        readGrant: async (_account, id) => {
          const grant = entries.find((entry) => entry.id === id);
          return (
            grant && {
              active: grant.active,
              read: grant.read,
              authNonce: [...fake.ledger.values()][0]?.authNonce ?? 0n,
            }
          );
        },
      },
      chain: {
        ...fake.chain,
        /** @param {import('../packages/account/dist/ports/index.js').CallRequest} request */
        call: async (request) => {
          if (
            request.circuit !== 'revoke_all_grants_with_p256' &&
            request.circuit !== 'revoke_grant_with_p256'
          )
            return fake.chain.call(request);
          const ledger = fake.ledger.get(request.address);
          assert.ok(ledger);
          const pk = await fake.authoriser.devicePublicKey();
          const self = { bytes: Buffer.from(request.address, 'hex') };
          const counter = Array.from({ length: 64 }, (_, n) => BigInt(n)).find((n) =>
            ledger.entries.has(
              hex(
                pure.derive_device_entry_with_p256(
                  self,
                  { ...pk, identity: false },
                  FAKE_POLICY,
                  ledger.deviceEpoch,
                  n,
                ),
              ),
            ),
          );
          assert.ok(counter !== undefined);
          ledger.entries.delete(
            hex(
              pure.derive_device_entry_with_p256(
                self,
                { ...pk, identity: false },
                FAKE_POLICY,
                ledger.deviceEpoch,
                counter,
              ),
            ),
          );
          ledger.entries.add(
            hex(
              pure.derive_device_entry_with_p256(
                self,
                { ...pk, identity: false },
                FAKE_POLICY,
                ledger.deviceEpoch,
                counter + 1n,
              ),
            ),
          );
          ledger.authNonce++;
          if (request.circuit === 'revoke_all_grants_with_p256') {
            generation++;
            entries = [];
          } else {
            assert.equal(hex(/** @type {Uint8Array} */ (request.args[0])), grantId);
            entries = [
              { id: grantId, active: false, read: true },
              { id: survivorId, active: true, read: true },
            ];
          }
          return { txHash: 'revoke' };
        },
      },
    };
    const account = await createPassportAccounts(ports).createAccount({
      userName: 'read-revoke-all',
      retireAuthority: true,
    });
    const ledger = fake.ledger.get(account.address);
    assert.ok(ledger);
    ledger.specVersion = 3;
    const previousKey = ledger.encKey.slice();
    if (mode === 'one-unsealed') {
      if (!account.revokeGrant) throw new Error('Selective revoke is unavailable.');
      await assert.rejects(account.revokeGrant(grantId), { code: 'GrantRosterUnsettled' });
      assert.deepEqual(ledger.encKey, previousKey);
      return;
    }
    const result =
      mode === 'all' ? await account.revokeAllGrants?.() : await account.revokeGrant?.(grantId);
    assert.equal(result?.status, mode === 'all' ? 'cleared' : 'revoked');
    if (result?.status === 'cleared') assert.equal(result.generation, 8n);
    else if (result?.status === 'revoked') assert.equal(result.grantId, grantId);
    assert.ok(result.rotation);
    assert.deepEqual(
      result.rotation.sealedReadGrants.map(({ grantId: id }) => id),
      mode === 'all' ? [] : [survivorId],
    );
    assert.notDeepEqual(ledger.encKey, previousKey);
  });

test('P-256 owner delivers a sealed key before enrolling a new live device', async () => {
  const fake = createFakePorts();
  /** @type {{grantId: string; readPublicKey: string}[]} */
  let targets = [];
  const ports = {
    ...fake,
    viewingKey: viewingKey(),
    authoriser: {
      ...fake.authoriser,
      withKeySession: async (/** @type {() => Promise<any>} */ operation) => operation(),
    },
    holdings: { selectHeldEntries: async () => [] },
    readGrants: {
      readActiveReadGrantTargets: async () => ({
        authNonce: /** @type {bigint} */ ([...fake.ledger.values()][0]?.authNonce ?? 0n),
        targets,
      }),
    },
  };
  const account = await createPassportAccounts(ports).createAccount({
    userName: 'owner',
    retireAuthority: true,
  });
  const ledger = fake.ledger.get(account.address);
  assert.ok(ledger);
  ledger.specVersion = 3;
  assert.ok(account.addDevice);
  const joining = fakeAuthoriser({ device: 1 });
  const reader = {
    scheme: /** @type {const} */ ('p256-webauthn'),
    readerPublicKey: hex(x25519.getPublicKey(new Uint8Array(32).fill(7))),
    devicePublicKey: await joining.devicePublicKeyHex(),
    policy: FAKE_POLICY,
  };
  const result = await account.addDevice(reader);
  assert.equal(ledger.inboxEntries.length, 4);
  assert.deepEqual(
    ledger.inboxEntries.slice(2).map((entry) => entry[0]),
    [0xd1, 0xd5],
  );
  assert.ok(ledger.entries.has(result.commitmentHex));
  assert.equal(result.nextUseCounter, 5n);
  await assert.rejects(account.addDevice(reader), { code: 'DeviceRosterInvalid' });
  const previousKey = ledger.encKey.slice();
  await account.rotateViewingKey?.();
  assert.notDeepEqual(ledger.encKey, previousKey);
  const joiningPorts = {
    ...ports,
    authoriser: {
      ...joining,
      withKeySession: async (/** @type {() => Promise<any>} */ operation) => operation(),
    },
    credentials: fakeCredentials({ authoriser: joining }),
    viewingKey: viewingKey(7),
  };
  const joiningApi = createPassportAccounts(joiningPorts);
  if (!joiningApi.openAccountAt) throw new Error('Address-based open is unavailable.');
  assert.equal((await joiningApi.openAccountAt(account.address)).address, account.address);
  const ownerCommitment = [...ledger.entries].find((entry) => entry !== result.commitmentHex);
  assert.ok(ownerCommitment);
  if (!account.removeDevice) throw new Error('P-256 removal is unavailable.');
  await assert.rejects(account.removeDevice(ownerCommitment), { code: 'LastDevice' });
  await assert.rejects(account.removeDevice('ef'.repeat(32)), { code: 'RemovalTargetNotFound' });
  targets = [{ grantId: 'aa'.repeat(32), readPublicKey: reader.readerPublicKey }];
  const beforeBlocked = ledger.encKey.slice();
  await assert.rejects(account.removeDevice(result.commitmentHex), { code: 'DeviceRosterInvalid' });
  assert.deepEqual(ledger.encKey, beforeBlocked);
  targets = [];
  const beforeRemoval = ledger.encKey.slice();
  const removed = await account.removeDevice(result.commitmentHex);
  assert.equal(removed.removedCommitmentHex, result.commitmentHex);
  assert.ok(removed.rotationTxHash);
  assert.notDeepEqual(ledger.encKey, beforeRemoval);
  assert.equal(ledger.entries.has(result.commitmentHex), false);
  await assert.rejects(joiningApi.openAccountAt(account.address), { code: 'AccountNotFound' });
  assert.equal((await createPassportAccounts(ports).openAccount()).address, account.address);
});

test('an enrolled P-256 passkey opens its ACC by address without a directory hint', async () => {
  const fake = createFakePorts();
  const owner = {
    ...fake,
    viewingKey: viewingKey(),
    authoriser: {
      ...fake.authoriser,
      withKeySession: async (/** @type {() => Promise<any>} */ operation) => operation(),
    },
    readGrants: {
      readActiveReadGrantTargets: async () => ({
        authNonce: [...fake.ledger.values()][0]?.authNonce ?? 0n,
        targets: [],
      }),
    },
  };
  const account = await createPassportAccounts(owner).createAccount({
    userName: 'owner',
    retireAuthority: true,
  });
  const ledger = fake.ledger.get(account.address);
  assert.ok(ledger);
  ledger.specVersion = 3;
  assert.ok(account.addDevice);
  const joining = fakeAuthoriser({ device: 1 });
  const reader = {
    scheme: /** @type {const} */ ('p256-webauthn'),
    readerPublicKey: hex(x25519.getPublicKey(new Uint8Array(32).fill(7))),
    devicePublicKey: await joining.devicePublicKeyHex(),
    policy: FAKE_POLICY,
  };
  await account.addDevice(reader);
  const joiningPorts = {
    ...owner,
    authoriser: {
      ...joining,
      withKeySession: async (/** @type {() => Promise<any>} */ operation) => operation(),
    },
    credentials: fakeCredentials({ authoriser: joining }),
    viewingKey: viewingKey(7),
  };
  const api = createPassportAccounts(joiningPorts);
  await assert.rejects(api.openAccount(), { code: 'AccountNotFound' });
  assert.ok(api.openAccountAt);
  await assert.rejects(api.openAccountAt('bad-address'), { code: 'AccountNotFound' });
  await assert.rejects(api.openAccountAt('cc'.repeat(32)), { code: 'AccountNotFound' });
  const recovered = await api.openAccountAt(account.address);
  assert.equal(recovered.address, account.address);
  assert.equal((await recovered.state()).entryCount, 2);
  const wrongReader = createPassportAccounts({ ...joiningPorts, viewingKey: viewingKey(8) });
  assert.ok(wrongReader.openAccountAt);
  await assert.rejects(wrongReader.openAccountAt(account.address), {
    code: 'EncryptionKeyMismatch',
  });
});

test('P-256 enrollment refuses active read grants before key delivery', async () => {
  const fake = createFakePorts();
  const ports = {
    ...fake,
    viewingKey: viewingKey(),
    authoriser: {
      ...fake.authoriser,
      withKeySession: async (/** @type {() => Promise<any>} */ operation) => operation(),
    },
    readGrants: {
      readActiveReadGrantTargets: async () => ({
        authNonce: /** @type {bigint} */ ([...fake.ledger.values()][0]?.authNonce ?? 0n),
        targets: [{ grantId: 'aa'.repeat(32), readPublicKey: 'bb'.repeat(32) }],
      }),
    },
  };
  const account = await createPassportAccounts(ports).createAccount({
    userName: 'owner',
    retireAuthority: true,
  });
  const ledger = fake.ledger.get(account.address);
  assert.ok(ledger);
  ledger.specVersion = 3;
  assert.ok(account.addDevice);
  const joining = fakeAuthoriser({ device: 1 });
  const reader = {
    scheme: /** @type {const} */ ('p256-webauthn'),
    readerPublicKey: hex(x25519.getPublicKey(new Uint8Array(32).fill(7))),
    devicePublicKey: await joining.devicePublicKeyHex(),
    policy: FAKE_POLICY,
  };
  await assert.rejects(account.addDevice(reader), { code: 'BindingUnsupported' });
  assert.equal(ledger.inboxEntries.length, 2);
});

test('P-256 enrollment can retry after one sealed entry was published', async () => {
  const fake = createFakePorts();
  let interrupt = false;
  let deliveries = 0;
  const chain = {
    ...fake.chain,
    async call(
      /** @type {import('../packages/account/dist/ports/index.js').CallRequest} */ request,
    ) {
      if (interrupt && request.circuit === 'append_inbox_with_p256' && ++deliveries === 2)
        throw new Error('interrupted second delivery');
      return fake.chain.call(request);
    },
  };
  const ports = {
    ...fake,
    chain,
    viewingKey: viewingKey(),
    authoriser: {
      ...fake.authoriser,
      withKeySession: async (/** @type {() => Promise<any>} */ operation) => operation(),
    },
    readGrants: {
      readActiveReadGrantTargets: async () => ({
        authNonce: [...fake.ledger.values()][0]?.authNonce ?? 0n,
        targets: [],
      }),
    },
  };
  const account = await createPassportAccounts(ports).createAccount({
    userName: 'owner',
    retireAuthority: true,
  });
  const ledger = fake.ledger.get(account.address);
  assert.ok(ledger);
  ledger.specVersion = 3;
  assert.ok(account.addDevice);
  const joining = fakeAuthoriser({ device: 1 });
  const reader = {
    scheme: /** @type {const} */ ('p256-webauthn'),
    readerPublicKey: hex(x25519.getPublicKey(new Uint8Array(32).fill(7))),
    devicePublicKey: await joining.devicePublicKeyHex(),
    policy: FAKE_POLICY,
  };
  interrupt = true;
  await assert.rejects(account.addDevice(reader), /interrupted second delivery/);
  assert.equal(ledger.inboxEntries.length, 3);
  interrupt = false;
  const result = await account.addDevice(reader);
  assert.ok(ledger.entries.has(result.commitmentHex));
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
