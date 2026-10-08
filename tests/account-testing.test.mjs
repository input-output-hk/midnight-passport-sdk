// The port contract suites of account/testing, run against the fakes, the bridge's seam-to-port
// adapters, the registry client behind a fake fetch, and lace-platform-shaped objects. A suite
// that cannot fail proves nothing, so two broken adapters must fail theirs.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { laceAuthoriser, laceFeeSponsor } from './fixtures/lace-seams.mjs';

const a = await import(new URL('../packages/account/dist/index.js', import.meta.url).href);
const t = await import(new URL('../packages/account/dist/testing/index.js', import.meta.url).href);

/**
 * @typedef {import('../packages/account/dist/testing/index.js').FakePorts} FakePorts
 * @typedef {import('../packages/account/dist/ports/index.js').PassportPorts} PassportPorts
 * @typedef {import('../packages/account/dist/ports/index.js').P256PublicKey} P256PublicKey
 * @typedef {import('../packages/account/dist/ports/index.js').WebAuthnPolicy} WebAuthnPolicy
 * @typedef {import('../packages/account/dist/seams.js').PassportSeams} PassportSeams
 * @typedef {import('../packages/account/dist/seams.js').AccountRecord} AccountRecord
 * @typedef {import('../packages/account/dist/index.js').FetchLike} FetchLike
 */

const host = { test, assert };
const ERA = t.FAKE_ERA;
const proven = (/** @type {Record<string, unknown>} */ fields = {}) =>
  t.fakeTx({ era: ERA, stage: 'proven', ...fields });

/**
 * Deploys and activates an account through P-256 ports, then builds each gated call (a rotation)
 * from the ledger as it reads: the counter scan, the challenge at auth_nonce, the signature.
 * @param {Pick<PassportPorts, 'authoriser' | 'deployer'> & { chain: any; binding: any }} ports
 */
async function chainFixture({ authoriser, deployer, chain, binding }) {
  const { pureCircuits } = binding;
  const pk = { ...(await authoriser.devicePublicKey()), identity: false };
  const { policy, credentialId } = await /** @type {any} */ (authoriser).deviceBinding();
  const salt = new Uint8Array(32).fill(1);
  const boot = pureCircuits.derive_boot_commitment_with_p256(salt, pk, policy);
  const deploy = { boot, encKey: new Uint8Array(32), retireAuthority: true };
  const { address } = await deployer.deploy(deploy);
  await chain.call({
    address,
    circuit: 'activate_initial_device_with_p256',
    args: [pk, salt, policy],
  });
  const self = { bytes: Buffer.from(address, 'hex') };
  const circuit = 'rotate_enc_key_with_p256';
  return {
    chain,
    address,
    async gatedCall() {
      const view = await chain.readAccount(address);
      const entry = (/** @type {bigint} */ k) =>
        pureCircuits.derive_device_entry_with_p256(self, pk, policy, view.deviceEpoch, k);
      let k = 0n;
      while (k < 64n && !view.hasEntry(entry(k))) k++;
      const newKey = new Uint8Array(32).fill(Number(k) + 2);
      const authNonce = view.authNonce;
      const challenge = pureCircuits.challenge_rotate_enc_key_with_p256(
        self,
        pk,
        newKey,
        authNonce,
      );
      const signed = await authoriser.authorise({
        ...{ account: address, circuit, args: [newKey], witnessValues: [], authNonce },
        ...{ useCounter: k, challenge, credentialId },
      });
      const { authenticatorData: authenticator_data, sig } = /** @type {any} */ (signed);
      const auth = { pk, policy, authenticator_data, sig, use_counter: k };
      return { address, circuit, args: [newKey, auth] };
    },
  };
}

/**
 * The prototype's seams over one world of fakes, so the bridge's port adapters run on them.
 * @param {FakePorts} fake
 * @returns {PassportSeams}
 */
