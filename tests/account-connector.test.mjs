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

/**
 * @typedef {{ booted: boolean; authNonce: bigint; deviceEpoch: bigint; entries: Uint8Array[] }} Ledger
 * @typedef {{ failActivationOnce?: boolean; failActiveRegistryPutOnce?: boolean; failDeployedPuts?: number; owns?: boolean }} WorldOptions
 */

const ADDRESS = 'cd'.repeat(32);
const OTHER_ADDRESS = 'ef'.repeat(32);
/** Another passkey's key: its entries never match this world's passkey. */
const OTHER_PK = { x: 99n, y: 98n, identity: false };

/** @param {WorldOptions} [options] */
function world({
  failActivationOnce = false,
  failActiveRegistryPutOnce = false,
  failDeployedPuts = 0,
  owns,
} = {}) {
  const credential = {
    credentialId: Uint8Array.of(7),
    publicKey: { x: 11n, y: 13n, identity: false },
    policy: { rp_id_hash: new Uint8Array(32), origin: enc('http://localhost:5173') },
  };
  /** @type {Ledger} */
  const ledger = { booted: false, authNonce: 0n, deviceEpoch: 0n, entries: [] };
  /** Ledgers by address; an address missing here holds no contract. */
  /** @type {Map<string, Ledger>} */
  const ledgers = new Map();
  /** @type {Map<string, Rec>} */
  const registry = new Map();
  /** @type {unknown[][]} */
  const log = [];
  let failNext = failActivationOnce;
  let failPutNext = failActiveRegistryPutOnce;
  const chain = {
    /** @param {{ boot: Uint8Array; encKey: Uint8Array }} args */
    async deploy(args) {
      log.push(['deploy', args.boot, args.encKey]);
      ledgers.set(ADDRESS, ledger);
      return { address: ADDRESS, txHashes: ['t0'] };
    },
    /** @param {string} address */
    async readLedger(address) {
      log.push(['readLedger', address]);
      const l = ledgers.get(address);
      if (!l) return undefined;
      return {
        booted: l.booted,
        authNonce: l.authNonce,
        deviceEpoch: l.deviceEpoch,
        entryCount: l.entries.length,
        specVersion: 2,
        hasEntry: (/** @type {Uint8Array} */ e) => l.entries.some((x) => eq(x, e)),
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
      identify: async () => ({
        credentialId: credential.credentialId,
        /** @param {Pk & { y: bigint }} pk */
        owns: (pk) => owns ?? (pk.x === credential.publicKey.x && pk.y === credential.publicKey.y),
      }),
      sign: async (/** @type {unknown} */ _c, /** @type {Uint8Array} */ challenge) => {
        log.push(['sign', new TextDecoder().decode(challenge)]);
        return { authenticator_data: new Uint8Array(37), sig: { r: 1n, s: 2n } };
      },
    },
    registry: {
      put: async (/** @type {string} */ n, /** @type {Rec} */ r) => {
        log.push(['put', r.status]);
        if (r.status === 'deployed' && failDeployedPuts > 0) {
          failDeployedPuts--;
          throw new Error('registry down');
        }
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
    encryptionKey: async (/** @type {unknown} */ _credential) => new Uint8Array(32).fill(5),
  };
  return { seams, credential, ledger, ledgers, registry, log };
}

/**
 * Plants a registry record for this world's passkey, as a stale or poisoned registry could hold it.
 * @param {ReturnType<typeof world>} w
 * @param {{ address: string; status: string; publicKey?: { x: bigint; y: bigint; identity: boolean }; credentialId?: Uint8Array }} fields
 */
function plant(w, fields) {
  const record = {
    ...w.credential,
    salt: new Uint8Array(32).fill(3),
    ...fields,
  };
  w.registry.set(`undeployed/${w.credential.credentialId}`, record);
}

/** A booted ledger whose only entry is another passkey's. @returns {Ledger} */
const bootedByOther = () => ({
  booted: true,
  authNonce: 0n,
  deviceEpoch: 0n,
  entries: [pureCircuits.derive_device_entry_with_p256(null, OTHER_PK, null, 0n, 0n)],
});

/** @param {ReturnType<typeof world>} w @param {string} name */
const count = (w, name) => w.log.filter((l) => l[0] === name).length;
/** @param {ReturnType<typeof world>} w */
const statusOf = (w) =>
  /** @type {Rec} */ (w.registry.get(`undeployed/${w.credential.credentialId}`)).status;

test('createAccount deploys, activates, records, and reports progress in order', async () => {
  const w = world();
  /** @type {string[]} */
  const steps = [];
  const account = await a
    .createPassportConnector(w.seams)
    .createAccount({ userName: 'u', onProgress: (/** @type {string} */ s) => steps.push(s) });
  assert.deepEqual(steps, ['passkey-created', 'deploying', 'deployed', 'activating', 'active']);
  assert.equal(account.address, ADDRESS);
  assert.equal(/** @type {Rec} */ ([...w.registry.values()][0]).status, 'active');
  assert.equal((await account.state()).booted, true);
});

test('the encryption key comes from the created passkey, before anything deploys', async () => {
  const w = world();
  /** @type {unknown[]} */
  const asked = [];
  w.seams.encryptionKey = async (/** @type {unknown} */ credential) => {
    asked.push(credential);
    return new Uint8Array(32).fill(6);
  };
  await a.createPassportConnector(w.seams).createAccount({ userName: 'u' });
  assert.deepEqual(asked, [w.credential]);
  assert.deepEqual(w.log.find((l) => l[0] === 'deploy')?.[2], new Uint8Array(32).fill(6));

  // A passkey without PRF fails before the deploy: nothing on chain, nothing registered.
  const fails = world();
  fails.seams.encryptionKey = async () => {
    throw new a.PassportConnectorError('UnsupportedAuthenticator', 'no PRF');
  };
  await assert.rejects(a.createPassportConnector(fails.seams).createAccount({ userName: 'u' }), {
    code: 'UnsupportedAuthenticator',
  });
  assert.equal(count(fails, 'deploy'), 0);
  assert.equal(fails.registry.size, 0);
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

test('R10(b): an active record pointing at another account is AccountNotFound, with no prompt or call', async () => {
  const w = world();
  w.ledgers.set(OTHER_ADDRESS, bootedByOther());
  plant(w, { address: OTHER_ADDRESS, status: 'active' });
  await assert.rejects(a.createPassportConnector(w.seams).openAccount(), {
    code: 'AccountNotFound',
    message: /does not hold this passkey/,
  });
  assert.equal(count(w, 'sign'), 0);
  assert.equal(count(w, 'activate_initial_device_with_p256'), 0);
  assert.equal(count(w, 'rotate_enc_key_with_p256'), 0);
});

test('R10(b): an active record whose address holds no contract is AccountNotFound', async () => {
  const w = world();
  plant(w, { address: OTHER_ADDRESS, status: 'active' });
  await assert.rejects(a.createPassportConnector(w.seams).openAccount(), {
    code: 'AccountNotFound',
    message: /No contract at/,
  });
  assert.equal(count(w, 'sign'), 0);
});

test('R10(b): a deployed record on a ledger booted with another key stays deployed and is not activated', async () => {
  const w = world();
  w.ledgers.set(OTHER_ADDRESS, bootedByOther());
  plant(w, { address: OTHER_ADDRESS, status: 'deployed' });
  await assert.rejects(a.createPassportConnector(w.seams).openAccount(), {
    code: 'AccountNotFound',
    message: /does not hold this passkey/,
  });
  assert.equal(statusOf(w), 'deployed');
  assert.equal(count(w, 'activate_initial_device_with_p256'), 0);
});

test('R10(b): a record the picked passkey does not own is AccountNotFound before any ledger read', async () => {
  const w = world({ owns: false });
  plant(w, { address: ADDRESS, status: 'active' });
  await assert.rejects(a.createPassportConnector(w.seams).openAccount(), {
    code: 'AccountNotFound',
    message: /does not belong to this passkey/,
  });
  assert.equal(count(w, 'readLedger'), 0);
});

test("R10(b): a record naming another account's key is refused, though that key's entry is live", async () => {
  const w = world();
  w.ledgers.set(OTHER_ADDRESS, bootedByOther());
  plant(w, { address: OTHER_ADDRESS, status: 'active', publicKey: OTHER_PK });
  await assert.rejects(a.createPassportConnector(w.seams).openAccount(), {
    code: 'AccountNotFound',
    message: /does not belong to this passkey/,
  });
  assert.equal(count(w, 'readLedger'), 0);
});

test('R10(b): a record filed under another credential id is refused', async () => {
  const w = world();
  plant(w, { address: ADDRESS, status: 'active', credentialId: Uint8Array.of(8) });
  await assert.rejects(a.createPassportConnector(w.seams).openAccount(), {
    code: 'AccountNotFound',
    message: /does not belong to this passkey/,
  });
});

test('M2: the deployed registry write is retried, so a brief outage after deploy loses nothing', async () => {
  const w = world({ failDeployedPuts: 2 });
  const account = await a.createPassportConnector(w.seams).createAccount({ userName: 'u' });
  assert.deepEqual(
    w.log.filter((l) => l[0] === 'put').map((l) => l[1]),
    ['deployed', 'deployed', 'deployed', 'active'],
  );
  assert.equal(statusOf(w), 'active');
  assert.equal((await account.state()).booted, true);
  assert.equal(count(w, 'deploy'), 1, 'never redeploys');
});

test('M2: a registry that stays down fails after the retries, naming the deployed address', async () => {
  const w = world({ failDeployedPuts: a.DEPLOYED_PUT_RETRIES + 1 });
  await assert.rejects(a.createPassportConnector(w.seams).createAccount({ userName: 'u' }), {
    code: 'InternalError',
    message: new RegExp(
      `${ADDRESS} is deployed, but the registry did not record it after 4 attempts`,
    ),
  });
  assert.equal(count(w, 'put'), a.DEPLOYED_PUT_RETRIES + 1);
  assert.equal(count(w, 'activate_initial_device_with_p256'), 0, 'no activation without a record');
});
