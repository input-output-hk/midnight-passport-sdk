// Synthetic balance observation only; no real wallet, HD derivation or network effects.
import { MidnightBech32m, UnshieldedAddress } from '@midnightntwrk/wallet-sdk-address-format';
import { Buffer } from 'buffer';
export async function createDevWallet(_seed: Uint8Array, config: { networkId: string }) {
  const fixture = window as unknown as {
    __demoWalletStarts?: number;
    __demoHoldWalletStop?: () => Promise<void>;
  };
  fixture.__demoWalletStarts = (fixture.__demoWalletStarts ?? 0) + 1;
  const address = MidnightBech32m.encode(
    config.networkId,
    new UnshieldedAddress(Buffer.alloc(32, 7)),
  ).asString();
  const api = {
    getConfiguration: async () => config,
    getUnshieldedAddress: async () => ({ unshieldedAddress: address }),
    getDustAddress: async () => ({ dustAddress: 'synthetic-dust-address' }),
    getShieldedAddresses: async () => ({ shieldedAddress: 'synthetic-shielded-address' }),
    getUnshieldedBalances: async () => {
      const s = await (
        await fetch('/__demo-fixture', {
          method: 'POST',
          body: JSON.stringify({ action: 'wallet' }),
        })
      ).json();
      return { ['00'.repeat(32)]: BigInt(s.wallet) };
    },
    getDustBalance: async () => ({ balance: 0n, cap: 0n }),
  };
  return {
    descriptor: { connect: async () => api },
    stop: async () => {
      await fixture.__demoHoldWalletStop?.();
    },
  };
}
