// Synthetic extension advertisement for the real optional connector UI. No wallet secrets.
import { MidnightBech32m, UnshieldedAddress } from '@midnightntwrk/wallet-sdk-address-format';
const first = '10000000-0000-0000-0000-000000000001';
const second = '10000000-0000-0000-0000-000000000002';
let mode = 'ready';
let calls: string[] = [];
let release: (() => void) | undefined;
export function installLaceFixture() {
  mode = 'ready';
  calls = [];
  const w = window as unknown as { midnight: Record<string, unknown> };
  const provider = (name: string) => ({
    name,
    rdns: 'io.lace.wallet',
    apiVersion: '4.1.0',
    async connect(networkId: string) {
      calls.push('connect');
      if (mode === 'reject')
        throw {
          type: 'DAppConnectorAPIError',
          code: 'PermissionRejected',
          message: 'do not export this private detail',
        };
      if (mode === 'delay')
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      return {
        async getConnectionStatus() {
          calls.push('status');
          return {
            status: 'connected',
            networkId: mode === 'wrong-network' ? 'mainnet' : networkId,
          };
        },
        async getUnshieldedAddress() {
          calls.push('address');
          return {
            unshieldedAddress: MidnightBech32m.encode(
              'undeployed',
              new UnshieldedAddress(Buffer.from('20'.repeat(32), 'hex')),
            ).asString(),
          };
        },
        async getUnshieldedBalances() {
          calls.push('balances');
          return { ['00'.repeat(32)]: 5n };
        },
        async makeTransfer() {
          throw new Error('Forbidden value method');
        },
        async signData() {
          throw new Error('Forbidden signature method');
        },
      };
    },
  });
  w.midnight[first] = provider('<img src=x onerror=alert(1)> Lace');
  w.midnight[second] = provider('Other Lace advertisement');
}
export function setLaceFixtureMode(value: string) {
  mode = value;
}
export function releaseLaceFixture() {
  release?.();
  release = undefined;
}
export function laceFixtureCalls() {
  return [...calls];
}
export function replaceLaceFixture() {
  const w = window as unknown as { midnight: Record<string, unknown> };
  w.midnight[first] = { name: 'replacement', rdns: 'io.lace.wallet', apiVersion: '4.1.0' };
}
