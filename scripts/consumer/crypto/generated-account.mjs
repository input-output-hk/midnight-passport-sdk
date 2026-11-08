import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';

/** @typedef {Awaited<ReturnType<import('./modules.mjs').loadCryptoModules>>} Modules */
/** @param {()=>Promise<unknown>} work */
const withSession = (work) => work();
export const syntheticKeySource = {
  withSession,
  deviceSecret: async () => Uint8Array.of(1, ...new Uint8Array(31)),
  deriveSecret: async () => new Uint8Array(32).fill(9),
};
/** @param {Uint8Array} bytes */
const hex = (bytes) => Buffer.from(bytes).toString('hex');

/** @param {Modules} modules @param {'jubjub'|'p256'} arm */
async function accountState(modules, arm) {
  const { binding, runtime, keys, webauthn } = modules;
  const authoriser = keys.recipeJubjubAuthoriser(syntheticKeySource, binding.pureCircuits);
  const jubjubPk = await authoriser.devicePublicKey();
  const policy = webauthn.webauthnPolicy('localhost', 'http://localhost:5173');
  const pair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const jwk = pair.publicKey.export({ format: 'jwk' });
  assert.ok(typeof jwk.x === 'string' && typeof jwk.y === 'string');
  const p256Pk = {
    x: BigInt('0x' + Buffer.from(jwk.x, 'base64url').toString('hex')),
    y: BigInt('0x' + Buffer.from(jwk.y, 'base64url').toString('hex')),
    identity: false,
  };
  const pk = arm === 'p256' ? p256Pk : jubjubPk;
  const contract = new binding.Contract({
    held_coin() {
      throw Error('No coins in this simulation');
    },
  });
  const address = runtime.sampleContractAddress();
  const self = { bytes: Uint8Array.from(Buffer.from(address, 'hex')) };
  const coin = { bytes: new Uint8Array(32).fill(7) },
    salt = new Uint8Array(32).fill(8);
  const pure = binding.pureCircuits;
  const boot =
    arm === 'p256'
      ? pure.derive_boot_commitment_with_p256(salt, pk, policy)
      : pure.derive_boot_commitment_with_jubjub(salt, pk);
  const initialized = await contract.initialState(
    runtime.createConstructorContext({}, coin),
    boot,
    new Uint8Array(32).fill(9),
    jubjubPk,
    new Uint8Array(64),
    60n,
  );
  let state = initialized.currentContractState;
  /** @param {string} name @param {unknown[]} args */
  const call = async (name, args) => {
    const context = runtime.createCircuitContext({
      circuitId: name,
      contractAddress: address,
      coinPublicKeyOrZswapState: coin,
      contractState: state,
      privateState: {},
      time: 1800000000,
    });
    const result = await contract.impureCircuits[name](context, ...args);
    state = result.context.callContext.currentQueryContext.state;
  };
  await call(`activate_initial_device_with_${arm}`, [
    pk,
    salt,
    ...(arm === 'p256' ? [policy] : []),
  ]);
  const ledger = () => binding.ledger(state);
  const summary = () => ({
    nonce: String(ledger().auth_nonce),
    inboxCount: String(ledger().inbox_count),
    deviceCount: String(ledger().device_count),
    entries: [...ledger().devices].map(hex).sort(),
  });
  return {
    authoriser,
    pk,
    policy,
    privateKey: pair.privateKey,
    address,
    self,
    call,
    ledger,
    summary,
  };
}

/** @param {Modules} modules @param {Awaited<ReturnType<typeof accountState>>} account
 * @param {Uint8Array} payload @param {'jubjub'|'p256'} arm @returns {Promise<unknown[]>} */
async function signatureMaterial(modules, account, payload, arm) {
  const { binding, webauthn } = modules;
  const nonce = account.ledger().auth_nonce;
  if (arm === 'jubjub') {
    const auth = await account.authoriser.authorise({
      account: account.address,
      circuit: 'append_inbox_with_jubjub',
      args: [payload],
      witnessValues: [],
      authNonce: nonce,
      useCounter: 0n,
      challenge: (/** @type {{x:bigint,y:bigint}} */ r, /** @type {bigint} */ grind) =>
        binding.pureCircuits.challenge_append_inbox_with_jubjub(
          account.self,
          r,
          account.pk,
          payload,
          nonce,
          grind,
        ),
    });
    return [auth.pk, auth.useCounter, auth.sigR, auth.sigS, auth.grindNonce];
  }
  const challenge = binding.pureCircuits.challenge_append_inbox_with_p256(
    account.self,
    account.pk,
    payload,
    nonce,
  );
  const data = new Uint8Array(37);
  data.set(account.policy.rp_id_hash);
  data[32] = 5;
  const message = Buffer.concat([
    data,
    createHash('sha256').update(webauthn.clientDataJSON(challenge, account.policy.origin)).digest(),
  ]);
  return [
    {
      pk: account.pk,
      policy: account.policy,
      use_counter: 0n,
      authenticator_data: data,
      sig: webauthn.parseES256Signature(sign('sha256', message, account.privateKey)),
    },
  ];
}

/** Actual generated verification, not a fake chain response. No proof, provider or value call.
 * @param {Modules} modules @param {'jubjub'|'p256'} arm */
export async function generatedAccountCrypto(modules, arm) {
  const account = await accountState(modules, arm);
  const payload = new Uint8Array(192).fill(3);
  const material = await signatureMaterial(modules, account, payload, arm);
  const before = account.summary(),
    changed = payload.slice();
  changed[0] = (changed[0] ?? 0) ^ 1;
  await assert.rejects(account.call(`append_inbox_with_${arm}`, [changed, ...material]));
  assert.deepEqual(
    account.summary(),
    before,
    'Rejected signed-message mutation changed retained state',
  );
  await account.call(`append_inbox_with_${arm}`, [payload, ...material]);
  const after = account.summary();
  assert.equal(BigInt(after.nonce), BigInt(before.nonce) + 1n);
  assert.equal(BigInt(after.inboxCount), BigInt(before.inboxCount) + 1n);
  assert.deepEqual(account.ledger().inbox.lookup(BigInt(before.inboxCount)), payload);
}
