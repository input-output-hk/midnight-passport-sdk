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

/** What each `get` asked for, and which credential the "user" picks in a discoverable prompt. */
const gets: CredentialRequestOptions[] = [];
/**
 * A CredentialsContainer stand-in whose PRF is a fixed function of each salt, or absent. A pinned
 * request answers with `answer` (a misbehaving picker when it differs from the pinned id).
 */
const container = (prf: boolean, answer: Uint8Array = ID): CredentialsContainer =>
  ({
    async get(options?: CredentialRequestOptions) {
      gets.push(options ?? {});
      const salts = options?.publicKey?.extensions?.prf?.eval;
      return {
        rawId: answer.slice().buffer,
        getClientExtensionResults: () =>
          prf && salts
            ? { prf: { results: { first: sha256(salts.first), second: sha256(salts.second!) } } }
            : {},
      };
    },
  }) as unknown as CredentialsContainer;
const pinnedTo = (options: CredentialRequestOptions | undefined): Uint8Array[] =>
  (options?.publicKey?.allowCredentials ?? []).map((c) => new Uint8Array(c.id as ArrayBuffer));

const genesis = new Uint8Array(32);
genesis[31] = 1;

// With PRF: the passkey's 64-byte BIP-39 seed, the same on every connect, never the genesis seed.
const seed = await walletSeed({
  accountCredentialId: ID,
  rpId: 'localhost',
  credentials: container(true),
});
assert.equal(seed.length, 64);
assert.deepEqual(
  await walletSeed({ accountCredentialId: ID, rpId: 'localhost', credentials: container(true) }),
  seed,
);
assert.notDeepEqual(seed.subarray(0, 32), genesis);

// An open account pins the wallet's ceremony to its own passkey: one prompt, no picker.
gets.length = 0;
await walletSeed({ accountCredentialId: ID, rpId: 'localhost', credentials: container(true) });
assert.equal(gets.length, 1, 'one pinned PRF prompt');
assert.deepEqual(pinnedTo(gets[0]), [ID]);
assert.ok(gets[0]?.publicKey?.extensions?.prf, 'the pinned prompt is the PRF ceremony');

// No open account: a discoverable picker (no allowCredentials), then the PRF pinned to the pick.
gets.length = 0;
assert.deepEqual(await walletSeed({ rpId: 'localhost', credentials: container(true) }), seed);
assert.equal(gets.length, 2, 'picker, then PRF');
assert.deepEqual(pinnedTo(gets[0]), []);
assert.equal(gets[0]?.publicKey?.extensions, undefined);
assert.deepEqual(pinnedTo(gets[1]), [ID]);

// The picker answers with another passkey than the account's: a clear error, and no seed.
await assert.rejects(
  walletSeed({
    accountCredentialId: ID,
    rpId: 'localhost',
    credentials: container(true, Uint8Array.of(9, 9)),
  }),
  {
    code: 'AccountNotFound',
    message: 'This is not the passkey this account was created with; choose that passkey.',
  },
);

// Without PRF: UnsupportedAuthenticator, and no fallback seed of any kind.
await assert.rejects(
  walletSeed({ accountCredentialId: ID, rpId: 'localhost', credentials: container(false) }),
  (e: unknown) => {
    const err = e as { code?: string; message?: string };
    return err.code === 'UnsupportedAuthenticator' && !/\b01\b|seed/i.test(err.message ?? '');
  },
);
console.log('seed policy: PASS (fails closed without PRF; pinned to the open account)');
