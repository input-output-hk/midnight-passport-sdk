// The ports of account/ports (design §2.1). Their shapes are held at compile time, through checkJs
// on the JSDoc types below: `pnpm run build` type-checks this file.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { laceAuthoriser, laceFeeSponsor } from './fixtures/lace-seams.mjs';

/**
 * @typedef {import('../packages/account/dist/ports/index.js').Authoriser} Authoriser
 * @typedef {import('../packages/account/dist/ports/index.js').Authorisation} Authorisation
 * @typedef {import('../packages/account/dist/ports/index.js').AccountHint} AccountHint
 * @typedef {import('../packages/account/dist/ports/index.js').AccountDirectory} AccountDirectory
 * @typedef {import('../packages/account/dist/ports/index.js').AccLedgerView} AccLedgerView
 * @typedef {import('../packages/account/dist/ports/index.js').Chain} Chain
 * @typedef {import('../packages/account/dist/ports/index.js').EncryptionKeySource} EncryptionKeySource
 * @typedef {import('../packages/account/dist/ports/index.js').FeeSponsor} FeeSponsor
 * @typedef {import('../packages/account/dist/ports/index.js').NetworkConfig} NetworkConfig
 * @typedef {import('../packages/account/dist/ports/index.js').PassportPorts} PassportPorts
 * @typedef {import('../packages/account/dist/ports/index.js').PrfKeySource} PrfKeySource
 * @typedef {import('../packages/account/dist/ports/index.js').Prover} Prover
 * @typedef {import('../packages/account/dist/ports/index.js').Submitter} Submitter
 * @typedef {import('../packages/account/dist/ports/index.js').AccountRecordStore} AccountRecordStore
 * @typedef {import('../packages/account/dist/ports/index.js').OwnershipProof} OwnershipProof
 */

/**
 * @typedef {import('./fixtures/lace-seams.mjs').LacePassportEncryptionKey} LacePassportEncryptionKey
 * @typedef {import('./fixtures/lace-seams.mjs').LacePasskeyKeySource} LacePasskeyKeySource
 * @typedef {import('./fixtures/lace-seams.mjs').LacePassportNetworkConfig} LacePassportNetworkConfig
 */

test('a Lace-shaped PassportAuthoriser and FeeSponsor satisfy the ports by assignment', async () => {
  const lace = laceAuthoriser();
  /** @type {Authoriser} */
  const authoriser = lace;
  const laceSponsor = laceFeeSponsor();
  /** @type {FeeSponsor} */
  const sponsor = laceSponsor;
  /** @type {LacePassportEncryptionKey} */
  const laceKey = { publicKey: async () => new Uint8Array(32) };
  /** @type {EncryptionKeySource} */
  const encryptionKey = laceKey;
  /** @type {LacePasskeyKeySource} */
  const laceSource = {
    withSession: (operation) => operation(),
    deviceSecret: async () => new Uint8Array(32),
    deriveSecret: async () => new Uint8Array(32),
  };
  /** @type {PrfKeySource} */
  const prf = laceSource;
  /** @type {LacePassportNetworkConfig} */
  const laceNetwork = {
    networkId: 'undeployed',
    indexerUrl: 'http://i',
    indexerWsUrl: 'ws://i',
    nodeUrl: 'http://n',
    artefactUrl: 'http://z',
  };
  /** @type {NetworkConfig} */
  const network = { ...laceNetwork, bindingId: 'acc-test', manifestSha256: '00' };

  /** @type {Authorisation} */
  const signed = await authoriser.authorise({
    account: 'cd',
    circuit: 'add_device_with_jubjub',
    args: [],
    witnessValues: [],
    authNonce: 0n,
    useCounter: 5n,
    challenge: () => new Uint8Array(32),
  });
  assert.equal(signed.scheme, 'jubjub-schnorr');
  assert.equal(signed.useCounter, 5n);
  assert.deepEqual(await authoriser.deviceCommitments?.('cd', 0n, [0n, 1n]), ['ab', 'ab']);
  assert.equal(await authoriser.withKeySession?.(async () => 7, { kind: 'sign-in' }), 7);
  assert.deepEqual(await sponsor.balanceAndSign(Uint8Array.of(1)), Uint8Array.of(1, 9));
  assert.equal((await encryptionKey.publicKey('undeployed')).length, 32);
  assert.equal(await prf.withSession(async () => 'one prompt'), 'one prompt');
  assert.equal(network.bindingId, 'acc-test');
});

