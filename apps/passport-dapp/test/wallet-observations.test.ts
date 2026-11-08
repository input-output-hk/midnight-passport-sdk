import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createWalletBalanceReader, type DustObservation } from '../src/wallet/balances.js';
import { walletSyncReady } from '../src/wallet/sync.js';
import { walletFacts } from '../src/wallet/view.js';
import { createWalletPresentation } from '../src/wallet/presentation.js';
import type { DevWalletConnectedApi } from '../src/wallet/contracts.js';
import type { WalletView } from '../src/wallet/view.js';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

test('NIGHT resolves while DUST is pending; shared DUST work does not fill the worker queue', async () => {
  const dust = deferred<{ balance: bigint; cap: bigint }>();
  const updates: DustObservation[] = [];
  let dustReads = 0;
  const reader = createWalletBalanceReader({ onDust: (update) => updates.push(update) });
  const wallet = {
    getUnshieldedBalances: async () => ({ '00': 7n }),
    getDustBalance: () => {
      dustReads++;
      return dust.promise;
    },
  };
  assert.equal((await reader.refresh(wallet)).unshieldedBalances['00'], 7n);
  assert.equal((await reader.refresh(wallet)).unshieldedBalances['00'], 7n);
  assert.equal(dustReads, 1);
  assert.ok(updates.every((update) => update.status === 'syncing'));
  dust.resolve({ balance: 2n, cap: 9n });
  await flush();
  assert.equal(updates.filter((update) => update.status === 'ready').length, 1);
  assert.equal(updates.at(-1)?.revision, 2);
});

test('newer refresh and disconnect fence late NIGHT and DUST completions', async () => {
  const old = deferred<Record<string, bigint>>(),
    current = deferred<Record<string, bigint>>(),
    dust = deferred<{ balance: bigint; cap: bigint }>();
  let reads = 0;
  const updates: DustObservation[] = [];
  const reader = createWalletBalanceReader({ onDust: (update) => updates.push(update) });
  const wallet = {
    getUnshieldedBalances: () => (++reads === 1 ? old.promise : current.promise),
    getDustBalance: () => dust.promise,
  };
  const before = reader.refresh(wallet);
  const rejected = assert.rejects(before, /replaced/);
  const after = reader.refresh(wallet);
  current.resolve({ '00': 2n });
  assert.equal((await after).unshieldedBalances['00'], 2n);
  old.resolve({ '00': 1n });
  await rejected;
  reader.invalidate();
  dust.resolve({ balance: 1n, cap: 2n });
  await flush();
  assert.ok(updates.every((update) => update.status === 'syncing'));
});

test('DUST failure leaves ready NIGHT visible and a later refresh retries only the failed observation', async () => {
  const updates: DustObservation[] = [];
  let attempt = 0;
  const reader = createWalletBalanceReader({ onDust: (update) => updates.push(update) });
  const wallet = {
    getUnshieldedBalances: async () => ({ '00': 5n }),
    getDustBalance: async () => {
      if (++attempt === 1) throw Error('dust unavailable');
      return { balance: 1n, cap: 2n };
    },
  };
  assert.equal((await reader.refresh(wallet)).unshieldedBalances['00'], 5n);
  await flush();
  assert.equal(updates.at(-1)?.status, 'unavailable');
  await reader.refresh(wallet);
  await flush();
  assert.equal(updates.at(-1)?.status, 'ready');
  const facts = walletFacts({
    unshieldedBalances: { ['00'.repeat(32)]: 5n },
    dustStatus: 'unavailable',
  });
  assert.equal(facts.find((fact) => fact.label === 'NIGHT (built-in wallet)')?.value, '5');
  assert.equal(facts.find((fact) => fact.label === 'DUST')?.value, 'Unavailable');
});

test('NIGHT readiness never inspects the DUST state or the aggregate facade flag', () => {
  const state = {
    unshielded: { progress: { isStrictlyComplete: () => true } },
    get dust(): never {
      throw Error('unrelated stalled DUST');
    },
    get isSynced(): never {
      throw Error('aggregate gate');
    },
  };
  assert.equal(walletSyncReady(state, 'unshielded'), true);
  assert.equal(
    walletSyncReady(
      {
        unshielded: { progress: { isStrictlyComplete: () => false } },
        dust: { progress: { isStrictlyComplete: () => true } },
      },
      'dust',
    ),
    true,
  );
});

test('observer failure cannot fail NIGHT, and NIGHT failure does not discard independent DUST', async () => {
  const reader = createWalletBalanceReader({
    onDust() {
      throw Error('rendering failed');
    },
  });
  assert.equal(
    (
      await reader.refresh({
        getUnshieldedBalances: async () => ({ '00': 1n }),
        getDustBalance: async () => ({ balance: 1n, cap: 2n }),
      })
    ).unshieldedBalances['00'],
    1n,
  );
  const dust = deferred<{ balance: bigint; cap: bigint }>();
  const updates: DustObservation[] = [];
  const other = createWalletBalanceReader({ onDust: (update) => updates.push(update) });
  await assert.rejects(
    other.refresh({
      getUnshieldedBalances: async () => {
        throw Error('night unavailable');
      },
      getDustBalance: () => dust.promise,
    }),
    /night unavailable/,
  );
  dust.resolve({ balance: 1n, cap: 2n });
  await flush();
  assert.equal(updates.at(-1)?.status, 'ready');
});

test('a late address read cannot repaint an old wallet after a new observation completes', async () => {
  const oldAddress = deferred<Awaited<ReturnType<DevWalletConnectedApi['getShieldedAddresses']>>>();
  const updates: WalletView[] = [];
  const presentation = createWalletPresentation({
    network: 'undeployed',
    showWallet: (view) => updates.push(view),
    record() {},
    status() {},
    trace() {},
  });
  const wallet = (address: string): DevWalletConnectedApi => ({
    getConfiguration: async () => ({
      networkId: 'undeployed',
      indexerUri: 'http://test',
      indexerWsUri: 'ws://test',
      substrateNodeUri: 'http://test',
    }),
    getConnectionStatus: async () => ({ status: 'connected', networkId: 'undeployed' }),
    getUnshieldedAddress: async () => ({ unshieldedAddress: address }),
    getDustAddress: async () => ({ dustAddress: address }),
    getShieldedAddresses: async () => ({
      shieldedAddress: address,
      shieldedCoinPublicKey: '11'.repeat(32),
      shieldedEncryptionPublicKey: '22'.repeat(32),
    }),
    getUnshieldedBalances: async () => ({ '00': 1n }),
    getDustBalance: async () => ({ balance: 1n, cap: 2n }),
  });
  const first = wallet('old');
  first.getShieldedAddresses = () => oldAddress.promise;
  const old = presentation.refresh(first, 'connect');
  const rejected = assert.rejects(old, /replaced/);
  await presentation.refresh(wallet('new'), 'connect');
  oldAddress.resolve({
    shieldedAddress: 'old',
    shieldedCoinPublicKey: '11'.repeat(32),
    shieldedEncryptionPublicKey: '22'.repeat(32),
  });
  await rejected;
  assert.deepEqual(
    updates.filter((view) => view.shieldedAddress).map((view) => view.shieldedAddress),
    ['new'],
  );
});
