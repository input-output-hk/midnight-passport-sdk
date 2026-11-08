import assert from 'node:assert/strict';
import test from 'node:test';
import { p256 } from '@noble/curves/nist.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { identifyPasskeyWithPrf } from '../packages/adapter-webauthn/dist/login.js';
import { validLoginExtensions } from '../packages/adapter-webauthn/dist/login-cbor.js';
import {
  assertionMaterial,
  base64url,
  browserPasskey,
  lacePrfSalts,
  webauthnPolicy,
} from '../packages/adapter-webauthn/dist/index.js';
import { softwareAuthenticator, ID, ORIGIN, RP } from './fixtures/software-authenticator.mjs';

const encoder = new TextEncoder();
/** @typedef {Parameters<typeof identifyPasskeyWithPrf>[0]} LoginOptions */
/** @typedef {import('../packages/adapter-webauthn/dist/index.js').WebAuthnAssertion} Assertion */
/** @typedef {import('../packages/adapter-webauthn/dist/index.js').PasskeyCeremony} Ceremony */
/** @typedef {import('../packages/account/dist/ports/index.js').P256PublicKey} P256PublicKey */
/** @typedef {import('./fixtures/software-authenticator.mjs').GetOptions} GetOptions */
/**
 * @typedef {{
 * client?: Record<string, unknown>;
 * json?: string;
 * rpHash?: Uint8Array;
 * flags?: number;
 * extensions?: number[];
 * tamper?: boolean;
 * rawId?: ArrayBuffer;
 * signature?: ArrayBuffer;
 * response?: Record<string, unknown>;
 * results?: { first?: ArrayBuffer | Uint8Array | DataView; second?: ArrayBuffer | Uint8Array | DataView };
 * }} SignedConfig
 */
/** @param {Iterable<number>} bytes */
const buffer = (bytes) => Uint8Array.from(bytes).buffer;
/** @param {LoginOptions['credentials']} container @param {Partial<LoginOptions>} extra */
const options = (container, extra = {}) => ({
  rpId: RP,
  origin: ORIGIN,
  credentials: container,
  ...extra,
});
/** @param {Uint8Array} pub @returns {P256PublicKey} */
const keyFor = (pub) => {
  const point = p256.Point.fromBytes(pub).toAffine();
  return { ...point, identity: false };
};
/** @param {import('../packages/adapter-webauthn/dist/index.js').PasskeyPrfOutputs} outputs */
const dispose = ({ authoriser, root }) => {
  authoriser.fill(0);
  root.fill(0);
};

/** Own synthetic ES256 signer, allowing malformed signed bytes without altering shared fixtures.
 * @param {SignedConfig} config
 */
function signedAuthenticator(config = {}) {
  const secret = p256.utils.randomSecretKey();
  const pub = p256.getPublicKey(secret, false);
  /** @type {GetOptions[]} */
  const gets = [];
  const policy = webauthnPolicy(RP, ORIGIN);
  const first = buffer(new Uint8Array(32).fill(7));
  const second = buffer(new Uint8Array(32).fill(8));
  /** @type {Assertion | undefined} */
  let proof;
  const container = {
    /** @param {{publicKey: GetOptions}} options */
    async get({ publicKey }) {
      gets.push(publicKey);
      const json = {
        type: 'webauthn.get',
        challenge: base64url(new Uint8Array(publicKey.challenge)),
        origin: ORIGIN,
        crossOrigin: false,
        ...config.client,
      };
      const clientData = encoder.encode(config.json ?? JSON.stringify(json));
      const authenticatorData = Uint8Array.from([
        ...(config.rpHash ?? policy.rp_id_hash),
        config.flags ?? 0x85,
        0,
        0,
        0,
        1,
        ...(config.extensions ?? [0xa1, 0x63, 0x70, 0x72, 0x66, 0xf5]),
      ]);
      const message = Uint8Array.from([...authenticatorData, ...sha256(clientData)]);
      const signature = p256.sign(message, secret, { format: 'der', prehash: true });
      proof = { authenticatorData, clientDataJSON: clientData, signature };
      if (config.tamper)
        proof.signature = signature.map((byte, index) => byte ^ (index === 9 ? 1 : 0));
      return {
        rawId: config.rawId ?? buffer(ID),
        response: {
          authenticatorData: buffer(proof.authenticatorData),
          clientDataJSON: buffer(proof.clientDataJSON),
          signature: config.signature ?? buffer(proof.signature),
          ...config.response,
        },
        getClientExtensionResults: () => ({
          prf: { results: config.results ?? { first, second } },
        }),
      };
    },
  };
  return {
    pub,
    gets,
    container,
    policy,
    first,
    second,
    proof: () => {
      assert.ok(proof);
      return proof;
    },
  };
}

