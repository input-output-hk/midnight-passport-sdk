import '../polyfills.js';
import { serveBackgroundTasks } from '@input-output-hk/mn-passport-account/background';
import { browserBackgroundPort } from '@input-output-hk/mn-passport-adapter-browser/background';
import type { DevWallet, DevWalletConfig, DevWalletConnectedApi } from './contracts.js';

let wallet: DevWallet | undefined;
let api: DevWalletConnectedApi | undefined;
let initializing = false;
const methods: Record<string, (input: unknown) => Promise<unknown>> = {
  async initialize(input) {
    if (initializing || wallet || !input || typeof input !== 'object')
      throw new Error('Invalid initialization.');
    initializing = true;
    let seed: Uint8Array | undefined;
    try {
      if (!('seed' in input) || !(input.seed instanceof Uint8Array))
        throw new Error('Invalid seed.');
      seed = input.seed;
      if (
        seed.length !== 64 ||
        !('config' in input) ||
        !input.config ||
        typeof input.config !== 'object'
      )
        throw new Error('Invalid wallet configuration.');
      const value = input.config as Record<string, unknown>;
      if (
        ['networkId', 'indexerUri', 'indexerWsUri', 'nodeUri'].some(
          (key) =>
            typeof value[key] !== 'string' ||
            !(value[key] as string).length ||
            (value[key] as string).length > 4096,
        )
      )
        throw new Error('Invalid wallet configuration.');
      const config: DevWalletConfig = {
        networkId: value.networkId as string,
        indexerUri: value.indexerUri as string,
        indexerWsUri: value.indexerWsUri as string,
        nodeUri: value.nodeUri as string,
      };
      const { createWalletRuntime } = await import('./runtime.js');
      wallet = await createWalletRuntime(seed, config);
      api = await wallet.descriptor.connect(config.networkId);
      return { ready: true };
    } catch (error) {
      await wallet?.stop().catch(() => undefined);
      wallet = undefined;
      api = undefined;
      throw error;
    } finally {
      seed?.fill(0);
      initializing = false;
    }
  },
};
const reads = [
  'getConfiguration',
  'getConnectionStatus',
  'getShieldedAddresses',
  'getUnshieldedAddress',
  'getDustAddress',
  'getUnshieldedBalances',
  'getDustBalance',
] as const;
for (const name of reads)
  methods[name] = async () => {
    if (!api) throw new Error('Wallet unavailable.');
    return api[name]();
  };
// Each page owns one dedicated worker. Worker termination is its cleanup boundary.
serveBackgroundTasks(
  browserBackgroundPort(self, () => {}),
  { channel: 'passport-wallet', methods },
);
