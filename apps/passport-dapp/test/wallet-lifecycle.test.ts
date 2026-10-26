import assert from 'node:assert/strict';
import { test } from 'node:test';
import { devWalletSession } from '../src/wallet/lifecycle.ts';
import type { DevWalletConnectedApi } from '../src/wallet/dev-wallet.ts';

test('wallet stop invalidates existing handles, new connections and late balance reads', async () => {
  let resolve!: (v: Record<string, bigint>) => void;
  let stops = 0;
  const api = {
    getUnshieldedBalances: () =>
      new Promise<Record<string, bigint>>((r) => {
        resolve = r;
      }),
    getConnectionStatus: async () => ({ status: 'connected' as const, networkId: 'undeployed' }),
  } as DevWalletConnectedApi;
  const wallet = devWalletSession('undeployed', api, async () => {
    stops++;
  });
  const handle = await wallet.descriptor.connect('undeployed');
  await assert.rejects(wallet.descriptor.connect('testnet'), { code: 'InvalidRequest' });
  const pending = handle.getUnshieldedBalances();
  const refused = assert.rejects(pending, { code: 'Disconnected' });
  await Promise.all([wallet.stop(), wallet.stop()]);
  resolve({ NIGHT: 1n });
  await refused;
  await assert.rejects(handle.getConnectionStatus(), { code: 'Disconnected' });
  await assert.rejects(wallet.descriptor.connect('undeployed'), { code: 'Disconnected' });
  assert.equal(stops, 1);
});

test('failed runtime cleanup still leaves the old session invalid and is not repeated', async () => {
  let stops = 0;
  const wallet = devWalletSession('undeployed', {} as DevWalletConnectedApi, async () => {
    stops++;
    throw new Error('cleanup failed');
  });
  await assert.rejects(wallet.stop(), /cleanup failed/);
  await assert.rejects(wallet.stop(), /cleanup failed/);
  await assert.rejects(wallet.descriptor.connect('undeployed'), { code: 'Disconnected' });
  assert.equal(stops, 1);
});
