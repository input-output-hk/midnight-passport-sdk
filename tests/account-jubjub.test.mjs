import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sha256 } from '@noble/hashes/sha2.js';
import { x25519 } from '@noble/curves/ed25519.js';
import { jubjub } from '@noble/curves/misc.js';
import { pureCircuits } from '../packages/contract/generated/acc-s3r1.1/index.js';
import { createPassportAccounts } from '../packages/account/dist/index.js';
import { recipeDeviceKeyring, recipeJubjubAuthoriser } from '../packages/keys/dist/index.js';
import { sealInboxCoin } from '../packages/keys/dist/inbox-coin.js';

const address = 'ab'.repeat(32);
const credentialId = Uint8Array.of(1, 2, 3);
const hex = (/** @type {Uint8Array} */ bytes) => Buffer.from(bytes).toString('hex');

function world() {
  /** @type {import('../packages/account/dist/ports/index.js').AccountHint | undefined} */
  let hint;
  /** @type {string[]} */
  const calls = [];
  /** @type {string[]} */
  const writes = [];
  const inbox = /** @type {Uint8Array[]} */ ([]);
  let booted = false;
  let nonce = 0n;
  let grantGeneration = 0n;
  let specVersion = 3;
  let counter = 0n;
  /** @type {Uint8Array[]} */
  const remoteEntries = [];
  /** @type {Uint8Array} */
  let encKey = new Uint8Array(32);
  /** @type {Uint8Array} */
  let boot = new Uint8Array(32);
  let failActivation = false;
  let failSecondAppend = false;
  let failRemoval = false;
  let failGrantRevoke = false;
  let failEnrollment = false;
  let tamperKeyAfterNextAppend = false;
  let addInboxAfterNextAppend = false;
  let changeReadGrantsAfterNextAppend = false;
  /** @type {number[]} */
  let selectedHoldings = [];
  /** @type {import('../packages/account/dist/ports/index.js').ActiveReadGrantTarget[]} */
  let activeReadGrants = [];
  /** @type {string[]} */
  const activeGrantIds = [];
  /** @type {import('../packages/account/dist/ports/index.js').PrfKeySource} */
  const source = {
    withSession: async (operation) => operation(),
    deviceSecret: async () => new Uint8Array(32).fill(7),
    deriveSecret: async (
      /** @type {{domain: string, context: string, length?: number}} */ params,
    ) =>
      sha256(new TextEncoder().encode(`${params.domain}|${params.context}`)).slice(
        0,
        params.length ?? 32,
      ),
  };
  const recipe = recipeJubjubAuthoriser(source, pureCircuits);
  /** @type {Array<import('../packages/account/dist/ports/index.js').FlowDescriptor|undefined>} */
  const sessionFlows = [];
  const authoriser = {
    ...recipe,
    withKeySession: (
      /** @type {() => Promise<any>} */ operation,
      /** @type {import('../packages/account/dist/ports/index.js').FlowDescriptor|undefined} */ flow,
    ) => {
      sessionFlows.push(flow);
      return recipe.withKeySession(operation, flow);
    },
  };
  const chain = {
    async readAccount(
      /** @type {string} */ at,
      /** @type {{includeInbox?: boolean, includeDevices?: boolean}} */ options = {},
    ) {
      if (at !== address) return undefined;
      const pk = await authoriser.devicePublicKey();
      const entry = pureCircuits.derive_device_entry_with_jubjub(
        { bytes: Buffer.from(address, 'hex') },
        pk,
        0n,
        counter,
      );
      const devices = booted ? [entry, ...remoteEntries] : [];
      return {
        booted,
        authNonce: nonce,
        deviceEpoch: 0n,
        entryCount: devices.length,
        specVersion,
        encKey,
        ...(options.includeInbox && { inboxEntries: [...inbox] }),
        ...(options.includeDevices && { deviceEntries: devices }),
        hasEntry: (/** @type {Uint8Array} */ candidate) =>
          devices.some((held) => hex(candidate) === hex(held)),
      };
    },
    async call(/** @type {{circuit: string,args: readonly unknown[]}} */ request) {
      calls.push(request.circuit);
      if (request.circuit === 'activate_initial_device_with_jubjub') {
        if (failActivation) {
          failActivation = false;
          throw new Error('interrupted before activation');
        }
        assert.equal(
          hex(
            pureCircuits.derive_boot_commitment_with_jubjub(
              /** @type {Uint8Array} */ (request.args[1]),
              /** @type {{x: bigint, y: bigint}} */ (request.args[0]),
            ),
          ),
          hex(boot),
        );
        booted = true;
      } else if (request.circuit === 'append_inbox_with_jubjub') {
        if (failSecondAppend && inbox.length === 1) {
          failSecondAppend = false;
          throw new Error('interrupted before second append');
        }
        assert.equal(request.args[2], counter);
        inbox.push(/** @type {Uint8Array} */ (request.args[0]));
        counter++;
        nonce++;
        if (tamperKeyAfterNextAppend) {
          tamperKeyAfterNextAppend = false;
          encKey = new Uint8Array(32).fill(9);
        }
        if (addInboxAfterNextAppend) {
          addInboxAfterNextAppend = false;
          inbox.push(new Uint8Array(192).fill(8));
        }
        if (changeReadGrantsAfterNextAppend) {
          changeReadGrantsAfterNextAppend = false;
          activeReadGrants = [{ grantId: 'fe'.repeat(32) }];
        }
      } else if (request.circuit === 'rotate_enc_key_with_jubjub') {
        assert.equal(request.args[2], counter);
        encKey = /** @type {Uint8Array} */ (request.args[0]);
        counter++;
        nonce++;
      } else if (request.circuit === 'issue_grant_with_jubjub') {
        assert.equal(request.args[19], counter);
        activeGrantIds.push(hex(/** @type {Uint8Array} */ (request.args[0])));
        counter++;
        nonce++;
      } else if (request.circuit === 'revoke_grant_with_jubjub') {
        if (failGrantRevoke) {
          failGrantRevoke = false;
          throw new Error('revocation interrupted after key rotation');
        }
        assert.equal(request.args[2], counter);
        const id = hex(/** @type {Uint8Array} */ (request.args[0]));
        const index = activeGrantIds.indexOf(id);
        assert.ok(index >= 0);
        activeGrantIds.splice(index, 1);
        counter++;
        nonce++;
      } else if (request.circuit === 'revoke_all_grants_with_jubjub') {
        assert.equal(request.args[1], counter);
        activeGrantIds.length = 0;
        grantGeneration = (grantGeneration + 1n) & ((1n << 32n) - 1n);
        counter++;
        nonce++;
      } else if (request.circuit === 'remove_device_with_jubjub') {
        if (failRemoval) {
          failRemoval = false;
          throw new Error('removal was interrupted after key rotation');
        }
        assert.equal(request.args[2], counter);
        const target = /** @type {Uint8Array} */ (request.args[0]);
        const index = remoteEntries.findIndex((entry) => hex(entry) === hex(target));
        assert.ok(index >= 0, 'the target is a live remote entry');
        remoteEntries.splice(index, 1);
        counter++;
        nonce++;
      } else if (request.circuit === 'add_device_with_jubjub') {
        if (failEnrollment) {
          failEnrollment = false;
          throw new Error('enrollment was interrupted after key rotation');
        }
        assert.equal(request.args[2], counter);
        const target = /** @type {Uint8Array} */ (request.args[0]);
        assert.ok(!remoteEntries.some((entry) => hex(entry) === hex(target)));
        remoteEntries.push(target);
        counter++;
        nonce++;
      } else throw new Error(`unexpected circuit ${request.circuit}`);
      return { txHash: `tx-${calls.length}` };
    },
  };
  const directory = {
    get: async () => hint,
    put: async (/** @type {string} */ _network, /** @type {typeof hint} */ value) => {
      if (hint && value?.address !== hint.address) throw new Error('directory write-once conflict');
      hint = value;
      writes.push(value?.status ?? 'missing');
    },
  };
  const ports = {
    network: {
      networkId: 'undeployed',
      bindingId: 'acc-s3r1.1',
      indexerUrl: '',
      indexerWsUrl: '',
      nodeUrl: '',
      artefactUrl: '',
      manifestSha256: '0'.repeat(64),
    },
    binding: { pureCircuits },
    credentials: {
      create: async () => ({ credentialId }),
      identify: async () => ({ credentialId, owns: () => false }),
    },
    authoriser,
    encryptionKey: { publicKey: async () => new Uint8Array(32) },
    viewingKey: recipeDeviceKeyring(source),
    holdings: { selectHeldEntries: async () => selectedHoldings },
    readGrants: {
      readActiveReadGrantTargets: async () => ({ authNonce: nonce, targets: activeReadGrants }),
    },
    chain,
    deployer: {
      async deploy(
        /** @type {{boot: Uint8Array, encKey: Uint8Array, firstArm?: string}} */ request,
      ) {
        assert.equal(request.firstArm, 'jubjub');
        boot = request.boot;
        encKey = request.encKey;
        return { address, txIds: ['wave-1'] };
      },
    },
    directory,
    random: (/** @type {number} */ length) => new Uint8Array(length).fill(3),
  };
  const joiningDevice = async (seed = 11, readerSeed = seed) => {
    /** @type {import('../packages/account/dist/ports/index.js').PrfKeySource} */
    const remoteSource = {
      withSession: async (operation) => operation(),
      deviceSecret: async () => new Uint8Array(32).fill(seed),
      deriveSecret: async (params) =>
        sha256(
          new TextEncoder().encode(`remote-${readerSeed}|${params.domain}|${params.context}`),
        ).slice(0, params.length ?? 32),
    };
    const remoteAuthoriser = recipeJubjubAuthoriser(remoteSource, pureCircuits);
    const remoteViewingKey = recipeDeviceKeyring(remoteSource);
    const publicKey = await remoteAuthoriser.devicePublicKey();
    const entry = pureCircuits.derive_device_entry_with_jubjub(
      { bytes: Buffer.from(address, 'hex') },
      publicKey,
      0n,
      0n,
    );
    const reader = {
      readerPublicKey: hex(await remoteViewingKey.readerPublicKey('undeployed')),
      devicePublicKey: await remoteAuthoriser.devicePublicKeyHex(),
    };
    return { entry, reader, remoteViewingKey, publicKey };
  };
  return {
    accounts: createPassportAccounts(ports),
    ports,
    activeGrantIds,
    grantNonce: () => nonce,
    grantGeneration: () => grantGeneration,
    calls,
    sessionFlows,
    writes,
    inbox,
    hint: () => hint,
    setHint: (/** @type {typeof hint} */ value) => (hint = value),
    setCounter: (/** @type {bigint} */ value) => (counter = value),
    setSpecVersion: (/** @type {number} */ value) => (specVersion = value),
    setHeldIndices: (/** @type {number[]} */ value) => (selectedHoldings = value),
    setReadGrantTargets: (/** @type {typeof activeReadGrants} */ value) =>
      (activeReadGrants = value),
    encKey: () => encKey,
    viewingKey: ports.viewingKey,
    joiningDevice,
    ownEntry: async () =>
      pureCircuits.derive_device_entry_with_jubjub(
        { bytes: Buffer.from(address, 'hex') },
        await authoriser.devicePublicKey(),
        0n,
        counter,
      ),
    addRemoteDevice: async (seed = 11, readerSeed = seed, useCounter = 0n) => {
      const { entry, reader, remoteViewingKey, publicKey } = await joiningDevice(seed, readerSeed);
      const liveEntry =
        useCounter === 0n
          ? entry
          : pureCircuits.derive_device_entry_with_jubjub(
              { bytes: Buffer.from(address, 'hex') },
              publicKey,
              0n,
              useCounter,
            );
      const delivery = await ports.viewingKey.sealToDevice(
        'undeployed',
        { account: address, encKey, envelopes: [...inbox].reverse() },
        { ...reader, epoch: 0n, counter: useCounter },
      );
      inbox.push(delivery.envelope, delivery.registration);
      remoteEntries.push(liveEntry);
      return { entry: liveEntry, remoteViewingKey };
    },
    addUnregisteredDevice: (entry = new Uint8Array(32).fill(99)) => remoteEntries.push(entry),
    withoutHoldings: () => {
      const { holdings: _holdings, ...without } = ports;
      return createPassportAccounts(without);
    },
    withoutReadGrants: () => {
      const { readGrants: _readGrants, ...without } = ports;
      return createPassportAccounts(without);
    },
    interruptActivation: () => (failActivation = true),
    interruptSecondAppend: () => (failSecondAppend = true),
    interruptRemoval: () => (failRemoval = true),
    interruptGrantRevoke: () => (failGrantRevoke = true),
    interruptEnrollment: () => (failEnrollment = true),
    tamperKeyAfterNextAppend: () => (tamperKeyAfterNextAppend = true),
    addInboxAfterNextAppend: () => (addInboxAfterNextAppend = true),
    changeReadGrantsAfterNextAppend: () => (changeReadGrantsAfterNextAppend = true),
  };
}

