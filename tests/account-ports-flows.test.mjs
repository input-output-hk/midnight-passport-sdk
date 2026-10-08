// createPassportAccounts over plain port objects, with no seams: the flows, the lazy ports and the
// arm checks. The deprecated createPassportConnector runs the same flows through its bridge, and
// account-connector*.test.mjs hold it to the prototype's behaviour unchanged.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const a = await import(new URL('../packages/account/dist/index.js', import.meta.url).href);

/**
 * @typedef {import('../packages/account/dist/ports/index.js').AccountHint} AccountHint
 * @typedef {import('../packages/account/dist/ports/index.js').AccountDirectory} AccountDirectory
 * @typedef {import('../packages/account/dist/ports/index.js').AccLedgerView} AccLedgerView
 * @typedef {import('../packages/account/dist/ports/index.js').Chain} Chain
 * @typedef {import('../packages/account/dist/ports/index.js').PassportPorts} PassportPorts
 * @typedef {import('../packages/account/dist/ports/index.js').P256PublicKey} P256PublicKey
 * @typedef {import('../packages/account/dist/ports/index.js').WebAuthnPolicy} WebAuthnPolicy
 */

/**
 * Plain port objects for one P-256 passkey, with no seams: an in-memory directory and a ledger
 * whose entries are `${pk.x}:${counter}`.
 */
function portsWorld() {
  const enc = (/** @type {string} */ s) => new TextEncoder().encode(s);
  const text = (/** @type {Uint8Array} */ b) => new TextDecoder().decode(b);
  const credentialId = Uint8Array.of(7);
  /** @type {P256PublicKey} */
  const publicKey = { x: 11n, y: 13n, identity: false };
  /** @type {WebAuthnPolicy} */
  const policy = { rp_id_hash: new Uint8Array(32), origin: enc('http://localhost:5173') };
  const ledger = { booted: false, authNonce: 0n, entries: new Set(/** @type {string[]} */ ([])) };
  /** @type {Map<string, AccountHint>} */
  const hints = new Map();
  /** @type {unknown[][]} */
  const log = [];
  const loads = { binding: 0, chain: 0 };
  /** @type {Chain} */
  const chain = {
    async call({ circuit, args }) {
      log.push(['call', circuit, args]);
      if (circuit === 'activate_initial_device_with_p256') {
        ledger.booted = true;
        ledger.entries.add(`${publicKey.x}:0`);
      } else {
        const auth = /** @type {{ use_counter: bigint }} */ (args[1]);
        ledger.entries.delete(`${publicKey.x}:${auth.use_counter}`);
        ledger.entries.add(`${publicKey.x}:${auth.use_counter + 1n}`);
        ledger.authNonce += 1n;
      }
      return { txHash: `tx-${log.length}` };
    },
    async readAccount() {
      /** @type {AccLedgerView} */
      const view = {
        booted: ledger.booted,
        authNonce: ledger.authNonce,
        deviceEpoch: 0n,
        entryCount: ledger.entries.size,
        specVersion: 3,
        hasEntry: (entry) => ledger.entries.has(text(entry)),
      };
      return view;
    },
  };
  /** @type {AccountDirectory} */
  const directory = {
    async get(networkId, key) {
      log.push(['get', networkId, key.kind]);
      return hints.get(text(key.credentialId));
    },
    async put(_networkId, hint) {
      log.push(['put', hint.status, hint.scheme]);
      hints.set(text(hint.credentialId ?? new Uint8Array()), hint);
    },
  };
  /** @type {PassportPorts} */
  const ports = {
    network: {
      networkId: 'undeployed',
      indexerUrl: '',
      indexerWsUrl: '',
      nodeUrl: '',
      artefactUrl: '',
      bindingId: 'acc-test',
      manifestSha256: '00',
    },
    binding: async () => {
      loads.binding++;
      return {
        pureCircuits: {
          derive_boot_commitment_with_p256: (salt) => enc(`boot:${salt.length}`),
          derive_device_entry_with_p256: (_self, pk, _policy, _epoch, counter) =>
            enc(`${pk.x}:${counter}`),
          challenge_rotate_enc_key_with_p256: (_self, _pk, key, nonce) =>
            enc(`rot:${key[0]}:${nonce}`),
        },
      };
    },
    credentials: {
      create: async ({ name }) => {
        log.push(['create', name]);
        return { credentialId };
      },
      identify: async () => ({
        credentialId,
        owns: (key, keyPolicy) => key.x === publicKey.x && keyPolicy === policy,
      }),
    },
    authoriser: {
      scheme: 'p256-webauthn',
      devicePublicKey: async () => ({ x: publicKey.x, y: publicKey.y }),
      deviceBinding: async () => ({ policy, credentialId }),
      async authorise(request) {
        log.push(['authorise', request.circuit, request.credentialId, request.useCounter]);
        assert.ok(request.challenge instanceof Uint8Array);
        return {
          scheme: 'p256-webauthn',
          pk: publicKey,
          useCounter: request.useCounter,
          authenticatorData: new Uint8Array(37),
          sig: { r: 1n, s: 2n },
        };
      },
    },
    encryptionKey: { publicKey: async (networkId) => enc(networkId.padEnd(32, '.')) },
    chain: async () => {
      loads.chain++;
      return chain;
    },
    deployer: {
      async deploy(request) {
        log.push(['deploy', request.retireAuthority, text(request.encKey)]);
        return { address: 'cd'.repeat(32), txIds: ['t0'] };
      },
    },
    directory,
  };
  return { ports, log, loads, hints, credentialId };
}

