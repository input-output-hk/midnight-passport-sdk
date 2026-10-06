// The fallback-seed rule (R22, R24), with no network needed:
//   nix develop -c bash -c 'cd apps/passport-dapp && node --import tsx e2e/seed-policy.e2e.ts'
import assert from 'node:assert/strict';
import { resolveWalletSeed } from '../src/wallet/seed.ts';

const prf = new Uint8Array(32).fill(7);
assert.deepEqual(resolveWalletSeed(prf, 'undeployed'), { seed: prf, source: 'passkey-prf' });
assert.deepEqual(resolveWalletSeed(prf, 'preview'), { seed: prf, source: 'passkey-prf' });

// Without PRF: a fresh random seed each time, never the genesis (and sponsor) seed 0…01.
const genesis = new Uint8Array(32);
genesis[31] = 1;
const first = resolveWalletSeed(undefined, 'undeployed');
const second = resolveWalletSeed(undefined, 'undeployed');
for (const fallback of [first, second]) {
  assert.equal(fallback.source, 'ephemeral-random');
  assert.equal(fallback.seed.length, 32);
  assert.notDeepEqual(fallback.seed, genesis);
}
assert.notDeepEqual(first.seed, second.seed, 'each fallback is a new wallet');

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
