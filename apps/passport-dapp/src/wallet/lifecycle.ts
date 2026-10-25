import type {
  DevWallet,
  DevWalletApiError,
  DevWalletConnectedApi,
  DevWalletErrorCode,
} from './dev-wallet.ts';

export const walletApiError = (code: DevWalletErrorCode, reason: string): DevWalletApiError =>
  Object.assign(new Error(reason), { type: 'DAppConnectorAPIError' as const, code, reason });

/** A stopped provider never returns a live-looking handle or a late cached balance. */
export function devWalletSession(
  networkId: string,
  api: DevWalletConnectedApi,
  stopRuntime: () => Promise<void>,
): DevWallet {
  let stopped = false;
  let stopping: Promise<void> | undefined;
  const assertOpen = () => {
    if (stopped) throw walletApiError('Disconnected', 'the wallet session was stopped');
  };
  const guard =
    <T>(work: () => Promise<T>) =>
    async (): Promise<T> => {
      assertOpen();
      try {
        const value = await work();
        assertOpen();
        return value;
      } catch (error) {
        assertOpen();
        throw error;
      }
    };
  const connected: DevWalletConnectedApi = {
    getConfiguration: guard(() => api.getConfiguration()),
    getConnectionStatus: guard(() => api.getConnectionStatus()),
    getShieldedAddresses: guard(() => api.getShieldedAddresses()),
    getUnshieldedAddress: guard(() => api.getUnshieldedAddress()),
    getDustAddress: guard(() => api.getDustAddress()),
    getUnshieldedBalances: guard(() => api.getUnshieldedBalances()),
    getDustBalance: guard(() => api.getDustBalance()),
  };
  return {
    descriptor: {
      name: 'Built-in dev wallet',
      apiVersion: '4.1.0',
      rdns: 'io.iohk.passport.devwallet',
      async connect(network) {
        assertOpen();
        if (network !== networkId)
          throw walletApiError('InvalidRequest', `the wallet is on ${networkId}, not ${network}`);
        return connected;
      },
    },
    stop() {
      stopped = true;
      stopping ??= Promise.resolve().then(stopRuntime);
      return stopping;
    },
  };
}
