// The browser adapter's WebAuthn seam and its PRF ceremony (Lace recipe v1). A fake CredentialsContainer is backed
// by a real P-256 key, so the wa-json134 signature path (DER parsing, SPKI import, ECDSA
// verification) runs for real; only the browser prompt is faked.
import { mock, test } from 'node:test';
import assert from 'node:assert/strict';
import { p256 } from '@noble/curves/nist.js';
import { sha256 } from '@noble/hashes/sha2.js';

const b = await import(new URL('../packages/adapter-browser/dist/index.js', import.meta.url).href);
const ORIGIN = 'http://localhost:5173';
const RP = 'localhost';
const ID = Uint8Array.of(1, 2, 3, 4);

/**
 * @typedef {{
 *   challenge: Uint8Array;
 *   rpId?: string;
 *   allowCredentials?: { type: string; id: Uint8Array }[];
 *   extensions?: { prf?: { eval: { first: Uint8Array; second?: Uint8Array } } };
 * }} GetOptions
 * @typedef {{
 *   challenge: Uint8Array;
 *   hints?: string[];
 *   extensions?: { prf?: { eval?: { first: Uint8Array; second?: Uint8Array } } };
 * }} CreateOptions
 * What a create that asks for PRF answers: `enabled` only, `enabled` and the results (GPM), or no
 * `enabled` member at all.
 * @typedef {'enabled' | 'results' | 'missing'} PrfAtCreate
 * @typedef {{ prf?: boolean; atCreate?: PrfAtCreate; cancel?: string; highS?: boolean; empty?: boolean }} AuthenticatorOptions
 * What the next signing assertion carries; tests change it between ceremonies.
 * @typedef {{ flags: number; extensionData: boolean; rp: string; wrongChallenge: boolean }} Behaviour
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
function softwareAuthenticator({
  prf = true,
  atCreate = 'enabled',
  cancel,
  highS = false,
  empty = false,
} = {}) {
  const sk = p256.utils.randomSecretKey();
  const pub = p256.getPublicKey(sk, false); // 0x04 || x || y
  const spki = new Uint8Array([
    ...Buffer.from('3059301306072a8648ce3d020106082a8648ce3d030107034200', 'hex'),
    ...pub,
  ]);
  /** @type {Behaviour} */
  const behaviour = { flags: 5, extensionData: false, rp: RP, wrongChallenge: false };
  const authenticatorData = () =>
    new Uint8Array([
      ...sha256(new TextEncoder().encode(behaviour.rp)),
      behaviour.flags,
      0,
      0,
      0,
      1,
      ...(behaviour.extensionData ? [0xa1, 0x60, 0x00] : []), // a CBOR extensions map
    ]);
  const cancelled = () => Object.assign(new Error('prompt dismissed'), { name: cancel });
  /** A stand-in PRF: a deterministic function of each salt, as the real extension is. */
  const evaluate = (/** @type {{ first: Uint8Array; second?: Uint8Array }} */ salts) => ({
    first: buffer(sha256(new Uint8Array(salts.first))),
    ...(salts.second && { second: buffer(sha256(new Uint8Array(salts.second))) }),
  });
  /** @type {GetOptions[]} */
  const gets = [];
  /** @type {CreateOptions[]} */
  const creates = [];
  return {
    pub,
    gets,
    creates,
    behaviour,
    container: {
      /** @param {{ publicKey: CreateOptions }} options */
      async create({ publicKey }) {
        if (cancel) throw cancelled();
        creates.push(publicKey);
        const salts = publicKey.extensions?.prf?.eval;
        // What a provider reports for the PRF extension requested at creation.
        const reported =
          !prf || atCreate === 'enabled'
            ? { enabled: prf }
            : atCreate === 'results'
              ? { enabled: true, ...(salts && { results: evaluate(salts) }) }
              : {};
        return {
          rawId: buffer(ID),
          response: { getPublicKey: () => buffer(spki), getPublicKeyAlgorithm: () => -7 },
          getClientExtensionResults: () => ({ prf: reported }),
        };
      },
      /** @param {{ publicKey: GetOptions }} options */
      async get({ publicKey }) {
        if (cancel) throw cancelled();
        gets.push(publicKey);
        if (empty) return null;
        if (publicKey.extensions?.prf) {
          if (!prf) return { rawId: buffer(ID), getClientExtensionResults: () => ({}) };
          const results = evaluate(publicKey.extensions.prf.eval);
          return { rawId: buffer(ID), getClientExtensionResults: () => ({ prf: { results } }) };
        }
        const authData = authenticatorData();
        const asked = new Uint8Array(publicKey.challenge);
        const clientData = b.clientDataJSON(
          behaviour.wrongChallenge ? asked.map((v) => v ^ 1) : asked,
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

test('create refuses a provider whose PRF is false or missing, before the enrolment probe', async () => {
  for (const opts of [{ prf: false }, { atCreate: /** @type {const} */ ('missing') }]) {
    const auth = softwareAuthenticator(opts);
    await assert.rejects(seamFor(auth).create('alice'), (e) => {
      const err = /** @type {{ code?: string; message?: string }} */ (e);
      assert.equal(err.code, 'UnsupportedAuthenticator');
      assert.equal(err.message, b.PRF_UNSUPPORTED_AT_CREATE);
      assert.match(err.message ?? '', /PRF-capable provider/);
      assert.match(err.message ?? '', /Google Password Manager or iCloud Keychain/);
      return true;
    });
    assert.equal(auth.gets.length, 0, `no probe ceremony ran (${JSON.stringify(opts)})`);
  }
});

test('create asks for PRF with both Lace salts, and hints at a passkey on this device', async () => {
  const auth = softwareAuthenticator();
  await seamFor(auth).create('alice');
  const [options] = auth.creates;
  assert.deepEqual(options?.hints, ['client-device']);
  assert.equal(
    hex(new Uint8Array(options?.extensions?.prf?.eval?.first ?? [])),
    hex(b.prfSalt(b.PRF_LABEL_AUTHORISER)),
  );
  assert.equal(
    hex(new Uint8Array(options?.extensions?.prf?.eval?.second ?? [])),
    hex(b.prfSalt(b.PRF_LABEL_ROOT)),
  );
});

test('PRF results returned at create derive the encryption key with no PRF ceremony', async () => {
  const auth = softwareAuthenticator({ atCreate: 'results' });
  const cred = await seamFor(auth).create('alice');
  assert.equal(auth.gets.length, 1, 'create needs only the enrolment probe');
  // The outputs never ride on the credential, so no spread, log or registry write can carry them.
  assert.deepEqual(Reflect.ownKeys(cred).sort(), ['credentialId', 'policy', 'publicKey']);
  const opts = { credentialId: cred.credentialId, rpId: RP, credentials: auth.container };
  const key = await b.accEncryptionKeyFromPasskey({
    ...opts,
    created: cred,
    networkId: 'undeployed',
  });
  assert.equal(auth.gets.length, 1, 'no separate PRF ceremony: create and probe only');
  // The same key a PRF ceremony gives; and the held outputs are taken once only.
  const again = await b.accEncryptionKeyFromPasskey({
    ...opts,
    created: cred,
    networkId: 'undeployed',
  });
  assert.equal(auth.gets.length, 2, 'taken once: the second derivation runs its own ceremony');
  assert.deepEqual(again, key);
});

test('when create returns only PRF enabled, the encryption key falls back to a pinned PRF ceremony', async () => {
  const auth = softwareAuthenticator({ atCreate: 'enabled' });
  const cred = await seamFor(auth).create('alice');
  const key = await b.accEncryptionKeyFromPasskey({
    credentialId: cred.credentialId,
    created: cred,
    rpId: RP,
    credentials: auth.container,
    networkId: 'undeployed',
  });
  assert.equal(key.length, 32);
  assert.equal(auth.gets.length, 2, 'create, probe, then the PRF ceremony');
  const ceremony = auth.gets.at(-1);
  assert.ok(ceremony?.extensions?.prf, 'the last get is the PRF ceremony');
  assert.deepEqual(new Uint8Array(ceremony?.allowCredentials?.[0]?.id ?? []), ID);
});

test('unused create-time PRF outputs are zeroed and dropped after the TTL', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const auth = softwareAuthenticator({ atCreate: 'results' });
    const cred = await seamFor(auth).create('alice');
    mock.timers.tick(60_000);
    await b.passkeyPrf({
      credentialId: cred.credentialId,
      created: cred,
      rpId: RP,
      credentials: auth.container,
    });
    assert.equal(auth.gets.length, 2, 'expired: a PRF ceremony ran');
  } finally {
    mock.timers.reset();
  }
});

test('passkeyPrf refuses a `created` credential that is not `credentialId`', async () => {
  const auth = softwareAuthenticator({ atCreate: 'results' });
  const cred = await seamFor(auth).create('alice');
  await assert.rejects(b.passkeyPrf({ credentialId: Uint8Array.of(9), created: cred, rpId: RP }), {
    code: 'InternalError',
    message: /not the credential/,
  });
});

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

test('identify proves which key the picked passkey holds, with no second prompt (R10(b))', async () => {
  const auth = softwareAuthenticator();
  const seam = seamFor(auth);
  const enrolled = await seam.create('alice');
  const before = auth.gets.length;
  const picked = await seam.identify();
  assert.equal(auth.gets.length - before, 1, 'one discoverable prompt');
  assert.equal(picked.owns(enrolled.publicKey, enrolled.policy), true);
  const other = await seamFor(softwareAuthenticator()).create('bob');
  assert.equal(picked.owns(other.publicKey, enrolled.policy), false, 'another valid P-256 key');
  assert.equal(
    picked.owns(enrolled.publicKey, b.webauthnPolicy(RP, 'http://localhost:5174')),
    false,
    'a policy with another origin',
  );
  assert.equal(
    picked.owns(enrolled.publicKey, {
      ...enrolled.policy,
      rp_id_hash: sha256(new TextEncoder().encode('example.org')),
    }),
    false,
    'a policy with another relying party',
  );
  assert.equal(
    picked.owns({ x: 1n, y: 1n, identity: false }, enrolled.policy),
    false,
    'no curve point',
  );
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
      b.passkeyPrf({
        credentialId: ID,
        rpId: RP,
        credentials: softwareAuthenticator({ cancel }).container,
      }),
      { code: 'UserCancelled' },
    );
  }
});

