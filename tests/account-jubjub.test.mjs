import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sha256 } from '@noble/hashes/sha2.js';
import { pureCircuits } from '../packages/contract/generated/acc-s3r1.1/index.js';
import { createPassportAccounts } from '../packages/account/dist/index.js';
import { recipeDeviceKeyring, recipeJubjubAuthoriser } from '../packages/keys/dist/index.js';

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
  const authoriser = recipeJubjubAuthoriser(source, pureCircuits);
  const chain = {
    async readAccount(
      /** @type {string} */ at,
      /** @type {{includeInbox?: boolean}} */ options = {},
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
        specVersion: 2,
        encKey,
        ...(options.includeInbox && { inboxEntries: [...inbox] }),
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
    writes,
    inbox,
    hint: () => hint,
    setHint: (/** @type {typeof hint} */ value) => (hint = value),
    interruptActivation: () => (failActivation = true),
    interruptSecondAppend: () => (failSecondAppend = true),
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
  assert.equal((await w.accounts.openAccount()).address, address);
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