function seamsOver(fake) {
  const credential = async () => ({
    ...(await fake.authoriser.deviceBinding?.()),
    publicKey: { ...(await fake.authoriser.devicePublicKey()), identity: false },
  });
  return /** @type {PassportSeams} */ ({
    networkId: fake.network.networkId,
    bindingId: fake.network.bindingId,
    pureCircuits: fake.binding.pureCircuits,
    passkey: {
      create: async (name) => (await fake.credentials.create({ name }), credential()),
      identify: () => fake.credentials.identify(),
      async sign({ credentialId }, challenge) {
        const signed = await fake.authoriser.authorise({
          ...{ account: '', circuit: '', args: [], witnessValues: [], authNonce: 0n },
          ...{ useCounter: 0n, challenge, credentialId },
        });
        const { authenticatorData, sig } = /** @type {any} */ (signed);
        return { authenticator_data: authenticatorData, sig };
      },
    },
    chain: {
      async deploy(args) {
        const { address, txIds } = await fake.deployer.deploy(args);
        return { address, txHashes: txIds };
      },
      readLedger: (address) => fake.chain.readAccount(address),
      call: (address, circuit, args, options) =>
        fake.chain.call({ address, circuit, args, ...options }),
    },
    registry: {
      put: (networkId, record) =>
        fake.directory.put(networkId, { scheme: 'p256-webauthn', ...record }),
      async get(networkId, credentialId) {
        const hint = await fake.directory.get(networkId, { kind: 'credential-id', credentialId });
        return hint && /** @type {AccountRecord} */ (/** @type {unknown} */ (hint));
      },
    },
    random: fake.random,
    encryptionKey: () => fake.encryptionKey.publicKey(fake.network.networkId),
  });
}
/** The bridge's ports over a fresh world, its passkey created. */
async function bridge() {
  const fake = t.createFakePorts();
  const ports = a.portsFromSeams(seamsOver(fake));
  await ports.credentials.create({ name: 'u' });
  return { fake, ports };
}

/**
 * The service's /accounts rules (apps/passport-service routes/registry.ts) behind a fake fetch:
 * write-once on every field but the status, which moves from deployed to active only.
 * @returns {FetchLike}
 */
function registryFetch() {
  /** @type {Map<string, Record<string, unknown>>} */
  const store = new Map();
  const reply = (/** @type {number} */ status, /** @type {unknown} */ body = {}) => ({
    ...{ ok: status < 300, status },
    json: async () => body,
  });
  return async (url, init) => {
    const key = new URL(url).pathname;
    const held = store.get(key);
    if (init?.method !== 'PUT') return held ? reply(200, held) : reply(404);
    const record = JSON.parse(init.body ?? '{}');
    const fixed = (/** @type {Record<string, unknown>} */ r) => JSON.stringify({ ...r, status: 0 });
    const back = held?.status === 'active' && record.status !== 'active';
    if (held && (back || fixed(held) !== fixed(record))) return reply(409);
    store.set(key, record);
    return reply(204);
  };
}

describe('the fakes', () => {
  t.authoriserContract(() => t.fakeAuthoriser(), host);
  t.credentialContract(() => {
    const authoriser = t.fakeAuthoriser({ device: 1 });
    return { authoriser, credentials: t.fakeCredentials({ authoriser }) };
  }, host);
  t.proverContract(
    () => ({
      prover: t.fakeProver(),
      unproven: t.fakeTx({ era: ERA, stage: 'unproven' }),
      context: { networkId: 'undeployed', bindingId: 'acc-fake', circuits: ['activate'] },
      era: ERA,
      eraOf: (/** @type {Uint8Array} */ tx) => t.readFakeTx(tx)?.era,
    }),
    host,
  );
  t.feeSponsorContract(
    () => ({
      sponsor: t.fakeSponsor({ feesOnly: true }),
      unbalanced: proven(),
      nonFee: proven({ imbalance: 'transfer' }),
    }),
    host,
  );
  t.submitterContract(
    () => ({
      submitter: t.fakeSubmitter(),
      finalised: async () => t.fakeTx({ era: ERA, stage: 'balanced' }),
      unfinalised: proven(),
    }),
    host,
  );
  t.chainContract(() => chainFixture(t.createFakePorts()), host);
  t.deployerContract(() => {
    const fake = t.createFakePorts();
    const retired = async (/** @type {string} */ address) =>
      Boolean(fake.ledger.get(address)?.authorityRetired);
    return { deployer: fake.deployer, chain: fake.chain, authorityRetired: retired };
  }, host);
  t.directoryContract(() => t.fakeDirectory(), host);
});