test('JubJub creation appends sealed keys, then opens from the live inbox', async () => {
  const w = world();
  const account = await w.accounts.createAccount({ userName: 'alice', retireAuthority: true });
  assert.equal(account.scheme, 'jubjub-schnorr');
  assert.equal(account.address, address);
  assert.deepEqual(w.calls, [
    'activate_initial_device_with_jubjub',
    'append_inbox_with_jubjub',
    'append_inbox_with_jubjub',
  ]);
  assert.deepEqual(w.writes, ['deployed', 'active']);
  assert.equal(w.inbox.length, 2);
  assert.equal((await account.state()).authNonce, 2n);
  assert.deepEqual(w.sessionFlows[0], { kind: 'create-account', lockAccount: true });
  assert.equal((await w.accounts.openAccount()).address, address);
  assert.deepEqual(w.sessionFlows.at(-1), { kind: 'sign-in' });
  assert.equal(w.calls.length, 3, 'open did not repeat completed calls');
});

test('JubJub grant issue refuses a host without live grants and a durable journal', async () => {
  const w = world();
  const account = await w.accounts.createAccount({ userName: 'alice', retireAuthority: true });
  assert.ok(account.issueGrant);
  const calls = w.calls.length;
  await assert.rejects(
    account.issueGrant({
      grantee: { scheme: 'jubjub-schnorr', publicKey: '00'.repeat(32) },
      operations: ['withdraw-unshielded'],
      color: '00'.repeat(32),
      recipient: { kind: 'any' },
      maxCoinValue: '10',
      perCallCap: '1',
      cap: '10',
      expiresAt: null,
    }),
    { code: 'BindingUnsupported' },
  );
  assert.equal(w.calls.length, calls);
});

