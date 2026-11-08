import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWalletBalanceReader } from '../src/wallet/balances.ts';

test('repeated reads observe incoming NIGHT on the same wallet without reconnecting', async () => {
  const night = '0'.repeat(64);
  let amount = 0n;
  const wallet = {
    getUnshieldedBalances: async () => ({ [night]: amount }),
    getDustBalance: async () => ({ balance: 0n, cap: 0n }),
  };
  const reader = createWalletBalanceReader({ onDust() {} });
  const before = await reader.refresh(wallet);
  amount = 1n;
  const after = await reader.refresh(wallet);
  assert.equal(before.unshieldedBalances[night], 0n);
  assert.equal(after.unshieldedBalances[night], 1n);
  assert.equal(new Date(after.balanceUpdatedAt).toISOString(), after.balanceUpdatedAt);
});

test('sync failures reject the refresh instead of reporting a zero balance', async () => {
  await assert.rejects(
    createWalletBalanceReader({ onDust() {} }).refresh({
      getUnshieldedBalances: async () => {
        throw new Error('wallet sync timed out');
      },
      getDustBalance: async () => ({ balance: 0n, cap: 0n }),
    }),
    /wallet sync timed out/,
  );
});