test('login identifies and unlocks both Lace PRF outputs in exactly one discoverable assertion', async () => {
  const auth = softwareAuthenticator();
  /** @type {Ceremony[]} */
  const ceremonies = [];
  const result = await identifyPasskeyWithPrf(
    options(auth.container, {
      beforeCeremony: (event) => {
        ceremonies.push(event);
      },
    }),
  );
  try {
    assert.equal(auth.gets.length, 1);
    const request = auth.gets[0];
    assert.ok(request);
    assert.ok(request.extensions?.prf);
    assert.equal(request.userVerification, 'required');
    assert.equal(request.allowCredentials, undefined);
    assert.deepEqual(request.extensions.prf.eval, lacePrfSalts());
    assert.deepEqual(ceremonies, [{ purpose: 'identify-and-unlock', rpId: RP, attempt: 1 }]);
    assert.deepEqual(result.identity.credentialId, ID);
    assert.equal(result.identity.owns(keyFor(auth.pub), webauthnPolicy(RP, ORIGIN)), true);
    assert.deepEqual(Reflect.ownKeys(result.identity).sort(), ['credentialId', 'owns']);
    assert.equal(result.outputs.authoriser.length, 32);
    assert.equal(result.outputs.root.length, 32);
    assert.notDeepEqual(result.outputs.authoriser, result.outputs.root);
  } finally {
    dispose(result.outputs);
  }
});

test('login accepts signed GREASE without retrying while strict transaction material still refuses it', async () => {
  const auth = signedAuthenticator({
    client: { other_keys_can_be_added_here: 'future browser data', future: { version: 2 } },
  });
  const result = await identifyPasskeyWithPrf(options(auth.container));
  try {
    assert.equal(auth.gets.length, 1);
    assert.equal(result.identity.owns(keyFor(auth.pub), auth.policy), true);
    assert.throws(() => {
      const request = auth.gets[0];
      assert.ok(request);
      return assertionMaterial(request.challenge, auth.policy, keyFor(auth.pub), auth.proof());
    }, /mismatched clientDataJSON/);
  } finally {
    dispose(result.outputs);
  }
});

test('login copies browser secrets and binds ownership to the unchanged signed bytes and enrolled policy', async () => {
  const auth = signedAuthenticator();
  const result = await identifyPasskeyWithPrf(options(auth.container));
  try {
    const key = keyFor(auth.pub);
    assert.equal(result.identity.owns(key, auth.policy), true);
    assert.equal(
      result.identity.owns(keyFor(p256.getPublicKey(p256.utils.randomSecretKey())), auth.policy),
      false,
    );
    assert.equal(result.identity.owns({ x: 1n, y: 1n, identity: false }, auth.policy), false);
    const invalidIdentity = Object.defineProperty({ ...key }, 'identity', { value: true });
    assert.equal(result.identity.owns(invalidIdentity, auth.policy), false);
    assert.equal(result.identity.owns(key, webauthnPolicy(RP, 'http://localhost:5174')), false);
    assert.equal(
      result.identity.owns(key, { ...auth.policy, rp_id_hash: new Uint8Array(32) }),
      false,
    );
    const before = new Uint8Array(auth.first).slice();
    result.outputs.authoriser.fill(0);
    assert.deepEqual(new Uint8Array(auth.first), before, 'provider-owned buffer remains untouched');
    new Uint8Array(auth.second).fill(0);
    assert.ok(
      result.outputs.root.some((byte) => byte === 8),
      'retained output is an owned copy',
    );
  } finally {
    dispose(result.outputs);
  }
});