test('JubJub account issueGrant pins the host origin and returns after sealed publication', async () => {
  const w = world();
  await w.accounts.createAccount({ userName: 'alice', retireAuthority: true });
  /** @type {import('../packages/account/dist/ports/index.js').AccountRecord} */
  let local = {
    address,
    bindingId: 'acc-s3r1.1',
    scheme: 'jubjub-schnorr',
    credentialId,
    localUseCounter: 2n,
  };
  /** @type {import('../packages/account/dist/jubjub-grant-issue.js').StagedJubjubGrant | undefined} */
  let staged;
  let published = false;
  const accounts = createPassportAccounts({
    ...w.ports,
    grantOrigin: 'trusted.example',
    records: {
      exists: async () => true,
      read: async () => local,
      write: async (next) => {
        local = next;
      },
    },
    grants: {
      readActiveGrantIds: async () => [...w.activeGrantIds],
      readActiveGrantSnapshot: async () => ({
        authNonce: w.grantNonce(),
        ids: [...w.activeGrantIds],
      }),
    },
    grantDetails: {
      readGrant: async (_account, grantId) => ({
        active: w.activeGrantIds.includes(grantId),
        read: false,
        authNonce: w.grantNonce(),
      }),
    },
    grantRoster: {
      readGrantRoster: async () => ({
        authNonce: w.grantNonce(),
        generation: w.grantGeneration(),
        entries: w.activeGrantIds.map((id) => ({ id, active: true, read: false })),
      }),
    },
    grantJournal: {
      stage: async (opening) => {
        staged = opening;
      },
      load: async () => staged,
      markPublished: async () => {
        published = true;
      },
      pending: async () => (staged && !published ? [staged.bookkeeping.grantId] : []),
    },
  });
  const account = await accounts.openAccount();
  assert.ok(account.issueGrant);
  const grantee = hex(
    jubjub.Point.fromAffine(pureCircuits.compute_public_point_with_jubjub(11n)).toBytes(),
  );
  const result = await account.issueGrant({
    grantee: { scheme: 'jubjub-schnorr', publicKey: grantee },
    operations: ['withdraw-unshielded'],
    color: '34'.repeat(32),
    recipient: { kind: 'any' },
    maxCoinValue: '100',
    perCallCap: '10',
    cap: '100',
    expiresAt: null,
  });
  assert.equal(result.status, 'active');
  assert.equal(staged?.origin, 'trusted.example');
  assert.equal(result.grantId, staged?.bookkeeping.grantId);
  assert.equal(result.appendTxHashes.length, 2);
  assert.equal(local.localUseCounter, 5n);
  assert.equal(published, true);
  assert.ok(account.recoverPendingGrants);
  assert.deepEqual(await account.recoverPendingGrants(), {
    published: [],
    unsettledGrantIds: [],
  });
  assert.ok(account.revokeGrant);
  const revoked = await account.revokeGrant(result.grantId);
  assert.equal(revoked.status, 'revoked');
  assert.equal(revoked.grantId, result.grantId);
  assert.equal(local.localUseCounter, 6n);
  assert.ok(!w.activeGrantIds.includes(result.grantId));
  assert.ok(account.revokeAllGrants);
  const cleared = await account.revokeAllGrants();
  assert.equal(cleared.status, 'cleared');
  assert.equal(cleared.generation, 1n);
  assert.equal(local.localUseCounter, 7n);
});

