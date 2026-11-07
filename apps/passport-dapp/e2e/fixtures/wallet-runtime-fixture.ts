// Worker wiring qualification only. No Midnight proof, provider or real balance claim.
export async function createWalletRuntime(seed: Uint8Array, config: { networkId: string }) {
  if (typeof document !== 'undefined') throw new Error('Wallet runtime ran on the UI thread.');
  return {
    descriptor: {
      async connect() {
        return {
          getConfiguration: async () => ({
            networkId: config.networkId,
            indexerUri: 'http://synthetic',
            indexerWsUri: 'ws://synthetic',
            substrateNodeUri: 'http://synthetic',
          }),
          getConnectionStatus: async () => ({ status: 'connected', networkId: config.networkId }),
          getUnshieldedAddress: async () => ({ unshieldedAddress: 'synthetic-user' }),
          getDustAddress: async () => ({ dustAddress: 'synthetic-dust' }),
          getShieldedAddresses: async () => ({
            shieldedAddress: 'synthetic-shielded',
            shieldedCoinPublicKey: '11'.repeat(32),
            shieldedEncryptionPublicKey: '22'.repeat(32),
          }),
          getUnshieldedBalances: async () => {
            const until = performance.now() + 200;
            while (performance.now() < until) {
              /* Deliberate off-thread CPU qualification. */
            }
            return { ['00'.repeat(32)]: 7n };
          },
          // The real worker entry clears the cloned initialization seed before any later read.
          getDustBalance: async () => ({ balance: BigInt(seed[0] ?? 255), cap: 9n }),
        };
      },
    },
    stop: async () => {},
  };
}