describe("the bridge's seam-to-port adapters", () => {
  t.authoriserContract(async () => (await bridge()).ports.authoriser, host);
  t.credentialContract(async () => (await bridge()).ports, host);
  t.chainContract(async () => {
    const { fake, ports } = await bridge();
    return chainFixture({ ...ports, binding: fake.binding, chain: ports.chain });
  }, host);
  t.deployerContract(async () => {
    const { fake, ports } = await bridge();
    const retired = async (/** @type {string} */ address) =>
      Boolean(fake.ledger.get(address)?.authorityRetired);
    return {
      deployer: ports.deployer,
      chain: /** @type {any} */ (ports.chain),
      authorityRetired: retired,
    };
  }, host);
  t.directoryContract(async () => /** @type {any} */ ((await bridge()).ports.directory), host);
  // The registry client, through the bridge, against the service's rules behind a fake fetch.
  t.directoryContract(() => {
    const registry = a.createRegistryClient('http://registry.invalid', registryFetch());
    const seams = { ...seamsOver(t.createFakePorts()), registry };
    return /** @type {any} */ (a.portsFromSeams(seams).directory);
  }, host);
});

describe('lace-platform-shaped objects', () => {
  t.authoriserContract(() => laceAuthoriser(), host);
  t.feeSponsorContract(() => ({ sponsor: laceFeeSponsor(), unbalanced: proven() }), host);
});

test('the suites fail adapters that break their promises', async () => {
  /** @type {[string, () => Promise<void>][]} */
  const run = [];
  const capture = {
    test: (/** @type {string} */ n, /** @type {any} */ b) => run.push([n, b]),
    assert,
  };
  // A directory that overwrites, and an authoriser that signs with another device's key.
  /** @type {Map<string, unknown>} */
  const hints = new Map();
  t.directoryContract(
    () => ({
      get: async (/** @type {string} */ n, /** @type {any} */ k) => hints.get(n + k.credentialId),
      put: async (/** @type {string} */ n, /** @type {any} */ h) =>
        void hints.set(n + h.credentialId, h),
    }),
    capture,
  );
  t.authoriserContract(async () => {
    const [own, other] = [t.fakeAuthoriser(), t.fakeAuthoriser({ device: 1 })];
    return { ...own, authorise: (/** @type {any} */ r) => other.authorise(r) };
  }, capture);
  /** @type {string[]} */
  const failed = [];
  for (const [name, body] of run) await body().catch(() => failed.push(name));
  assert.deepEqual(failed, [
    'AccountDirectory: is write-once: the same hint again passes, a changed one is refused',
    'AccountDirectory: a hint moves from deployed to active, and never back',
    'Authoriser: authorises in its own arm, with its one device key, for the counter',
    'Authoriser: its signature verifies against devicePublicKey, for its challenge only',
  ]);
});

test('./testing is exported as its own subpath', async () => {
  const manifest = JSON.parse(
    await readFile(new URL('../packages/account/package.json', import.meta.url), 'utf8'),
  );
  assert.deepEqual(manifest.exports['./testing'], {
    types: './dist/testing/index.d.ts',
    default: './dist/testing/index.js',
  });
});