test('JubJub open resumes activation and sealed entries after an interrupted create', async () => {
  const w = world();
  w.interruptActivation();
  await assert.rejects(w.accounts.createAccount({ userName: 'alice', retireAuthority: true }));
  assert.equal(w.hint()?.status, 'deployed');
  assert.equal(w.inbox.length, 0);
  const recovered = await w.accounts.openAccount();
  assert.equal(recovered.address, address);
  assert.equal(w.inbox.length, 2);
  assert.equal(w.hint()?.status, 'active');
});

test('JubJub open resumes a partially appended key delivery without duplicating the first', async () => {
  const w = world();
  w.interruptSecondAppend();
  await assert.rejects(w.accounts.createAccount({ userName: 'alice', retireAuthority: true }));
  assert.equal(w.hint()?.status, 'deployed');
  assert.equal(w.inbox.length, 1);
  const recovered = await w.accounts.openAccount();
  assert.equal(recovered.address, address);
  assert.equal(w.inbox.length, 2);
  assert.equal(w.hint()?.status, 'active');
});

test('JubJub open finds a Lace device entry after more than 64 authorised calls', async () => {
  const w = world();
  await w.accounts.createAccount({ userName: 'alice', retireAuthority: true });
  w.setCounter(127n);
  assert.equal((await w.accounts.openAccount()).address, address);
});

test('JubJub open refuses a directory key mismatch and a missing valid envelope', async () => {
  const w = world();
  await w.accounts.createAccount({ userName: 'alice', retireAuthority: true });
  const good = w.hint();
  assert.ok(good);
  w.setHint({ ...good, publicKey: { x: 1n, y: 2n } });
  await assert.rejects(w.accounts.openAccount(), { code: 'AccountNotFound' });
  const badEnvelope = new Uint8Array(192);
  badEnvelope.set([0xd1, 1]);
  const registration = good.keyEntries?.[1];
  assert.ok(registration);
  w.setHint({ ...good, keyEntries: [badEnvelope, registration] });
  w.inbox.splice(0);
  await assert.rejects(w.accounts.openAccount(), { code: 'EncryptionKeyMismatch' });
});

test('JubJub rotation seals a fresh key before updating the ACC and stays reopenable', async () => {
  const w = world();
  const account = await w.accounts.createAccount({ userName: 'alice', retireAuthority: true });
  const before = hex(w.encKey());
  assert.ok(account.rotateViewingKey);
  const result = await account.rotateViewingKey();
  assert.equal(result.txHash, 'tx-5');
  assert.deepEqual(result.droppedDeviceEntries, []);
  assert.deepEqual(result.sealedReadGrants, []);
  assert.deepEqual(result.unsealedGrantIds, []);
  assert.notEqual(hex(w.encKey()), before);
  assert.deepEqual(w.calls.slice(3), ['append_inbox_with_jubjub', 'rotate_enc_key_with_jubjub']);
  assert.equal((await w.accounts.openAccount()).address, address);
});

test('JubJub enrollment delivers the current account keys before the joining entry becomes live', async () => {
  const w = world();
  const account = await w.accounts.createAccount({ userName: 'alice', retireAuthority: true });
  const { entry, reader, remoteViewingKey } = await w.joiningDevice();
  assert.ok(account.addDevice);
  const result = await account.addDevice(reader);
  assert.equal(result.commitmentHex, hex(entry));
  assert.equal(result.nextUseCounter, 5n);
  assert.equal(result.txHash, 'tx-6');
  assert.deepEqual(w.calls.slice(3), [
    'append_inbox_with_jubjub',
    'append_inbox_with_jubjub',
    'add_device_with_jubjub',
  ]);
  assert.deepEqual(w.sessionFlows.at(-1), {
    kind: 'add-device',
    account: address,
    commitmentHex: hex(entry),
    reader,
  });
  const opened = await remoteViewingKey.openInbox(
    'undeployed',
    { account: address, encKey: w.encKey(), envelopes: [...w.inbox].reverse() },
    w.inbox,
  );
  assert.ok(opened.some((item) => item?.kind === 'device'));
  assert.equal((await account.state()).entryCount, 2);
  assert.equal((await w.accounts.openAccount()).address, address);
});

test('JubJub enrollment rejects bad or already live readers before changing the account', async () => {
  const w = world();
  const account = await w.accounts.createAccount({ userName: 'alice', retireAuthority: true });
  const { reader } = await w.joiningDevice();
  assert.ok(account.addDevice);
  const sessions = w.sessionFlows.length;
  await assert.rejects(account.addDevice({ ...reader, devicePublicKey: 'bad' }), {
    code: 'DeviceRosterInvalid',
  });
  assert.equal(w.sessionFlows.length, sessions);
  assert.equal(w.calls.length, 3);
  await account.addDevice(reader);
  await assert.rejects(account.addDevice(reader), { code: 'DeviceRosterInvalid' });
  assert.equal(w.calls.length, 6);
});