test('login accepts valid high-S ES256 and byte-view PRF outputs without sharing provider buffers', async () => {
  const auth = softwareAuthenticator({ highS: true });
  const signed = await identifyPasskeyWithPrf(options(auth.container));
  assert.equal(signed.identity.owns(keyFor(auth.pub), webauthnPolicy(RP, ORIGIN)), true);
  dispose(signed.outputs);
  const first = new Uint8Array(40).fill(9);
  const second = new Uint8Array(40).fill(10);
  const viewed = signedAuthenticator({
    results: {
      first: first.subarray(4, 36),
      second: new DataView(second.buffer, 4, 32),
    },
  });
  const result = await identifyPasskeyWithPrf(options(viewed.container));
  assert.deepEqual(result.outputs.authoriser, new Uint8Array(32).fill(9));
  assert.deepEqual(result.outputs.root, new Uint8Array(32).fill(10));
  dispose(result.outputs);
  assert.ok(first.every((byte) => byte === 9));
  assert.ok(second.every((byte) => byte === 10));
});

test('login accepts legal backup flags and either absent ED or a bounded signed extensions map', async () => {
  for (const flags of [5, 13, 29, 0x85, 0x8d, 0x9d]) {
    const auth = signedAuthenticator({ flags, extensions: flags & 0x80 ? [0xa0] : [] });
    const result = await identifyPasskeyWithPrf(options(auth.container));
    assert.equal(result.identity.owns(keyFor(auth.pub), auth.policy), true, `flags ${flags}`);
    dispose(result.outputs);
  }
});

test('login refuses missing UP/UV, reserved bits, AT, invalid backup combinations and ED inconsistencies', async () => {
  for (const config of [
    ...[0, 1, 4, 7, 0x15, 0x45, 0xa5, 0x95].map((flags) => ({ flags })),
    { flags: 5, extensions: [0xa0] },
    { flags: 0x85, extensions: [] },
    { extensions: [0x80] },
    { extensions: [0xa0, 0] },
    { extensions: [0xa1, 0x61] },
    { extensions: [0xbf, 0xff] },
    { extensions: [0xa1, 0x61, 0xff, 0] },
    { extensions: [0xa1, 0x61, 0x61, 0xfc] },
  ]) {
    const auth = signedAuthenticator(config);
    await assert.rejects(identifyPasskeyWithPrf(options(auth.container)), {
      code: 'UnsupportedAuthenticator',
    });
    assert.equal(auth.gets.length, 1, 'invalid login never retries');
  }
});

test('CBOR validation is bounded, complete and handles nested extension data', () => {
  for (const bytes of [
    [0xa0],
    [0xa1, 0x61, 0x61, 0xa1, 0x61, 0x62, 0x82, 0xf5, 0x42, 1, 2],
    [0xa1, 0x61, 0x61, 0xc1, 0x1b, 0, 0, 0, 0, 0, 0, 0, 1],
    [0xa1, 0x61, 0x61, 0xf9, 0, 0],
    [0xa1, 0x61, 0x61, 0xf8, 0x20],
  ])
    assert.equal(validLoginExtensions(Uint8Array.from(bytes)), true);
  for (const bytes of [
    [],
    [0xa0, 0xa0],
    [0xa1, 0, 0x5b, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff],
    [0xa1, 0, ...new Array(10).fill(0x81), 0],
    [0xa1, 0, 0x98, 128, ...new Array(128).fill(0)],
    [0xa1, 0, 0xf8, 24],
    [0xa1, 0, 0xfa, 0],
    [0xa1, 0, 0x7c],
    new Array(4097).fill(0xa0),
  ])
    assert.equal(validLoginExtensions(Uint8Array.from(bytes)), false);
});

test('signed client data must bind type, challenge, exact origin, crossOrigin and RP', async () => {
  for (const config of [
    { client: { type: 'webauthn.create' } },
    { client: { challenge: 'wrong-challenge' } },
    { client: { origin: 'http://localhost:5174' } },
    { client: { crossOrigin: true } },
    { client: { crossOrigin: undefined } },
    { rpHash: new Uint8Array(32) },
    { json: 'null' },
    { json: '[]' },
    { json: 'broken JSON' },
  ]) {
    const auth = signedAuthenticator(config);
    await assert.rejects(identifyPasskeyWithPrf(options(auth.container)));
    assert.equal(auth.gets.length, 1);
  }
});

