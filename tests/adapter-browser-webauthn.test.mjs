// The browser adapter's WebAuthn seam and PRF wallet seed. A fake CredentialsContainer is backed
// by a real P-256 key, so the wa-json134 signature path (DER parsing, SPKI import, ECDSA
// verification) runs for real; only the browser prompt is faked.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { p256 } from '@noble/curves/nist.js';
import { sha256 } from '@noble/hashes/sha2.js';

const b = await import(new URL('../packages/adapter-browser/dist/index.js', import.meta.url).href);
const ORIGIN = 'http://localhost:5173';
const RP = 'localhost';
const ID = Uint8Array.of(1, 2, 3, 4);

/**
 * @typedef {{ challenge: Uint8Array; extensions?: { prf?: { eval: { first: Uint8Array } } } }} GetOptions
 * @typedef {{ prf?: boolean; cancel?: string; highS?: boolean }} AuthenticatorOptions
 */

/** @param {Uint8Array} bytes @returns {ArrayBuffer} */
const buffer = (bytes) => bytes.slice().buffer;
/** @param {Uint8Array} bytes */
const hex = (bytes) => Buffer.from(bytes).toString('hex');
/** @param {bigint} n @returns {Uint8Array} A minimal positive DER INTEGER. */
function derInteger(n) {
  let body = Buffer.from(n.toString(16).padStart(64, '0'), 'hex');
  while (body.length > 1 && body[0] === 0 && !((body[1] ?? 0) & 0x80)) body = body.subarray(1);
  if ((body[0] ?? 0) & 0x80) body = Buffer.concat([Buffer.of(0), body]);
  return Uint8Array.from([2, body.length, ...body]);
}
/** @param {bigint} r @param {bigint} s */
function derSignature(r, s) {
  const body = [...derInteger(r), ...derInteger(s)];
  return Uint8Array.from([0x30, body.length, ...body]);
}

/** A software authenticator behind a CredentialsContainer-shaped fake. @param {AuthenticatorOptions} [opts] */
function softwareAuthenticator({ prf = true, cancel, highS = false } = {}) {
  const sk = p256.utils.randomSecretKey();
  const pub = p256.getPublicKey(sk, false); // 0x04 || x || y
  const spki = new Uint8Array([
    ...Buffer.from('3059301306072a8648ce3d020106082a8648ce3d030107034200', 'hex'),
    ...pub,
  ]);
  const authData = new Uint8Array([...sha256(new TextEncoder().encode(RP)), 5, 0, 0, 0, 1]);
  const cancelled = () => Object.assign(new Error('prompt dismissed'), { name: cancel });
  /** @type {GetOptions[]} */
  const gets = [];
  return {
    pub,
    gets,
    container: {
      async create() {
        if (cancel) throw cancelled();
        return {
          rawId: buffer(ID),
          response: { getPublicKey: () => buffer(spki), getPublicKeyAlgorithm: () => -7 },
        };
      },
      /** @param {{ publicKey: GetOptions }} options */
      async get({ publicKey }) {
        if (cancel) throw cancelled();
        gets.push(publicKey);
        if (publicKey.extensions?.prf) {
          if (!prf) return { rawId: buffer(ID), getClientExtensionResults: () => ({}) };
          // A stand-in PRF: a deterministic function of the salt, as the real extension is.
          const first = sha256(new Uint8Array(publicKey.extensions.prf.eval.first));
          return {
            rawId: buffer(ID),
            getClientExtensionResults: () => ({ prf: { results: { first: buffer(first) } } }),
          };
        }
        const clientData = b.clientDataJSON(
          new Uint8Array(publicKey.challenge),
          new TextEncoder().encode(ORIGIN),
        );
        const message = new Uint8Array([...authData, ...sha256(clientData)]);
        let signature = p256.sign(message, sk, { format: 'der', prehash: true });
        if (highS) {
          // The same signature with s replaced by n - s: valid ES256, rejected by low-S-only checkers.
          const { r, s } = p256.Signature.fromBytes(signature, 'der');
          signature = derSignature(r, p256.Point.Fn.ORDER - s);
        }
        return {
          rawId: buffer(ID),
          response: {
            authenticatorData: buffer(authData),
            clientDataJSON: buffer(clientData),
            signature: buffer(signature),
          },
        };
      },
    },
  };
}

/** @param {ReturnType<typeof softwareAuthenticator>} auth */
const seamFor = (auth) =>
  b.browserPasskey({ rpId: RP, origin: ORIGIN, credentials: auth.container });

