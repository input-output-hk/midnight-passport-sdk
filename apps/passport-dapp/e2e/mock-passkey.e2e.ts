// The dev-only mock passkey passes the real browser seam, offline and in seconds:
//   nix develop -c bash -c 'cd apps/passport-dapp && node --import tsx e2e/mock-passkey.e2e.ts'
// browserPasskey's enrolment probe and assertionMaterial run unchanged against it; a reload is a
// fresh mock over the same storage.
import assert from 'node:assert/strict';
import {
  accEncryptionKeyFromPasskey,
  assertionMaterial,
  browserPasskey,
  passkeyPrf,
  webauthnPolicy,
  type WebAuthnAssertion,
} from '@midnight-ntwrk/mn-passport-adapter-browser';
import { createMockCredentials, MOCK_PASSKEY_STORAGE_KEY } from '../src/dev/mock-passkey.ts';

const ORIGIN = 'http://localhost:5173';
const RP = 'localhost';
const memory = new Map<string, string>();
const storage = {
  getItem: (key: string) => memory.get(key) ?? null,
  setItem: (key: string, value: string) => void memory.set(key, value),
};
const page = () => createMockCredentials({ storage, origin: ORIGIN });

// Create: the enrolment probe inside browserPasskey.create checks the full wa-json134 material.
const first = page();
const enrolled = await browserPasskey({ rpId: RP, origin: ORIGIN, credentials: first }).create('a');
assert.ok(memory.get(MOCK_PASSKEY_STORAGE_KEY), 'the credential persists');

// Sign: 37-byte authData, flags UP+UV, a DER signature that verifies under the enrolled key.
const signed = await browserPasskey({ rpId: RP, origin: ORIGIN, credentials: first }).sign(
  enrolled,
  new Uint8Array(32).fill(7),
);
assert.equal(signed.authenticator_data.length, 37);
assert.equal(signed.authenticator_data[32], 0x05);

// After a "reload": a new mock over the same storage finds the passkey without an id, and the
// discoverable assertion proves the enrolled key (what openAccount checks).
const reloaded = browserPasskey({ rpId: RP, origin: ORIGIN, credentials: page() });
const identity = await reloaded.identify();
assert.deepEqual(identity.credentialId, enrolled.credentialId);
assert.equal(identity.owns(enrolled.publicKey, enrolled.policy), true);
await reloaded.sign(enrolled, new Uint8Array(32).fill(9));

// PRF: both outputs, stable across the reload, distinct per salt; a PRF ceremony carries extension
// data, so assertionMaterial refuses it as a signing assertion.
const prf = (credentials: CredentialsContainer) =>
  passkeyPrf({ credentialId: enrolled.credentialId, rpId: RP, credentials });
const before = await prf(first);
const after = await prf(page());
assert.deepEqual(after, before);
assert.notDeepEqual(before.root, before.authoriser);
const encKey = await accEncryptionKeyFromPasskey({
  credentialId: enrolled.credentialId,
  rpId: RP,
  networkId: 'undeployed',
  credentials: page(),
});
assert.equal(encKey.length, 32);

const challenge = new Uint8Array(32).fill(1);
const withPrf = (await page().get({
  publicKey: {
    challenge,
    rpId: RP,
    allowCredentials: [{ type: 'public-key', id: new Uint8Array(enrolled.credentialId) }],
    extensions: { prf: { eval: { first: new Uint8Array(32) } } },
  },
})) as PublicKeyCredential;
const response = withPrf.response as AuthenticatorAssertionResponse;
const assertion: WebAuthnAssertion = {
  authenticatorData: new Uint8Array(response.authenticatorData),
  clientDataJSON: new Uint8Array(response.clientDataJSON),
  signature: new Uint8Array(response.signature),
};
assert.throws(
  () => assertionMaterial(challenge, webauthnPolicy(RP, ORIGIN), enrolled.publicKey, assertion),
  /length or RP mismatch/,
);

// A second passkey has its own key and its own PRF secret.
const second = await browserPasskey({ rpId: RP, origin: ORIGIN, credentials: page() }).create('b');
assert.notDeepEqual(second.credentialId, enrolled.credentialId);
const secondPrf = await passkeyPrf({
  credentialId: second.credentialId,
  rpId: RP,
  credentials: page(),
});
assert.notDeepEqual(secondPrf.root, before.root);

// PRF at create, as GPM answers it: create needs two prompts (create, probe), and the encryption
// key comes from the create-time outputs with no third prompt. It matches a separate ceremony.
/** A fresh mock that counts its `get` ceremonies (the enrolment probe and any PRF prompt). */
const counted = (prfAtCreate?: 'results' | 'enabled-only') => {
  const inner = createMockCredentials({ storage, origin: ORIGIN, prfAtCreate });
  const counter = {
    gets: 0,
    credentials: {
      ...inner,
      get: (options?: CredentialRequestOptions) => {
        counter.gets += 1;
        return inner.get(options);
      },
    },
  };
  return counter;
};
const twoPrompts = counted();
const gpm = await browserPasskey({
  rpId: RP,
  origin: ORIGIN,
  credentials: twoPrompts.credentials,
}).create('c');
const encKeyAt = (created: typeof gpm | undefined, credentials: CredentialsContainer) =>
  accEncryptionKeyFromPasskey({
    credentialId: gpm.credentialId,
    created,
    rpId: RP,
    networkId: 'undeployed',
    credentials,
  });
const fromCreate = await encKeyAt(gpm, twoPrompts.credentials);
assert.equal(twoPrompts.gets, 1, 'create and the probe only: no PRF prompt');
assert.deepEqual(await encKeyAt(undefined, page()), fromCreate, 'the same key as a PRF ceremony');

// ?mockPasskey=noprf-results: create answers `enabled` only, so the key needs its own PRF prompt.
const threePrompts = counted('enabled-only');
const noResults = await browserPasskey({
  rpId: RP,
  origin: ORIGIN,
  credentials: threePrompts.credentials,
}).create('d');
await accEncryptionKeyFromPasskey({
  credentialId: noResults.credentialId,
  created: noResults,
  rpId: RP,
  networkId: 'undeployed',
  credentials: threePrompts.credentials,
});
assert.equal(threePrompts.gets, 2, 'the probe, then the fallback PRF ceremony');

console.log(
  'mock passkey: PASS (enrolment probe, assertionMaterial, reload, PRF, PRF at create, fallback)',
);