test('the PRF seed is the 64-byte BIP-39 seed of output #2, and fails closed without PRF', async () => {
  const auth = softwareAuthenticator();
  const opts = { credentialId: ID, rpId: RP, credentials: auth.container };
  const seed = await b.passkeySeed(opts);
  assert.equal(seed.length, 64);
  assert.deepEqual(await b.passkeySeed(opts), seed);
  const { root } = await b.passkeyPrf(opts);
  assert.deepEqual(seed, b.seedFromRoot(root));
  // No fallback seed: a passkey without PRF never opens a different, empty wallet.
  const noPrf = { ...opts, credentials: softwareAuthenticator({ prf: false }).container };
  await assert.rejects(b.passkeySeed(noPrf), { code: 'UnsupportedAuthenticator' });
  await assert.rejects(b.accEncryptionKeyFromPasskey({ ...noPrf, networkId: 'undeployed' }), {
    code: 'UnsupportedAuthenticator',
  });
});

test('the ACC encryption key is network-bound and reproducible from the passkey', async () => {
  const opts = { credentialId: ID, rpId: RP, credentials: softwareAuthenticator().container };
  const key = (/** @type {string} */ networkId) =>
    b.accEncryptionKeyFromPasskey({ ...opts, networkId });
  const undeployed = await key('undeployed');
  assert.equal(undeployed.length, 32);
  assert.deepEqual(await key('undeployed'), undeployed);
  assert.notDeepEqual(await key('preview'), undeployed);
});

