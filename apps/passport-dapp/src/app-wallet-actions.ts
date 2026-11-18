import { fetchCheckedV1Config } from '@input-output-hk/mn-passport-adapter-service';

import { ARTEFACT_URL, BINDING_ID, MANIFEST_SHA256, RP_ID, SERVICE_URL } from './connector.js';

import { tracedFetch, traceOperation } from './operation-trace.js';

import { walletSeed } from './wallet/seed.js';
import { beforeDemoCeremony } from './consent.js';

import { routineKeys, checkRoutineReview } from './routine-access.js';

import type { DemoActionHost } from './app-model.js';
import { publishDemoWallet } from './browser-registry.js';
import { readFinalizedDustRegistration } from './midnames/night-finality.js';
import { openDustRegistrationJournal } from './wallet/dust-registration-journal.js';

async function waitForRegistration(
  indexerUrl: string,
  nodeUrl: string,
  original: import('./midnames/night-send.js').NightSendLeg,
) {
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    if (await readFinalizedDustRegistration(indexerUrl, nodeUrl, original)) return true;
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  return false;
}

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
  walletDust = async () => {
    const wallet = this.host.state.devWallet;
    if (!wallet?.nightBridge || this.host.network !== 'undeployed')
      throw new Error('Connect the built-in wallet on the local Ledger 9 network first.');
    const connected = await wallet.descriptor.connect(this.host.network);
    const config = await connected.getConfiguration();
    const address = (await connected.getUnshieldedAddress()).unshieldedAddress;
    const journal = await openDustRegistrationJournal(
      indexedDB,
      this.host.network,
      address,
      localStorage,
    );
    try {
      const pending = await journal.read();
      if (pending) {
        this.host.stage('finality');
        this.host.status(`Checking original DUST registration ${pending.original.hash}…`);
        if (
          !(await waitForRegistration(config.indexerUri, config.substrateNodeUri, pending.original))
        )
          throw new Error(
            `Original DUST registration ${pending.original.hash} is not canonically final. Keep its ID; inspect the chain before another attempt.`,
          );
        await journal.archive(pending.original);
        await this.host.walletPresentation.refresh(connected, 'refresh');
        this.host.status(
          `DUST registration ${pending.original.hash} finalized. Refresh as DUST accrues.`,
        );
        return;
      }
      this.host.stage('review');
      if (
        !window.confirm(
          `Enable DUST generation for this built-in wallet?\n\nNetwork: ${this.host.network}\nWallet: ${address}\n\nThis registers the wallet-held NIGHT output for DUST generation in a separate transaction. It does not move NIGHT out of the wallet. The exact transaction ID will be saved before submission.`,
        )
      )
        throw new Error('DUST registration declined.');
      this.host.stage('registration');
      this.host.status('Preparing the wallet NIGHT registration and its own DUST fee…');
      const original = await wallet.nightBridge.prepareDustRegistration();
      await journal.create(original);
      try {
        await wallet.nightBridge.submitDustRegistration(original);
      } catch (error) {
        throw new Error(
          `DUST registration ${original.hash} may have been submitted. Keep its saved ID and reconcile before retrying.`,
          { cause: error },
        );
      }
      this.host.stage('finality');
      this.host.status(`Waiting for original DUST registration ${original.hash}…`);
      if (!(await waitForRegistration(config.indexerUri, config.substrateNodeUri, original)))
        throw new Error(
          `DUST registration ${original.hash} is not canonically final yet. Keep its saved ID and inspect the chain.`,
        );
      await journal.archive(original);
      await this.host.walletPresentation.refresh(connected, 'refresh');
      this.host.status(`DUST registration ${original.hash} finalized. Refresh as DUST accrues.`);
    } finally {
      journal.close();
    }
  };
  connect = async (): Promise<void> => {
    checkRoutineReview();
    const lease = this.host.state.account && routineKeys.lease(this.host.state.account);
    this.host.status('Reading the service configuration…');
    const config = await fetchCheckedV1Config(
      SERVICE_URL,
      {
        networkId: this.host.network,
        bindingId: BINDING_ID,
        manifestSha256: MANIFEST_SHA256,
        artefactUrl: ARTEFACT_URL,
      },
      { fetch: tracedFetch },
    );
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
