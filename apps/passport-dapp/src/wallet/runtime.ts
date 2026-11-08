// The built-in wallet: a stand-in for lace-sdk's Midnight wallet, shaped like the DApp Connector
// API 4.1.0 (spec §5.5). It is read-only: it never proves or pays, because the Passport flows are
// sponsored by the service. The construction mirrors the reference `createWallet`
// (experiments/acc-0.35/work/acc-45721e1/contract/src/node/wallet.ts), minus its Node-only pieces
// (`ws`, `node:http`, Level storage): the browser's own WebSocket serves the indexer subscription.
//
// Lines marked "FROM D.TS" were taken from the TypeScript declarations of
// @midnightntwrk/wallet-sdk-facade 5.0.0-rc.0 and its shielded, unshielded and dust wallet
// packages, not from a runtime probe (R22: the localnet was unavailable). They are to be confirmed
// by the runtime probe at the localnet session (see the task-12 report).
import '@midnightntwrk/ledger-v9'; // keeps the ledger WASM initialised before the facade uses it, as in the reference
import { NoOpTransactionHistoryStorage } from '@midnightntwrk/wallet-sdk-abstractions';
import { MidnightBech32m } from '@midnightntwrk/wallet-sdk-address-format';
import { DustWallet } from '@midnightntwrk/wallet-sdk-dust-wallet';
import { type FacadeState, WalletFacade } from '@midnightntwrk/wallet-sdk-facade';
import { HDWallet, Roles } from '@midnightntwrk/wallet-sdk-hd';
import { ShieldedWallet } from '@midnightntwrk/wallet-sdk-shielded';
import {
  createKeystore,
  PublicKey,
  UnshieldedWallet,
} from '@midnightntwrk/wallet-sdk-unshielded-wallet';
import * as Rx from 'rxjs';
import { devWalletSession, walletApiError as apiError } from './lifecycle.ts';
import { walletSyncReady } from './sync.js';

import type { DevWallet, DevWalletConfig, DevWalletConnectedApi } from './contracts.js';
const SYNC_TIMEOUT_MS = 120_000;

/**
 * Builds the wallet from a BIP-32 master seed and starts its sync against the service's indexer
 * and node. In the page that seed is the passkey's 64-byte BIP-39 seed (Lace recipe v1,
 * `passkeySeed`), through `HDWallet.fromSeed`. Lace has no phrase-derived Midnight wallet in
 * scope yet, so this is the prototype's stand-in for one. The seed is used for key derivation
 * only; nothing here logs or returns it.
 */
export async function createWalletRuntime(
  seed: Uint8Array,
  config: DevWalletConfig,
): Promise<DevWallet> {
  const hd = HDWallet.fromSeed(seed);
  if (hd.type !== 'seedOk') throw new Error('invalid wallet seed');
  const derived = hd.hdWallet
    .selectAccount(0)
    .selectRoles([Roles.Zswap, Roles.NightExternal, Roles.Dust])
    .deriveKeysAt(0);
  if (derived.type !== 'keysDerived') throw new Error('wallet key derivation failed');
  hd.hdWallet.clear();
  const keys = derived.keys;

  const unshieldedKeystore = createKeystore(
    { kind: 'schnorr', secret: keys[Roles.NightExternal] },
    config.networkId,
  );
  const facade = await WalletFacade.init({
    configuration: {
      networkId: config.networkId,
      indexerClientConnection: {
        indexerHttpUrl: config.indexerUri,
        indexerWsUrl: config.indexerWsUri,
      },
      // Required by the configuration type; never contacted, since this wallet proves nothing.
      provingServerUrl: new URL('http://localhost:6300'),
      relayURL: new URL(config.nodeUri.replace(/^http/, 'ws')),
      costParameters: { feeBlocksMargin: 100 },
      txHistoryStorage: new NoOpTransactionHistoryStorage(),
    },
    shielded: (c) => ShieldedWallet(c).startWithSeed(keys[Roles.Zswap]),
    unshielded: (c) =>
      UnshieldedWallet(c).startWithPublicKey(PublicKey.fromKeyStore(unshieldedKeystore)),
    dust: (c) => DustWallet(c).startWithSeed(keys[Roles.Dust]),
  });
  try {
    await facade.start({
      shielded: keys[Roles.Zswap],
      unshielded: keys[Roles.NightExternal],
      dust: keys[Roles.Dust],
    });
  } catch (e) {
    // Release the indexer connections the half-started wallets opened, then report the failure.
    await facade.stop().catch(() => undefined);
    throw e;
  }

  // Addresses need only the first state. Balance readiness is per wallet: a stalled
  // DUST stream must not hold a ready NIGHT observation or the page's controls.
  const current = (): Promise<FacadeState> => Rx.firstValueFrom(facade.state());
  const synced = (part: 'unshielded' | 'dust'): Promise<FacadeState> =>
    Rx.firstValueFrom(
      facade.state().pipe(
        Rx.filter((s) => walletSyncReady(s, part)),
        // Each asset waits for its own strictly complete snapshot, with a bounded read.
        Rx.timeout({
          first: SYNC_TIMEOUT_MS,
          with: () =>
            Rx.throwError(() =>
              apiError(
                'InternalError',
                `the wallet did not sync within ${SYNC_TIMEOUT_MS / 1000} s`,
              ),
            ),
        }),
      ),
    );
  const bech32 = (address: Parameters<typeof MidnightBech32m.encode>[1]): string =>
    MidnightBech32m.encode(config.networkId, address).asString();

  const connected: DevWalletConnectedApi = {
    getConfiguration: async () => ({
      indexerUri: config.indexerUri,
      indexerWsUri: config.indexerWsUri,
      substrateNodeUri: config.nodeUri,
      networkId: config.networkId,
    }),
    getConnectionStatus: async () => ({ status: 'connected', networkId: config.networkId }),
    getShieldedAddresses: async () => {
      const shielded = (await current()).shielded;
      return {
        // FROM D.TS: ShieldedWalletState.address (ShieldedAddress), .coinPublicKey, .encryptionPublicKey
        shieldedAddress: bech32(shielded.address),
        shieldedCoinPublicKey: shielded.coinPublicKey.toHexString(),
        shieldedEncryptionPublicKey: shielded.encryptionPublicKey.toHexString(),
      };
    },
    // FROM D.TS: UnshieldedWalletState.address (UnshieldedAddress), encoded as mn_addr_<network>1…
    getUnshieldedAddress: async () => ({
      unshieldedAddress: bech32((await current()).unshielded.address),
    }),
    // FROM D.TS: DustWalletState.address (DustAddress), encoded as mn_dust_<network>1…
    getDustAddress: async () => ({ dustAddress: bech32((await current()).dust.address) }),
    // FROM D.TS: UnshieldedWalletState.balances (Record<RawTokenType, bigint>)
    getUnshieldedBalances: async () => ({ ...(await synced('unshielded')).unshielded.balances }),
    // FROM D.TS: DustWalletState.balance(time: Date): bigint (Specks); the cap is the sum of
    // DustFullInfo.maxCap over DustWalletState.availableCoins. To be confirmed by the runtime
    // probe at the localnet session (task-12 report), together with whether the API's `cap` is
    // this sum.
    getDustBalance: async () => {
      const dust = (await synced('dust')).dust;
      return {
        balance: dust.balance(new Date()),
        cap: dust.availableCoins.reduce((total, coin) => total + coin.maxCap, 0n),
      };
    },
  };

  return devWalletSession(config.networkId, connected, () => facade.stop());
}
