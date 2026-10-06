import { test } from 'node:test';
import assert from 'node:assert/strict';

const a = await import(new URL('../packages/account/dist/index.js', import.meta.url).href);

/** @param {string} s */
const enc = (s) => new TextEncoder().encode(s);
/**
 * @param {Uint8Array} x
 * @param {Uint8Array} y
 */
const eq = (x, y) => x.length === y.length && x.every((v, i) => v === y[i]);
// Deterministic stand-ins for the generated module's pure circuits.
/** @typedef {{ x: bigint }} Pk */
/** @typedef {{ credentialId: Uint8Array; status: string }} Rec */
const pureCircuits = {
  /** @param {Uint8Array} salt @param {Pk} pk */
  derive_boot_commitment_with_p256: (salt, pk) => enc(`boot:${salt[0]}:${pk.x}`),
  /** @param {unknown} self @param {Pk} pk @param {unknown} _p @param {bigint} epoch @param {bigint} counter */
  derive_device_entry_with_p256: (self, pk, _p, epoch, counter) =>
    enc(`entry:${pk.x}:${epoch}:${counter}`),
  /** @param {unknown} _self @param {Pk} pk @param {Uint8Array} key @param {bigint} nonce */
  challenge_rotate_enc_key_with_p256: (_self, pk, key, nonce) =>
    enc(`rot:${pk.x}:${key[0]}:${nonce}`),
};

function world({ failActivationOnce = false, failActiveRegistryPutOnce = false } = {}) {
  const credential = {
    credentialId: Uint8Array.of(7),
    publicKey: { x: 11n, y: 13n, identity: false },
    policy: { rp_id_hash: new Uint8Array(32), origin: enc('http://localhost:5173') },
  };
  /** @type {{ booted: boolean; authNonce: bigint; deviceEpoch: bigint; entries: Uint8Array[] }} */
  const ledger = { booted: false, authNonce: 0n, deviceEpoch: 0n, entries: [] };
  /** @type {Map<string, Rec>} */
  const registry = new Map();
  /** @type {unknown[][]} */
  const log = [];
  let failNext = failActivationOnce;
  let failPutNext = failActiveRegistryPutOnce;
  const chain = {
    /** @param {{ boot: Uint8Array }} args */
    async deploy(args) {
      log.push(['deploy', args.boot]);
      return { address: 'cd'.repeat(32), txHashes: ['t0'] };
    },
    async readLedger() {
      return {
        booted: ledger.booted,
        authNonce: ledger.authNonce,
        deviceEpoch: ledger.deviceEpoch,
        entryCount: ledger.entries.length,
        specVersion: 2,
        hasEntry: (/** @type {Uint8Array} */ e) => ledger.entries.some((x) => eq(x, e)),
      };
    },
    /** @param {string} _addr @param {string} circuit @param {readonly unknown[]} args */
    async call(_addr, circuit, args) {
      log.push([circuit]);
      if (circuit === 'activate_initial_device_with_p256') {
        if (ledger.booted) throw new Error('already activated');
        if (failNext) {
          failNext = false;
          throw new Error('sponsor down');
        }
        ledger.booted = true;
        ledger.entries.push(
          pureCircuits.derive_device_entry_with_p256(
            null,
            /** @type {Pk} */ (args[0]),
            null,
            0n,
            0n,
          ),
        );
      } else {
        const auth = /** @type {{ pk: Pk; use_counter: bigint }} */ (args[1]);
        const current = pureCircuits.derive_device_entry_with_p256(
          null,
          auth.pk,
          null,
          0n,
          auth.use_counter,
        );
        assert.ok(
          ledger.entries.some((x) => eq(x, current)),
          'signed with a live entry',
        );
        ledger.entries = ledger.entries.filter((x) => !eq(x, current));
        ledger.entries.push(
          pureCircuits.derive_device_entry_with_p256(
            null,
            auth.pk,
            null,
            0n,
            auth.use_counter + 1n,
          ),
        );
        ledger.authNonce += 1n;
      }
      return { txHash: `tx-${log.length}` };
    },
  };
  const seams = {
    networkId: 'undeployed',
    bindingId: 'acc-45721e1',
    pureCircuits,
    chain,
    passkey: {
      create: async () => credential,
      identify: async () => ({ credentialId: credential.credentialId }),
      sign: async (/** @type {unknown} */ _c, /** @type {Uint8Array} */ challenge) => {
        log.push(['sign', new TextDecoder().decode(challenge)]);
        return { authenticator_data: new Uint8Array(37), sig: { r: 1n, s: 2n } };
      },
    },
    registry: {
      put: async (/** @type {string} */ n, /** @type {Rec} */ r) => {
        if (failPutNext && r.status === 'active') {
          failPutNext = false;
          throw new Error('registry down');
        }
        registry.set(`${n}/${r.credentialId}`, r);
      },
      get: async (/** @type {string} */ n, /** @type {Uint8Array} */ id) =>
        registry.get(`${n}/${id}`),
    },
    random: (/** @type {number} */ n) => new Uint8Array(n).fill(3),
    encryptionKey: () => new Uint8Array(32).fill(5),
  };
  return { seams, ledger, registry, log };
}