test('JubJub enrollment refuses a reader key already registered to another device', async () => {
  const w = world();
  const account = await w.accounts.createAccount({ userName: 'alice', retireAuthority: true });
  await w.addRemoteDevice(11, 11);
  const { reader } = await w.joiningDevice(12, 11);
  assert.ok(account.addDevice);
  await assert.rejects(account.addDevice(reader), { code: 'DeviceRosterInvalid' });
  assert.equal(w.calls.length, 3);
  assert.equal((await account.state()).entryCount, 2);
});

test('JubJub enrollment refuses an existing signer at a later use counter', async () => {
  const w = world();
  const account = await w.accounts.createAccount({ userName: 'alice', retireAuthority: true });
  await w.addRemoteDevice(11, 11, 1n);
  const { reader } = await w.joiningDevice(11, 11);
  assert.ok(account.addDevice);
  await assert.rejects(account.addDevice(reader), { code: 'DeviceRosterInvalid' });
  const before = hex(w.encKey());
  const grantee = x25519.keygen();
  w.setReadGrantTargets([{ grantId: 'ac'.repeat(32), readPublicKey: hex(grantee.publicKey) }]);
  await assert.rejects(account.addDevice(reader), { code: 'DeviceRosterInvalid' });
  assert.equal(hex(w.encKey()), before);
  assert.equal(w.calls.length, 3);
  grantee.secretKey.fill(0);
});

test('JubJub enrollment rotates keys before delivering to a joiner while a read grant is live', async () => {
  const w = world();
  const account = await w.accounts.createAccount({ userName: 'alice', retireAuthority: true });
  const { entry, reader, remoteViewingKey } = await w.joiningDevice();
  const grantee = x25519.keygen();
  const grantId = 'ac'.repeat(32);
  const before = hex(w.encKey());
  const own = hex(await w.ownEntry());
  w.setReadGrantTargets([{ grantId, readPublicKey: hex(grantee.publicKey) }]);
  assert.ok(account.addDevice);
  const result = await account.addDevice(reader);
  assert.equal(result.commitmentHex, hex(entry));
  assert.equal(result.rotationTxHash, 'tx-7');
  assert.equal(result.txHash, 'tx-10');
  assert.equal(result.sealedReadGrants?.[0]?.grantId, grantId);
  assert.notEqual(hex(w.encKey()), before);
  assert.deepEqual(w.calls.slice(3), [
    'append_inbox_with_jubjub',
    'append_inbox_with_jubjub',
    'append_inbox_with_jubjub',
    'rotate_enc_key_with_jubjub',
    'append_inbox_with_jubjub',
    'append_inbox_with_jubjub',
    'add_device_with_jubjub',
  ]);
  assert.deepEqual(w.sessionFlows.at(-1), {
    kind: 'add-device',
    account: address,
    commitmentHex: hex(entry),
    reader,
    devices: [own],
  });
  const opened = await remoteViewingKey.openInbox(
    'undeployed',
    { account: address, encKey: w.encKey(), envelopes: [...w.inbox].reverse() },
    w.inbox,
  );
  assert.ok(opened.some((item) => item?.kind === 'device'));
  assert.equal((await account.state()).entryCount, 2);
  grantee.secretKey.fill(0);
});

test('JubJub enrollment refuses an unsealable read grant and a grant added during delivery', async () => {
  const w = world();
  const account = await w.accounts.createAccount({ userName: 'alice', retireAuthority: true });
  const { reader } = await w.joiningDevice();
  assert.ok(account.addDevice);
  w.setReadGrantTargets([{ grantId: 'ac'.repeat(32) }]);
  await assert.rejects(account.addDevice(reader), { code: 'GrantRosterUnsettled' });
  assert.equal(w.calls.length, 3);
  w.setReadGrantTargets([]);
  w.changeReadGrantsAfterNextAppend();
  await assert.rejects(account.addDevice(reader), { code: 'GrantRosterUnsettled' });
  assert.deepEqual(w.calls.slice(3), ['append_inbox_with_jubjub', 'append_inbox_with_jubjub']);
  assert.equal((await account.state()).entryCount, 1);
});

test('JubJub grant-aware enrollment can retry after rotation lands but enrollment fails', async () => {
  const w = world();
  const account = await w.accounts.createAccount({ userName: 'alice', retireAuthority: true });
  const { entry, reader, remoteViewingKey } = await w.joiningDevice();
  const grantee = x25519.keygen();
  w.setReadGrantTargets([{ grantId: 'ad'.repeat(32), readPublicKey: hex(grantee.publicKey) }]);
  const before = hex(w.encKey());
  w.interruptEnrollment();
  assert.ok(account.addDevice);
  await assert.rejects(account.addDevice(reader), { code: 'InternalError' });
  assert.notEqual(hex(w.encKey()), before);
  assert.equal((await account.state()).entryCount, 1);
  const reopened = await w.accounts.openAccount();
  assert.ok(reopened.addDevice);
  const result = await reopened.addDevice(reader);
  assert.equal(result.commitmentHex, hex(entry));
  assert.equal((await reopened.state()).entryCount, 2);
  const opened = await remoteViewingKey.openInbox(
    'undeployed',
    { account: address, encKey: w.encKey(), envelopes: [...w.inbox].reverse() },
    w.inbox,
  );
  assert.ok(opened.some((item) => item?.kind === 'device'));
  grantee.secretKey.fill(0);
});

test('JubJub grant-aware enrollment refuses an unregistered surviving device', async () => {
  const w = world();
  const account = await w.accounts.createAccount({ userName: 'alice', retireAuthority: true });
  const { reader } = await w.joiningDevice();
  const grantee = x25519.keygen();
  w.setReadGrantTargets([{ grantId: 'ad'.repeat(32), readPublicKey: hex(grantee.publicKey) }]);
  w.addUnregisteredDevice();
  const before = hex(w.encKey());
  assert.ok(account.addDevice);
  await assert.rejects(account.addDevice(reader), { code: 'DeviceRosterInvalid' });
  assert.equal(hex(w.encKey()), before);
  assert.equal(w.calls.length, 3);
  grantee.secretKey.fill(0);
});