test('create returns the P-256 key and policy for a discoverable credential', async () => {
  const auth = softwareAuthenticator();
  const cred = await seamFor(auth).create('alice');
  assert.equal(cred.publicKey.x, BigInt('0x' + hex(auth.pub.slice(1, 33))));
  assert.equal(cred.publicKey.y, BigInt('0x' + hex(auth.pub.slice(33, 65))));
  assert.equal(cred.publicKey.identity, false);
  assert.deepEqual(cred.credentialId, ID);
  assert.equal(new TextDecoder().decode(cred.policy.origin), ORIGIN);
  assert.equal(cred.policy.origin.length, b.WEBAUTHN_ORIGIN_BYTES);
});

test('sign returns validated wa-json134 material for the challenge', async () => {
  const seam = seamFor(softwareAuthenticator());
  const cred = await seam.create('alice');
  const signed = await seam.sign(cred, new Uint8Array(32).fill(7));
  assert.equal(signed.authenticator_data.length, 37);
  assert.ok(signed.sig.r > 0n && signed.sig.s > 0n);
});

test('sign keeps a high-S signature as it is: the contract accepts both halves', async () => {
  const seam = seamFor(softwareAuthenticator({ highS: true }));
  const cred = await seam.create('alice');
  const signed = await seam.sign(cred, new Uint8Array(32).fill(9));
  assert.ok(signed.sig.s > p256.Point.Fn.ORDER / 2n);
});

test('sign rejects an assertion the credential key did not make', async () => {
  const signer = softwareAuthenticator();
  const other = softwareAuthenticator();
  const cred = await seamFor(other).create('alice');
  await assert.rejects(seamFor(signer).sign(cred, new Uint8Array(32).fill(7)), {
    code: 'InternalError',
    message: /invalid WebAuthn ES256 signature/,
  });
});

test('identify returns the picked credential id', async () => {
  const picked = await seamFor(softwareAuthenticator()).identify();
  assert.deepEqual(picked.credentialId, ID);
});

test('a cancelled or timed-out prompt is UserCancelled on every ceremony', async () => {
  for (const cancel of ['NotAllowedError', 'AbortError']) {
    const seam = seamFor(softwareAuthenticator({ cancel }));
    await assert.rejects(seam.create('alice'), { code: 'UserCancelled' });
    await assert.rejects(seam.identify(), { code: 'UserCancelled' });
    const credential = {
      credentialId: ID,
      publicKey: { x: 1n, y: 1n, identity: false },
      policy: b.webauthnPolicy(RP, ORIGIN),
    };
    await assert.rejects(seam.sign(credential, new Uint8Array(32)), { code: 'UserCancelled' });
    await assert.rejects(
      b.walletSeedFromPasskey({
        credentialId: ID,
        rpId: RP,
        networkId: 'undeployed',
        credentials: softwareAuthenticator({ cancel }).container,
      }),
      { code: 'UserCancelled' },
    );
  }
});

test('the PRF wallet seed is network-bound and absent without PRF support', async () => {
  const auth = softwareAuthenticator();
  const seed = (/** @type {string} */ networkId) =>
    b.walletSeedFromPasskey({ credentialId: ID, rpId: RP, networkId, credentials: auth.container });
  const a1 = await seed('undeployed');
  const a2 = await seed('testnet');
  assert.equal(a1.length, 32);
  assert.notDeepEqual(a1, a2);
  assert.deepEqual(await seed('undeployed'), a1);
  const none = await b.walletSeedFromPasskey({
    credentialId: Uint8Array.of(1),
    rpId: RP,
    networkId: 'undeployed',
    credentials: softwareAuthenticator({ prf: false }).container,
  });
  assert.equal(none, undefined);
});

test('the PRF salt is the domain-separated hash of the network, in its own ceremony', async () => {
  const auth = softwareAuthenticator();
  await b.walletSeedFromPasskey({
    credentialId: ID,
    rpId: RP,
    networkId: 'testnet',
    credentials: auth.container,
  });
  const [ceremony] = auth.gets;
  assert.ok(ceremony);
  assert.equal(b.PRF_SALT_PREFIX, 'midnight:passport:wallet:v1:');
  assert.deepEqual(
    new Uint8Array(ceremony.extensions?.prf?.eval.first ?? []),
    sha256(new TextEncoder().encode('midnight:passport:wallet:v1:testnet')),
  );
  // A signing assertion never carries the PRF extension: wa-json134 allows no extension data.
  const seam = seamFor(auth);
  await seam.sign(await seam.create('alice'), new Uint8Array(32));
  assert.equal(auth.gets.at(-1)?.extensions, undefined);
});