test('a validly encoded signature made for other bytes cannot own the returned identity', async () => {
  const auth = signedAuthenticator({ tamper: true });
  const result = await identifyPasskeyWithPrf(options(auth.container));
  assert.equal(result.identity.owns(keyFor(auth.pub), auth.policy), false);
  dispose(result.outputs);
});

test('login bounds browser credential, assertion, signature and output buffers before use', async () => {
  for (const config of [
    { rawId: new ArrayBuffer(0) },
    { rawId: new ArrayBuffer(1024) },
    { response: { clientDataJSON: new ArrayBuffer(8193) } },
    { response: { authenticatorData: new ArrayBuffer(4134) } },
    { response: { authenticatorData: new ArrayBuffer(36) } },
    { response: { clientDataJSON: Uint8Array.of(1) } },
    { signature: new ArrayBuffer(73) },
    { results: { first: new ArrayBuffer(31), second: new ArrayBuffer(32) } },
    { results: { first: new ArrayBuffer(32), second: new ArrayBuffer(33) } },
    { results: { first: new ArrayBuffer(32) } },
    { results: { second: new ArrayBuffer(32) } },
    { results: {} },
  ]) {
    const auth = signedAuthenticator(config);
    await assert.rejects(identifyPasskeyWithPrf(options(auth.container)), {
      code: 'UnsupportedAuthenticator',
    });
    assert.equal(auth.gets.length, 1);
  }
  const invalidDer = signedAuthenticator({ signature: new ArrayBuffer(8) });
  await assert.rejects(identifyPasskeyWithPrf(options(invalidDer.container)), {
    code: 'InternalError',
    message: /invalid ES256 DER sequence/,
  });
  assert.equal(invalidDer.gets.length, 1);
});

test('a provider without PRF refuses without a separate derive-keys call or fallback seed', async () => {
  const auth = softwareAuthenticator({ prf: false });
  await assert.rejects(identifyPasskeyWithPrf(options(auth.container)), {
    code: 'UnsupportedAuthenticator',
  });
  assert.equal(auth.gets.length, 1);
});

test('a missing assertion, browser cancellation and declined review do not retry login', async () => {
  for (const cancel of ['NotAllowedError', 'AbortError'])
    await assert.rejects(
      identifyPasskeyWithPrf(options(softwareAuthenticator({ cancel }).container)),
      { code: 'UserCancelled' },
    );
  await assert.rejects(
    identifyPasskeyWithPrf(options(softwareAuthenticator({ empty: true }).container)),
    { code: 'UserCancelled' },
  );
  const auth = softwareAuthenticator();
  await assert.rejects(
    identifyPasskeyWithPrf(
      options(auth.container, {
        beforeCeremony() {
          throw Object.assign(new Error('review declined'), { name: 'NotAllowedError' });
        },
      }),
    ),
    { code: 'UserCancelled' },
  );
  assert.equal(auth.gets.length, 0);
});

test('invalid canonical policy and a mismatched page refuse before credential access', async () => {
  const auth = softwareAuthenticator();
  for (const extra of [{ rpId: 'evil.example' }, { origin: `${ORIGIN}/` }])
    await assert.rejects(identifyPasskeyWithPrf(options(auth.container, extra)));
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'location');
  try {
    Object.defineProperty(globalThis, 'location', {
      configurable: true,
      value: { origin: 'https://evil.example' },
    });
    await assert.rejects(identifyPasskeyWithPrf(options(auth.container)));
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'location', descriptor);
    else delete (/** @type {{location?: unknown}} */ (globalThis).location);
  }
  assert.equal(auth.gets.length, 0);
});

test('strict signing still rejects PRF authenticator extensions', async () => {
  const auth = softwareAuthenticator();
  const seam = browserPasskey(options(auth.container));
  const credential = await seam.create('alice');
  auth.behaviour.flags = 0x85;
  auth.behaviour.extensionData = true;
  await assert.rejects(seam.sign(credential, new Uint8Array(32)), {
    message: /length or RP mismatch/,
  });
});