test('createPassportAccounts runs create, rotate and open over plain ports, loading lazy ports once', async () => {
  const w = portsWorld();
  const accounts = a.createPassportAccounts(w.ports);
  assert.equal(accounts.networkId, 'undeployed');
  const created = await accounts.createAccount({ userName: 'u' });
  assert.equal(created.bindingId, 'acc-test');
  assert.deepEqual(created.credentialId, w.credentialId);
  await created.rotateEncryptionKey(Uint8Array.of(1));
  const opened = await a.createPassportAccounts(w.ports).openAccount();
  assert.equal(opened.address, created.address);
  await opened.rotateEncryptionKey(Uint8Array.of(2));

  assert.deepEqual(
    w.log.map((l) => l.slice(0, 2)),
    [
      ['create', 'u'],
      ['deploy', true],
      ['put', 'deployed'],
      ['call', 'activate_initial_device_with_p256'],
      ['put', 'active'],
      ['authorise', 'rotate_enc_key_with_p256'],
      ['call', 'rotate_enc_key_with_p256'],
      ['get', 'undeployed'],
      ['authorise', 'rotate_enc_key_with_p256'],
      ['call', 'rotate_enc_key_with_p256'],
    ],
  );
  assert.equal(w.log[1]?.[2], 'undeployed'.padEnd(32, '.'), 'the key for this network');
  assert.equal(w.log[2]?.[2], 'p256-webauthn', 'hints name their arm');
  assert.deepEqual(w.log[7]?.[2], 'credential-id');
  // The second rotation scanned the rolled counter, and each ceremony is pinned to the account.
  assert.deepEqual(w.log[8]?.slice(2), [w.credentialId, 1n]);
  // A key given as a bare point reaches the circuits as a P-256 key.
  const activation = /** @type {unknown[]} */ (w.log[3]?.[2]);
  assert.deepEqual(activation[0], { x: 11n, y: 13n, identity: false });
  // One load per connector for each lazy port.
  assert.deepEqual(w.loads, { binding: 2, chain: 2 });
});

test('createPassportAccounts refuses an arm this release cannot drive, before any prompt', () => {
  const w = portsWorld();
  const { deviceBinding: _binding, ...unbound } = w.ports.authoriser;
  for (const authoriser of [{ ...w.ports.authoriser, scheme: 'jubjub-schnorr' }, unbound]) {
    assert.throws(() => a.createPassportAccounts({ ...w.ports, authoriser }), {
      code: 'BindingUnsupported',
    });
  }
  assert.equal(w.log.length, 0);
});

test('a directory hint of another arm does not belong to the picked passkey', async () => {
  const w = portsWorld();
  await a.createPassportAccounts(w.ports).createAccount({ userName: 'u' });
  const [key, hint] = [...w.hints][0] ?? [];
  w.hints.set(/** @type {string} */ (key), {
    .../** @type {AccountHint} */ (hint),
    scheme: 'jubjub-schnorr',
  });
  await assert.rejects(a.createPassportAccounts(w.ports).openAccount(), {
    code: 'AccountNotFound',
    message: /does not belong to this passkey/,
  });
});

test('a failed lazy load is retried on the next use', async () => {
  const w = portsWorld();
  const load = w.ports.chain;
  let failures = 1;
  const accounts = a.createPassportAccounts({
    ...w.ports,
    chain: async () => {
      if (failures-- > 0) throw new Error('chunk failed to load');
      return typeof load === 'function' ? load() : load;
    },
  });
  await assert.rejects(accounts.createAccount({ userName: 'u' }), { message: /chunk failed/ });
  // The deploy ran before the chain was needed; a retry of the flow loads the chain again.
  const opened = await accounts.openAccount();
  assert.equal((await opened.state()).booted, true);
});
