import { PassportConnectorError } from '@input-output-hk/mn-passport-account';
import { fetchServiceConfig } from '@input-output-hk/mn-passport-adapter-service';

import { RP_ID, SERVICE_URL } from './connector.js';

import { tracedFetch, traceOperation } from './operation-trace.js';

import { walletSeed } from './wallet/seed.js';
import { beforeDemoCeremony } from './consent.js';

import { routineKeys, checkRoutineReview } from './routine-access.js';

import type { DemoActionHost } from './app-model.js';
import { publishDemoWallet } from './browser-registry.js';
export class WalletActions {
  constructor(private readonly host: DemoActionHost) {}
  walletRefresh = async () => {
    if (!this.host.state.devWallet)
      throw new Error('Connect the built-in wallet before refreshing its balance.');
    this.host.status('Waiting for wallet sync to refresh balances…');
    const w = await this.host.state.devWallet.descriptor.connect(this.host.network);
    await this.host.ui.attempt('balances', () =>
      this.host.walletPresentation.refresh(w, 'refresh'),
    );
  };
  connect = async (): Promise<void> => {
    checkRoutineReview();
    const lease = this.host.state.account && routineKeys.lease(this.host.state.account);
    this.host.status('Reading the service configuration…');
    const config = await fetchServiceConfig(SERVICE_URL, tracedFetch, this.host.network);
    if (config.networkId !== this.host.network) {
      throw new PassportConnectorError(
        'NetworkMismatch',
        `service is on ${config.networkId}, the page is bound to ${this.host.network}`,
      );
    }
    this.host.stage('seed');
    checkRoutineReview();
    lease?.();
    // With an open account the PRF ceremony is pinned to its passkey (one prompt, no picker); with
    // none, the user picks a passkey first. Fails closed: without PRF this throws
    // UnsupportedAuthenticator, and no other wallet opens.
    this.host.status(
      lease
        ? 'Using the unlocked built-in wallet seed…'
        : this.host.state.account
          ? "Confirm with this account's passkey to derive the wallet seed (PRF)…"
          : 'Choose your passkey once to derive the wallet seed (PRF)…',
    );
    const cachedSeed = this.host.state.account && routineKeys.walletSeed(this.host.state.account);
    if (lease && !cachedSeed)
      throw new Error('Quick actions are locked or expired. Unlock again with your passkey.');
    const seed =
      cachedSeed ||
      (await walletSeed({
        rpId: RP_ID,
        accountCredentialId: this.host.state.account?.credentialId,
        beforeCeremony: beforeDemoCeremony,
      }));
    traceOperation('wallet.seed.derived', {
      source: 'passkey PRF (Lace recipe v1)',
      accountPinned: !!this.host.state.account,
    });
    this.host.stage('sync');
    this.host.status('Syncing the built-in wallet…');
    try {
      // Loaded on demand: the ledger WASM and the wallet SDK stay out of page start-up.
      const { createDevWallet } = await import('./wallet/dev-wallet.js');
      const previousWallet = this.host.state.devWallet;
      this.host.state.devWallet = undefined;
      this.host.walletPresentation.invalidate();
      this.host.ui.clearWallet();
      await previousWallet?.stop();
      lease?.();
      checkRoutineReview();
      const started = await createDevWallet(seed, config);
      try {
        lease?.();
        checkRoutineReview();
      } catch (error) {
        await started.stop();
        throw error;
      }
      this.host.state.devWallet = started;
      traceOperation('wallet.facade.started', { networkId: this.host.network });
    } finally {
      seed.fill(0);
    }
    publishDemoWallet(this.host.state.devWallet);
    const w = await this.host.state.devWallet.descriptor.connect(this.host.network);
    const unshielded = await w.getUnshieldedAddress();
    const dust = await w.getDustAddress();
    this.host.record('wallet', {
      seedSource: 'passkey PRF (Lace recipe v1)',
      configuration: await w.getConfiguration(),
      unshielded,
      dust,
    });
    traceOperation('wallet.connected', {
      seedSource: 'passkey PRF (Lace recipe v1)',
      networkId: this.host.network,
      unshieldedAddress: unshielded.unshieldedAddress,
      dustAddress: dust.dustAddress,
    });
    this.host.ui.showWallet({
      unshieldedAddress: unshielded.unshieldedAddress,
      dustAddress: dust.dustAddress,
    });
    this.host.status('Built-in wallet connected; waiting for it to sync to read the balances…');
    // Reads that can time out while the wallet itself works: a failure marks only this step.
    await this.host.ui.attempt('balances', () =>
      this.host.walletPresentation.refresh(w, 'connect'),
    );
  };
}
