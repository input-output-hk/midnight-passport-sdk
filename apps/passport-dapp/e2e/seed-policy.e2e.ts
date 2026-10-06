// The fallback-seed rule (R22), with no network needed:
//   nix develop -c bash -c 'cd apps/passport-dapp && node --import tsx e2e/seed-policy.e2e.ts'
import assert from 'node:assert/strict';
import { resolveWalletSeed } from '../src/wallet/seed.ts';

const prf = new Uint8Array(32).fill(7);
assert.deepEqual(resolveWalletSeed(prf, 'undeployed'), { seed: prf, source: 'passkey-prf' });
assert.deepEqual(resolveWalletSeed(prf, 'preview'), { seed: prf, source: 'passkey-prf' });

const fallback = resolveWalletSeed(undefined, 'undeployed');
assert.equal(fallback.source, 'fallback-dev-seed');
assert.equal(fallback.seed.length, 32);
assert.equal(fallback.seed[31], 1);

for (const network of ['preview', 'preprod', 'mainnet']) {
  assert.throws(
    () => resolveWalletSeed(undefined, network),
    (e: unknown) => {
      const err = e as { code?: string; message?: string };
      return err.code === 'UnsupportedAuthenticator' && !/\b01\b|seed/i.test(err.message ?? '');
    },
  );
}
console.log('seed policy: PASS');