test('both Lace PRF salts are evaluated in one ceremony on the given credential', async () => {
  const auth = softwareAuthenticator();
  await b.passkeyPrf({ credentialId: ID, rpId: RP, credentials: auth.container });
  assert.equal(auth.gets.length, 1);
  const [ceremony] = auth.gets;
  assert.equal(ceremony?.rpId, RP);
  assert.equal(ceremony?.allowCredentials?.length, 1);
  assert.deepEqual(new Uint8Array(ceremony?.allowCredentials?.[0]?.id ?? []), ID);
  // Lace's frozen v1 salts: SHA-256 of 'lace-passport/prf/authoriser/v1' and 'lace/prf/root/v1'.
  assert.equal(
    hex(new Uint8Array(ceremony?.extensions?.prf?.eval.first ?? [])),
    '0caadfc9c1ca3f88897abc59fe897f98a3e9f3ff740239b8828121aa7b814fc2',
  );
  assert.equal(
    hex(new Uint8Array(ceremony?.extensions?.prf?.eval.second ?? [])),
    '7bae2156e6afa3a5aa6e9d8169f633a0d65874995f3770e5c330b2042582812b',
  );
  // A signing assertion never carries the PRF extension: wa-json134 allows no extension data.
  const seam = seamFor(auth);
  await seam.sign(await seam.create('alice'), new Uint8Array(32));
  assert.equal(auth.gets.at(-1)?.extensions, undefined);
});

test('the PRF ceremony fails on a dismissed prompt or a different credential, never silently', async () => {
  const prf = (/** @type {Uint8Array} */ credentialId, /** @type {AuthenticatorOptions} */ opts) =>
    b.passkeyPrf({ credentialId, rpId: RP, credentials: softwareAuthenticator(opts).container });
  await assert.rejects(prf(ID, { empty: true }), { code: 'UserCancelled' });
  await assert.rejects(prf(Uint8Array.of(9, 9), {}), {
    code: 'AccountNotFound',
    message: b.WRONG_PASSKEY,
  });
});

