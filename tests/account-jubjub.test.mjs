import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sha256 } from '@noble/hashes/sha2.js';
import { x25519 } from '@noble/curves/ed25519.js';
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
  let counter = 0n;
  /** @type {Uint8Array} */
  let encKey = new Uint8Array(32);
  /** @type {Uint8Array} */
  let boot = new Uint8Array(32);
  let failActivation = false;
  let failSecondAppend = false;
  let tamperKeyAfterNextAppend = false;
  let addInboxAfterNextAppend = false;
  let changeReadGrantsAfterNextAppend = false;
  /** @type {number[]} */
  let selectedHoldings = [];
  /** @type {import('../packages/account/dist/ports/index.js').ActiveReadGrantTarget[]} */
  let activeReadGrants = [];
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
      return {
        booted,
        authNonce: nonce,
        deviceEpoch: 0n,
        entryCount: booted ? 1 : 0,
        specVersion: 3,
        encKey,
        ...(options.includeInbox && { inboxEntries: [...inbox] }),
        ...(options.includeDevices && { deviceEntries: booted ? [entry] : [] }),
        hasEntry: (/** @type {Uint8Array} */ candidate) => booted && hex(candidate) === hex(entry),
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
  return {
    accounts: createPassportAccounts(ports),
    calls,
    sessionFlows,
    writes,
    inbox,
    hint: () => hint,
    setHint: (/** @type {typeof hint} */ value) => (hint = value),
    setCounter: (/** @type {bigint} */ value) => (counter = value),
    setHeldIndices: (/** @type {number[]} */ value) => (selectedHoldings = value),
    setReadGrantTargets: (/** @type {typeof activeReadGrants} */ value) =>
      (activeReadGrants = value),
    encKey: () => encKey,
    viewingKey: ports.viewingKey,
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