test('JubJub removal rotates the roster key before revoking a remote device', async () => {
  const w = world();
  const account = await w.accounts.createAccount({ userName: 'alice', retireAuthority: true });
  const { entry, remoteViewingKey } = await w.addRemoteDevice();
  const own = await w.ownEntry();
  const before = hex(w.encKey());
  assert.ok(account.removeDevice);
  const result = await account.removeDevice(hex(entry));
  assert.equal(result.removedCommitmentHex, hex(entry));
  assert.equal(result.rotationTxHash, 'tx-6');
  assert.equal(result.txHash, 'tx-7');
  assert.deepEqual(result.droppedDeviceEntries, []);
  assert.notEqual(hex(w.encKey()), before);
  assert.deepEqual(w.calls.slice(3), [
    'append_inbox_with_jubjub',
    'append_inbox_with_jubjub',
    'rotate_enc_key_with_jubjub',
    'remove_device_with_jubjub',
  ]);
  assert.deepEqual(w.sessionFlows.at(-1), {
    kind: 'remove-device',
    account: address,
    commitmentHex: hex(entry),
    devices: [hex(own)],
  });
  assert.equal((await account.state()).entryCount, 1);
  assert.equal((await w.accounts.openAccount()).address, address);
  await assert.rejects(
    remoteViewingKey.openInbox(
      'undeployed',
      { account: address, encKey: w.encKey(), envelopes: [...w.inbox].reverse() },
      w.inbox.slice(-2),
    ),
  );
});

test('JubJub removal refuses self and stale targets before rotating any key', async () => {
  const w = world();
  const account = await w.accounts.createAccount({ userName: 'alice', retireAuthority: true });
  assert.ok(account.removeDevice);
  const before = hex(w.encKey());
  const sessions = w.sessionFlows.length;
  await assert.rejects(account.removeDevice(hex(await w.ownEntry())), { code: 'LastDevice' });
  await assert.rejects(account.removeDevice('ff'.repeat(32)), {
    code: 'RemovalTargetNotFound',
  });
  await assert.rejects(account.removeDevice('bad'), { code: 'RemovalTargetNotFound' });
  assert.equal(w.sessionFlows.length, sessions);
  assert.equal(w.calls.length, 3);
  assert.equal(hex(w.encKey()), before);
  w.setSpecVersion(2);
  await assert.rejects(account.removeDevice('ff'.repeat(32)), { code: 'BindingUnsupported' });
});

test('JubJub removal retains a surviving reader and refuses an unregistered survivor', async () => {
  const w = world();
  const account = await w.accounts.createAccount({ userName: 'alice', retireAuthority: true });
  const removed = await w.addRemoteDevice(11);
  const surviving = await w.addRemoteDevice(12);
  assert.ok(account.removeDevice);
  const result = await account.removeDevice(hex(removed.entry));
  assert.deepEqual(result.droppedDeviceEntries, []);
  assert.equal((await account.state()).entryCount, 2);
  const opened = await surviving.remoteViewingKey.openInbox(
    'undeployed',
    { account: address, encKey: w.encKey(), envelopes: [...w.inbox].reverse() },
    w.inbox.slice(-2),
  );
  assert.ok(opened.some((entry) => entry?.kind === 'device'));

  const other = world();
  const anotherAccount = await other.accounts.createAccount({
    userName: 'alice',
    retireAuthority: true,
  });
  const target = await other.addRemoteDevice();
  other.addUnregisteredDevice();
  const prior = hex(other.encKey());
  assert.ok(anotherAccount.removeDevice);
  await assert.rejects(anotherAccount.removeDevice(hex(target.entry)), {
    code: 'DeviceRosterInvalid',
  });
  assert.equal(hex(other.encKey()), prior);
  assert.equal(other.calls.length, 3);
});

test('JubJub removal refuses a survivor sharing the removed reader key', async () => {
  const w = world();
  const account = await w.accounts.createAccount({ userName: 'alice', retireAuthority: true });
  const target = await w.addRemoteDevice(11, 11);
  await w.addRemoteDevice(12, 11);
  const before = hex(w.encKey());
  assert.ok(account.removeDevice);
  await assert.rejects(account.removeDevice(hex(target.entry)), { code: 'DeviceRosterInvalid' });
  assert.equal(hex(w.encKey()), before);
  assert.equal(w.calls.length, 3);
});

test('JubJub removal seals a fresh viewing secret to an active read grantee', async () => {
  const w = world();
  const account = await w.accounts.createAccount({ userName: 'alice', retireAuthority: true });
  const { entry } = await w.addRemoteDevice();
  const grantee = x25519.keygen();
  const grantId = 'ac'.repeat(32);
  w.setReadGrantTargets([{ grantId, readPublicKey: hex(grantee.publicKey) }]);
  assert.ok(account.removeDevice);
  const result = await account.removeDevice(hex(entry));
  assert.equal(result.sealedReadGrants[0]?.grantId, grantId);
  assert.equal(result.unsealedGrantIds.length, 0);
  assert.equal(w.calls.at(-1), 'remove_device_with_jubjub');
  grantee.secretKey.fill(0);
});

