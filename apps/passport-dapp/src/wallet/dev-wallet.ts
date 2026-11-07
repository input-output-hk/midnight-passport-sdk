// Browser wallet SDK work lives in a dedicated worker. Node qualification uses the
// same runtime directly; UI and credential APIs are never imported into that runtime.
import {
  BackgroundError,
  createBackgroundClient,
} from '@input-output-hk/mn-passport-account/background';
import { browserBackgroundPort } from '@input-output-hk/mn-passport-adapter-browser/background';
import { devWalletSession, walletApiError } from './lifecycle.js';
import type { DevWallet, DevWalletConfig, DevWalletConnectedApi } from './contracts.js';
export type * from './contracts.js';

export async function createDevWallet(
  seed: Uint8Array,
  config: DevWalletConfig,
): Promise<DevWallet> {
  if (typeof window === 'undefined') {
    const { createWalletRuntime } = await import('./runtime.js');
    return createWalletRuntime(seed, config);
  }
  const worker = new Worker(new URL('./worker.ts', import.meta.url), {
    type: 'module',
    name: 'passport-wallet',
  });
  const client = createBackgroundClient(
    browserBackgroundPort(worker, () => worker.terminate()),
    {
      channel: 'passport-wallet',
      timeoutMs: 150_000,
    },
  );
  const owned = Uint8Array.from(seed);
  try {
    const ready = await client.request('initialize', { seed: owned, config: { ...config } });
    if (!ready || typeof ready !== 'object' || !('ready' in ready) || ready.ready !== true)
      throw new Error('Invalid worker initialization.');
  } catch (error) {
    client.close();
    throw error;
  } finally {
    owned.fill(0);
  }
  // Only these read methods cross the boundary. The worker owns the wallet SDK,
  // indexer subscriptions, DUST sync and address derivation, never a passkey ceremony.
  const call = async <K extends keyof DevWalletConnectedApi>(
    method: K,
  ): Promise<Awaited<ReturnType<DevWalletConnectedApi[K]>>> => {
    try {
      const result = await client.request(method, undefined);
      return validateWalletReply(method, result) as Awaited<ReturnType<DevWalletConnectedApi[K]>>;
    } catch (error) {
      throw walletBackgroundError(error);
    }
  };
  return devWalletSession(
    config.networkId,
    {
      getConfiguration: () => call('getConfiguration'),
      getConnectionStatus: () => call('getConnectionStatus'),
      getShieldedAddresses: () => call('getShieldedAddresses'),
      getUnshieldedAddress: () => call('getUnshieldedAddress'),
      getDustAddress: () => call('getDustAddress'),
      getUnshieldedBalances: () => call('getUnshieldedBalances'),
      getDustBalance: () => call('getDustBalance'),
    },
    async () => {
      // Termination releases owned sockets and any stalled sync without waiting two minutes.
      client.close();
    },
  );
}

/** Preserve the connector error contract without exposing worker/provider exception text. */
export function walletBackgroundError(error: unknown) {
  const disconnected =
    error instanceof BackgroundError && ['Closed', 'Unavailable'].includes(error.code);
  return walletApiError(
    disconnected ? 'Disconnected' : 'InternalError',
    disconnected
      ? 'The wallet worker disconnected. Reconnect the built-in wallet.'
      : 'The wallet background read failed. Refresh to retry.',
  );
}

export function validateWalletReply(method: keyof DevWalletConnectedApi, value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid worker wallet reply.');
  const record = value as Record<string, unknown>;
  const strings: Partial<Record<keyof DevWalletConnectedApi, readonly string[]>> = {
    getConfiguration: ['indexerUri', 'indexerWsUri', 'substrateNodeUri', 'networkId'],
    getConnectionStatus: ['status', 'networkId'],
    getShieldedAddresses: [
      'shieldedAddress',
      'shieldedCoinPublicKey',
      'shieldedEncryptionPublicKey',
    ],
    getUnshieldedAddress: ['unshieldedAddress'],
    getDustAddress: ['dustAddress'],
  };
  const fields = strings[method];
  if (fields) {
    if (
      fields.some(
        (field) =>
          typeof record[field] !== 'string' ||
          (record[field] as string).length === 0 ||
          (record[field] as string).length > 4096,
      ) ||
      (method === 'getConnectionStatus' && record.status !== 'connected')
    )
      throw new Error('Invalid worker wallet reply.');
    return Object.fromEntries(fields.map((field) => [field, record[field]]));
  }
  const entries = Object.entries(record);
  if (
    entries.length > 1024 ||
    entries.some(
      ([key, amount]) =>
        typeof amount !== 'bigint' ||
        amount < 0n ||
        (method === 'getUnshieldedBalances' && !/^[0-9a-f]{64}$/.test(key)),
    ) ||
    (method === 'getDustBalance' &&
      (entries.length !== 2 || !('balance' in record) || !('cap' in record)))
  )
    throw new Error('Invalid worker wallet reply.');
  return Object.fromEntries(entries);
}