test('the port types refuse what does not fit', () => {
  /** @type {Authorisation} */
  // @ts-expect-error: the P-256 arm carries the assertion's material, not a Schnorr signature
  const wrongArm = { scheme: 'p256-webauthn', pk: { x: 1n, y: 2n }, useCounter: 0n, sigS: 1n };
  /** @type {Authoriser} */
  // @ts-expect-error: an authoriser must authorise
  const mute = { scheme: 'p256-webauthn', devicePublicKey: async () => ({ x: 1n, y: 2n }) };
  /** @type {AccountHint} */
  // @ts-expect-error: a hint names its arm
  const anonymous = { address: 'cd', publicKey: { x: 1n, y: 2n }, status: 'active' };
  assert.ok(wrongArm && mute && anonymous);
});

test('./ports is types only, and exported as its own subpath', async () => {
  const ports = await import(
    new URL('../packages/account/dist/ports/index.js', import.meta.url).href
  );
  assert.deepEqual(Object.keys(ports), []);
  const manifest = JSON.parse(
    await readFile(new URL('../packages/account/package.json', import.meta.url), 'utf8'),
  );
  assert.deepEqual(manifest.exports['./ports'], {
    types: './dist/ports/index.d.ts',
    default: './dist/ports/index.js',
  });
});

test('every port has the shape of design §2.1', async () => {
  const enc = (/** @type {string} */ s) => new TextEncoder().encode(s);
  const policy = { rp_id_hash: new Uint8Array(32), origin: enc('http://localhost:5173') };
  const pk = { x: 1n, y: 2n };
  /** @type {AccLedgerView} */
  const view = {
    booted: true,
    authNonce: 0n,
    deviceEpoch: 0n,
    entryCount: 1,
    specVersion: 3,
    hasEntry: () => true,
  };
  /** @type {Chain} */
  const chain = { call: async () => ({ txHash: 't' }), readAccount: async () => view };
  /** @type {AccountHint[]} */
  const hints = [];
  /** @type {AccountDirectory} */
  const directory = {
    get: async (_networkId, key) => hints.find((h) => h.credentialId === key.credentialId),
    put: async (_networkId, hint) => void hints.push(hint),
  };
  /** @type {PassportPorts} */
  const ports = {
    network: {
      networkId: 'undeployed',
      indexerUrl: 'http://i',
      indexerWsUrl: 'ws://i',
      nodeUrl: 'http://n',
      artefactUrl: 'http://z',
      bindingId: 'acc-test',
      manifestSha256: '00',
    },
    binding: async () => ({
      pureCircuits: {
        derive_boot_commitment_with_p256: () => new Uint8Array(32),
        derive_device_entry_with_p256: () => new Uint8Array(32),
        challenge_rotate_enc_key_with_p256: () => new Uint8Array(32),
      },
    }),
    credentials: {
      create: async () => ({ credentialId: Uint8Array.of(7) }),
      identify: async () => ({ credentialId: Uint8Array.of(7), owns: (key) => key.x === pk.x }),
    },
    authoriser: {
      scheme: 'p256-webauthn',
      devicePublicKey: async () => pk,
      deviceBinding: async () => ({ policy, credentialId: Uint8Array.of(7) }),
      authorise: async (request) => ({
        scheme: 'p256-webauthn',
        pk,
        useCounter: request.useCounter,
        authenticatorData: new Uint8Array(37),
        sig: { r: 1n, s: 2n },
      }),
    },
    encryptionKey: { publicKey: async () => new Uint8Array(32) },
    chain: async () => chain,
    deployer: { deploy: async () => ({ address: 'cd', txIds: ['t0'] }) },
    directory,
    records: {
      read: async () => undefined,
      write: async () => {},
      exists: async () => false,
    },
    random: (length) => new Uint8Array(length),
  };
  /** @type {OwnershipProof} */
  const proof = {
    scheme: 'p256-webauthn',
    challenge: new Uint8Array(32),
    authenticatorData: new Uint8Array(37),
    clientDataJSON: new Uint8Array(134),
    signature: new Uint8Array(64),
  };
  const credentialId = Uint8Array.of(7);
  await ports.directory?.put(
    'undeployed',
    {
      address: 'cd',
      scheme: 'p256-webauthn',
      credentialId,
      publicKey: pk,
      policy,
      status: 'active',
    },
    proof,
  );
  const hint = await ports.directory?.get('undeployed', { kind: 'credential-id', credentialId });
  assert.equal(hint?.address, 'cd');
  /** @type {Prover} */
  const prover = { proveTx: async (tx) => ({ tx, provenance: 'remote' }) };
  const proven = await prover.proveTx(Uint8Array.of(1), {
    networkId: 'undeployed',
    bindingId: 'acc-test',
    circuits: ['rotate_enc_key_with_p256'],
  });
  assert.equal(proven.provenance, 'remote');
  /** @type {Submitter} */
  const submitter = { submit: async () => 'submission-1' };
  assert.equal(await submitter.submit(proven.tx), 'submission-1');
  assert.equal(await ports.records?.exists(), false);
});