async function readRevokeWorld() {
  const w = world();
  await w.accounts.createAccount({ userName: 'alice', retireAuthority: true });
  const revokedId = 'ac'.repeat(32);
  const survivingId = 'bd'.repeat(32);
  const revokedReader = x25519.keygen();
  const survivingReader = x25519.keygen();
  w.activeGrantIds.push(revokedId, survivingId);
  w.setReadGrantTargets([
    { grantId: revokedId, readPublicKey: hex(revokedReader.publicKey) },
    { grantId: survivingId, readPublicKey: hex(survivingReader.publicKey) },
  ]);
  /** @type {import('../packages/account/dist/ports/index.js').AccountRecord} */
  let local = {
    address,
    bindingId: 'acc-s3r1.1',
    scheme: 'jubjub-schnorr',
    credentialId,
    localUseCounter: 2n,
  };
  const account = await createPassportAccounts({
    ...w.ports,
    records: {
      exists: async () => true,
      read: async () => local,
      write: async (next) => {
        local = next;
      },
    },
    grantDetails: {
      readGrant: async (_account, grantId) => ({
        active: w.activeGrantIds.includes(grantId),
        read: true,
        authNonce: w.grantNonce(),
      }),
    },
  }).openAccount();
  return {
    w,
    account,
    revokedId,
    survivingId,
    revokedReader,
    survivingReader,
    local: () => local,
    setLocal: (
      /** @type {import('../packages/account/dist/ports/index.js').AccountRecord} */ next,
    ) => {
      local = next;
    },
  };
}

test('read grant revocation refuses a mismatched local record before changing the key', async () => {
  const { w, account, revokedId, revokedReader, survivingReader, local, setLocal } =
    await readRevokeWorld();
  assert.ok(account.revokeGrant);
  const before = hex(w.encKey());
  setLocal({ ...local(), credentialId: new Uint8Array([99]) });
  await assert.rejects(account.revokeGrant(revokedId), { code: 'NotAuthorised' });
  assert.equal(hex(w.encKey()), before);
  assert.ok(!w.calls.includes('rotate_enc_key_with_jubjub'));
  revokedReader.secretKey.fill(0);
  survivingReader.secretKey.fill(0);
});

test('read grant revocation rotates first and excludes the revoked reader from new seals', async () => {
  const { w, account, revokedId, survivingId, revokedReader, survivingReader, local } =
    await readRevokeWorld();
  assert.ok(account.revokeGrant);
  const before = hex(w.encKey());
  const result = await account.revokeGrant(revokedId);
  assert.equal(result.status, 'revoked');
  assert.ok(result.rotation);
  assert.notEqual(hex(w.encKey()), before);
  assert.ok(!result.rotation.sealedReadGrants.some(({ grantId }) => grantId === revokedId));
  assert.deepEqual(
    result.rotation.sealedReadGrants.map(({ grantId }) => grantId),
    [survivingId],
  );
  assert.ok(!w.activeGrantIds.includes(revokedId));
  assert.ok(w.activeGrantIds.includes(survivingId));
  assert.equal(local().localUseCounter, result.nextUseCounter);
  assert.equal(w.calls.at(-1), 'revoke_grant_with_jubjub');
  assert.equal(w.sessionFlows.at(-1)?.kind, 'revoke-grant');
  assert.equal(w.sessionFlows.at(-1)?.read, true);
  revokedReader.secretKey.fill(0);
  survivingReader.secretKey.fill(0);
});

test('read grant revocation can retry after the key switch lands but the revoke call fails', async () => {
  const { w, account, revokedId, survivingId, revokedReader, survivingReader } =
    await readRevokeWorld();
  assert.ok(account.revokeGrant);
  const before = hex(w.encKey());
  w.interruptGrantRevoke();
  await assert.rejects(account.revokeGrant(revokedId), { code: 'InternalError' });
  assert.notEqual(hex(w.encKey()), before);
  assert.ok(w.activeGrantIds.includes(revokedId));
  const retried = await account.revokeGrant(revokedId);
  assert.equal(retried.status, 'revoked');
  assert.ok(retried.rotation);
  assert.ok(!retried.rotation.sealedReadGrants.some(({ grantId }) => grantId === revokedId));
  assert.deepEqual(
    retried.rotation.sealedReadGrants.map(({ grantId }) => grantId),
    [survivingId],
  );
  revokedReader.secretKey.fill(0);
  survivingReader.secretKey.fill(0);
});

test('JubJub removal can resume after the key switch lands but the removal call fails', async () => {
  const w = world();
  const account = await w.accounts.createAccount({ userName: 'alice', retireAuthority: true });
  const { entry } = await w.addRemoteDevice();
  const before = hex(w.encKey());
  w.interruptRemoval();
  assert.ok(account.removeDevice);
  await assert.rejects(account.removeDevice(hex(entry)), { code: 'InternalError' });
  assert.notEqual(hex(w.encKey()), before);
  assert.equal((await account.state()).entryCount, 2);
  const reopened = await w.accounts.openAccount();
  assert.ok(reopened.removeDevice);
  const result = await reopened.removeDevice(hex(entry));
  assert.equal(result.removedCommitmentHex, hex(entry));
  assert.equal((await reopened.state()).entryCount, 1);
});

test('JubJub rotation refuses unverified holdings and a missing custody port before calls', async () => {
  const w = world();
  const account = await w.accounts.createAccount({ userName: 'alice', retireAuthority: true });
  assert.ok(account.rotateViewingKey);
  w.setHeldIndices([0]);
  await assert.rejects(account.rotateViewingKey(), { code: 'InternalError' });
  assert.equal(w.calls.length, 3);
  const without = await w.withoutHoldings().openAccount();
  assert.ok(without.rotateViewingKey);
  await assert.rejects(without.rotateViewingKey(), { code: 'BindingUnsupported' });
  assert.equal(w.calls.length, 3);
});

test('JubJub rotation refuses a concurrent ACC key change before its key switch', async () => {
  const w = world();
  const account = await w.accounts.createAccount({ userName: 'alice', retireAuthority: true });
  assert.ok(account.rotateViewingKey);
  w.tamperKeyAfterNextAppend();
  await assert.rejects(account.rotateViewingKey(), { code: 'EncryptionKeyMismatch' });
  assert.equal(w.calls.at(-1), 'append_inbox_with_jubjub');
});

