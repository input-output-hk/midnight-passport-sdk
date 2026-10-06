// The built-in wallet's seed fails closed (spec §5.5), with no network needed:
//   nix develop -c bash -c 'cd apps/passport-dapp && node --import tsx e2e/seed-policy.e2e.ts'
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { walletSeed } from '../src/wallet/seed.ts';

const ID = Uint8Array.of(1, 2, 3);
const sha256 = (data: BufferSource): ArrayBuffer =>
  new Uint8Array(
    createHash('sha256')
      .update(new Uint8Array(data as ArrayBuffer))
      .digest(),
  ).buffer;

/** A CredentialsContainer stand-in whose PRF is a fixed function of each salt, or absent. */
const container = (prf: boolean): CredentialsContainer =>
  ({
    async get(options?: CredentialRequestOptions) {
      const salts = options?.publicKey?.extensions?.prf?.eval;
      return {
        rawId: ID.slice().buffer,
        getClientExtensionResults: () =>
          prf && salts
            ? { prf: { results: { first: sha256(salts.first), second: sha256(salts.second!) } } }
            : {},
      };
    },
  }) as unknown as CredentialsContainer;

const genesis = new Uint8Array(32);
genesis[31] = 1;

// With PRF: the passkey's 64-byte BIP-39 seed, the same on every connect, never the genesis seed.
const seed = await walletSeed({
  credentialId: ID,
  rpId: 'localhost',
  credentials: container(true),
});
assert.equal(seed.length, 64);
assert.deepEqual(
  await walletSeed({ credentialId: ID, rpId: 'localhost', credentials: container(true) }),
  seed,
);
assert.notDeepEqual(seed.subarray(0, 32), genesis);

// Without PRF: UnsupportedAuthenticator, and no fallback seed of any kind.
await assert.rejects(
  walletSeed({ credentialId: ID, rpId: 'localhost', credentials: container(false) }),
  (e: unknown) => {
    const err = e as { code?: string; message?: string };
    return err.code === 'UnsupportedAuthenticator' && !/\b01\b|seed/i.test(err.message ?? '');
  },
);
console.log('seed policy: PASS (fails closed without PRF)');