test('createAccount deploys, activates, records, and reports progress in order', async () => {
  const w = world();
  /** @type {string[]} */
  const steps = [];
  const account = await a
    .createPassportConnector(w.seams)
    .createAccount({ userName: 'u', onProgress: (/** @type {string} */ s) => steps.push(s) });
  assert.deepEqual(steps, ['passkey-created', 'deploying', 'deployed', 'activating', 'active']);
  assert.equal(account.address, 'cd'.repeat(32));
  assert.equal(/** @type {Rec} */ ([...w.registry.values()][0]).status, 'active');
  assert.equal((await account.state()).booted, true);
});

test('rotate twice: the second call rescans the rolled use counter', async () => {
  const w = world();
  const account = await a.createPassportConnector(w.seams).createAccount({ userName: 'u' });
  await account.rotateEncryptionKey(Uint8Array.of(1));
  await account.rotateEncryptionKey(Uint8Array.of(2));
  assert.deepEqual(
    w.log.filter((l) => l[0] === 'sign').map((l) => l[1]),
    ['rot:11:1:0', 'rot:11:2:1'],
  );
});

test('openAccount after a reload reopens the same account and can still rotate', async () => {
  const w = world();
  const first = await a.createPassportConnector(w.seams).createAccount({ userName: 'u' });
  await first.rotateEncryptionKey(Uint8Array.of(1));
  const reopened = await a.createPassportConnector(w.seams).openAccount();
  assert.equal(reopened.address, first.address);
  await reopened.rotateEncryptionKey(Uint8Array.of(3));
});

test('a failure after deploy leaves a deployed record that openAccount finishes', async () => {
  const w = world({ failActivationOnce: true });
  await assert.rejects(a.createPassportConnector(w.seams).createAccount({ userName: 'u' }));
  assert.equal(/** @type {Rec} */ ([...w.registry.values()][0]).status, 'deployed');
  const account = await a.createPassportConnector(w.seams).openAccount();
  assert.equal((await account.state()).booted, true);
  assert.equal(/** @type {Rec} */ ([...w.registry.values()][0]).status, 'active');
  assert.equal(w.log.filter((l) => l[0] === 'deploy').length, 1, 'never redeploys');
});

test('activation landed but the registry write failed: openAccount adopts the booted ledger without re-activating', async () => {
  const w = world({ failActiveRegistryPutOnce: true });
  await assert.rejects(a.createPassportConnector(w.seams).createAccount({ userName: 'u' }));
  assert.equal(/** @type {Rec} */ ([...w.registry.values()][0]).status, 'deployed');
  assert.equal(w.ledger.booted, true);
  const account = await a.createPassportConnector(w.seams).openAccount();
  assert.equal(/** @type {Rec} */ ([...w.registry.values()][0]).status, 'active');
  assert.equal((await account.state()).booted, true);
  assert.equal(w.log.filter((l) => l[0] === 'deploy').length, 1, 'never redeploys');
  assert.equal(
    w.log.filter((l) => l[0] === 'activate_initial_device_with_p256').length,
    1,
    'never re-activates',
  );
});

test('a deployed record on an unbooted ledger is activated once by openAccount', async () => {
  const w = world({ failActivationOnce: true });
  await assert.rejects(a.createPassportConnector(w.seams).createAccount({ userName: 'u' }));
  assert.equal(/** @type {Rec} */ ([...w.registry.values()][0]).status, 'deployed');
  assert.equal(w.ledger.booted, false);
  const activations = () =>
    w.log.filter((l) => l[0] === 'activate_initial_device_with_p256').length;
  const before = activations();
  await a.createPassportConnector(w.seams).openAccount();
  assert.equal(activations() - before, 1);
  assert.equal(w.ledger.booted, true);
  assert.equal(/** @type {Rec} */ ([...w.registry.values()][0]).status, 'active');
});

test('openAccount without a record is AccountNotFound', async () => {
  const w = world();
  await assert.rejects(a.createPassportConnector(w.seams).openAccount(), {
    code: 'AccountNotFound',
  });
});