test('JubJub rotation re-encrypts a verified holding under the new ACC key', async () => {
  const w = world();
  const account = await w.accounts.createAccount({ userName: 'alice', retireAuthority: true });
  const coin = { nonce: new Uint8Array(32).fill(4), color: new Uint8Array(32).fill(5), value: 7n };
  w.inbox.push(await sealInboxCoin(w.encKey(), coin));
  w.setHeldIndices([2]);
  assert.ok(account.rotateViewingKey);
  await account.rotateViewingKey();
  assert.deepEqual(w.calls.slice(3), [
    'append_inbox_with_jubjub',
    'rotate_enc_key_with_jubjub',
    'append_inbox_with_jubjub',
  ]);
  const newest = w.inbox.at(-1);
  assert.ok(newest);
  const [opened] = await w.viewingKey.openInbox(
    'undeployed',
    { account: address, encKey: w.encKey(), envelopes: [...w.inbox].reverse() },
    [newest],
  );
  assert.deepEqual(opened, { kind: 'coin', coin });
});

test('opened JubJub accounts read only chain-confirmed shielded holdings', async () => {
  const w = world();
  const account = await w.accounts.createAccount({ userName: 'alice', retireAuthority: true });
  assert.ok(account.readShieldedHoldings);
  assert.deepEqual(await account.readShieldedHoldings(), []);
  const coin = { nonce: new Uint8Array(32).fill(4), color: new Uint8Array(32).fill(5), value: 7n };
  w.inbox.push(await sealInboxCoin(w.encKey(), coin));
  w.setHeldIndices([2]);
  assert.deepEqual(await account.readShieldedHoldings(), [{ inboxIndex: 2, coin }]);
  w.setHeldIndices([0]);
  await assert.rejects(account.readShieldedHoldings(), { code: 'InternalError' });
});

test('a JubJub account without chain-backed holding verification refuses the read', async () => {
  const w = world();
  await w.accounts.createAccount({ userName: 'alice', retireAuthority: true });
  const account = await w.withoutHoldings().openAccount();
  assert.ok(account.readShieldedHoldings);
  await assert.rejects(account.readShieldedHoldings(), { code: 'BindingUnsupported' });
});

test('JubJub rotation refuses an inbox entry that lands while new keys are delivered', async () => {
  const w = world();
  const account = await w.accounts.createAccount({ userName: 'alice', retireAuthority: true });
  assert.ok(account.rotateViewingKey);
  w.addInboxAfterNextAppend();
  await assert.rejects(account.rotateViewingKey(), { code: 'InternalError' });
  assert.equal(w.calls.at(-1), 'append_inbox_with_jubjub');
});

test('JubJub rotation preserves unshielded grant records', async () => {
  const w = world();
  const account = await w.accounts.createAccount({ userName: 'alice', retireAuthority: true });
  const records = await w.viewingKey.sealGrant('undeployed', address, {
    grantId: 'ab'.repeat(32),
    slot: 1,
    scopeSalt: 'bc'.repeat(32),
    granteePublicKey: 'cd'.repeat(32),
    object: { color: 'ef'.repeat(32), recipient: { kind: 'any' }, maxCoinValue: '1' },
  });
  w.inbox.push(...records);
  assert.ok(account.rotateViewingKey);
  const result = await account.rotateViewingKey();
  assert.deepEqual(result.unsealedGrantIds, []);
  assert.equal(w.calls.at(-1), 'rotate_enc_key_with_jubjub');
});

test('JubJub rotation seals the new secret to an active read grantee before the key switch', async () => {
  const w = world();
  const account = await w.accounts.createAccount({ userName: 'alice', retireAuthority: true });
  const grantee = x25519.keygen();
  const grantId = 'dc'.repeat(32);
  w.setReadGrantTargets([
    { grantId, readPublicKey: hex(grantee.publicKey) },
    { grantId: 'dd'.repeat(32) },
  ]);
  assert.ok(account.rotateViewingKey);
  const result = await account.rotateViewingKey();
  assert.deepEqual(result.unsealedGrantIds, ['dd'.repeat(32)]);
  assert.equal(result.sealedReadGrants[0]?.grantId, grantId);
  assert.deepEqual(w.calls.slice(3), [
    'append_inbox_with_jubjub',
    'append_inbox_with_jubjub',
    'rotate_enc_key_with_jubjub',
  ]);
  const entry = w.inbox.at(-1);
  assert.ok(entry);
  const [opened] = await w.viewingKey.openInbox(
    'undeployed',
    { account: address, encKey: w.encKey(), envelopes: [...w.inbox].reverse() },
    [entry],
  );
  assert.equal(opened?.kind, 'grant');
  assert.equal(opened.record.part, 'view');
  assert.equal(opened.record.grantId, grantId);
  assert.equal(hex(result.sealedReadGrants[0].seal), opened.record.seal);
  grantee.secretKey.fill(0);
});

test('JubJub rotation requires a complete chain-backed read-grant source', async () => {
  const w = world();
  await w.accounts.createAccount({ userName: 'alice', retireAuthority: true });
  const account = await w.withoutReadGrants().openAccount();
  assert.ok(account.rotateViewingKey);
  await assert.rejects(account.rotateViewingKey(), { code: 'BindingUnsupported' });
  assert.equal(w.calls.length, 3);
});

test('JubJub rotation refuses a read grant added while envelopes land', async () => {
  const w = world();
  const account = await w.accounts.createAccount({ userName: 'alice', retireAuthority: true });
  const oldKey = hex(w.encKey());
  w.changeReadGrantsAfterNextAppend();
  assert.ok(account.rotateViewingKey);
  await assert.rejects(account.rotateViewingKey(), { code: 'GrantRosterUnsettled' });
  assert.equal(hex(w.encKey()), oldKey);
  assert.equal(w.calls.at(-1), 'append_inbox_with_jubjub');
});