test('a pinned signing ceremony answered by another passkey is the wrong-passkey error', async () => {
  const seam = seamFor(softwareAuthenticator());
  const cred = await seam.create('alice');
  await assert.rejects(seam.sign({ ...cred, credentialId: Uint8Array.of(9) }, new Uint8Array(32)), {
    code: 'AccountNotFound',
    message: /not the passkey this account was created with; choose that passkey/,
  });
});

test('no PRF at a later ceremony has its own message: maybe not the account passkey', async () => {
  const noPrf = softwareAuthenticator({ prf: false }).container;
  await assert.rejects(b.passkeyPrf({ credentialId: ID, rpId: RP, credentials: noPrf }), (e) => {
    const err = /** @type {{ code?: string; message?: string }} */ (e);
    assert.equal(err.code, 'UnsupportedAuthenticator');
    assert.equal(err.message, b.PRF_UNAVAILABLE);
    assert.notEqual(err.message, b.PRF_UNSUPPORTED_AT_CREATE);
    assert.match(err.message ?? '', /different passkey/);
    return true;
  });
});

test('create runs an enrolment probe: one throwaway assertion after the create ceremony', async () => {
  const auth = softwareAuthenticator();
  await seamFor(auth).create('alice');
  assert.equal(auth.gets.length, 1);
  const [probe] = auth.gets;
  assert.equal(probe?.challenge.length, 32);
  assert.equal(probe?.rpId, RP);
  assert.deepEqual(new Uint8Array(probe?.allowCredentials?.[0]?.id ?? []), ID);
});

test('create refuses an authenticator whose assertions break the profile', async () => {
  const profile = { code: 'UnsupportedAuthenticator', message: /wa-json134 profile/ };
  for (const change of [
    { extensionData: true, flags: 0x85 }, // extension data, as a PRF-capable build may add
    { flags: 1 }, // no user verification
    { flags: 0x45 }, // attested credential data
    { rp: 'example.org' }, // another relying party
    { wrongChallenge: true }, // clientDataJSON for another challenge
  ]) {
    const auth = softwareAuthenticator();
    Object.assign(auth.behaviour, change);
    await assert.rejects(seamFor(auth).create('alice'), profile, JSON.stringify(change));
  }
});

test('create refuses a page whose origin is not the policy origin', async () => {
  const auth = softwareAuthenticator();
  const original = Object.getOwnPropertyDescriptor(globalThis, 'location');
  try {
    Object.defineProperty(globalThis, 'location', {
      value: { origin: 'https://evil.example' },
      configurable: true,
    });
    await assert.rejects(seamFor(auth).create('alice'), { message: /origin mismatch/ });
    assert.equal(auth.gets.length, 0);
    Object.defineProperty(globalThis, 'location', {
      value: { origin: ORIGIN },
      configurable: true,
    });
    await seamFor(auth).create('alice');
  } finally {
    if (original) Object.defineProperty(globalThis, 'location', original);
    else delete (/** @type {{ location?: unknown }} */ (globalThis).location);
  }
});

test('sign accepts flags 5, 13 and 29 only, with 37 bytes of authenticator data', async () => {
  const auth = softwareAuthenticator();
  const seam = seamFor(auth);
  const cred = await seam.create('alice');
  const challenge = new Uint8Array(32).fill(3);
  for (const flags of [5, 13, 29]) {
    auth.behaviour.flags = flags;
    assert.equal((await seam.sign(cred, challenge)).authenticator_data[32], flags);
  }
  for (const flags of [0, 1, 4, 7, 21, 0x45, 0x85]) {
    auth.behaviour.flags = flags;
    await assert.rejects(
      seam.sign(cred, challenge),
      { message: /requires UP\+UV/ },
      `flags ${flags}`,
    );
  }
  auth.behaviour.flags = 5;
  auth.behaviour.extensionData = true;
  await assert.rejects(seam.sign(cred, challenge), { message: /length or RP mismatch/ });
});

test('sign rejects another RP and a clientDataJSON for another challenge', async () => {
  const auth = softwareAuthenticator();
  const seam = seamFor(auth);
  const cred = await seam.create('alice');
  const challenge = new Uint8Array(32).fill(3);
  auth.behaviour.rp = 'example.org';
  await assert.rejects(seam.sign(cred, challenge), { message: /length or RP mismatch/ });
  auth.behaviour.rp = RP;
  auth.behaviour.wrongChallenge = true;
  await assert.rejects(seam.sign(cred, challenge), { message: /mismatched clientDataJSON/ });
});
