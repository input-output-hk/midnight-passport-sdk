import { openAccountAt } from './account-methods.js';
import { ARM, ORIGIN, RP_ID, connect as connectAccount } from './connector.js';
import { DEPLOY_ESTIMATE_S, EVENT_STAGES, FLOWS, knownAccAddress } from './flows.js';

import { traceOperation } from './operation-trace.js';

import { routineKeys, checkRoutineReview, withRoutineLogin } from './routine-access.js';
import { authenticateOwnerAccount } from './owner-access.js';

import type { DemoActionHost } from './app-model.js';

export class AccountEntryActions {
  constructor(private readonly host: DemoActionHost) {}
  create = async () => {
    routineKeys.lock();
    this.host.status(
      ARM === 'jubjub'
        ? `Creating a JubJub account… confirm the passkey ceremonies, then wait for deployment (about ${DEPLOY_ESTIMATE_S / 60} minutes).`
        : `Creating… confirm the passkey and its reader key, then wait for deployment (about ${DEPLOY_ESTIMATE_S / 60} minutes) and two sealed-key publications.`,
    );
    const a = await withRoutineLogin(
      this.host.state.reviewedRoutineMinutes,
      async () =>
        await (
          await this.host.connector()
        ).createAccount({
          userName: `passport-${Date.now()}`,
          // The prototype has always retired the maintenance authority: irreversible, so the account
          // can never be upgraded. The account API makes that the caller's explicit choice.
          retireAuthority: true,
          onEvent: (e) => {
            this.host.onEvent(e);
            const next = e.phase === 'start' ? EVENT_STAGES.create[e.step] : undefined;
            const label = FLOWS.create.stages.find((x) => x.id === next)?.label;
            if (label)
              this.host.status(`Creating: ${label.charAt(0).toLowerCase()}${label.slice(1)}…`);
          },
        }),
    );
    await this.host.opened(a, 'created');
  };
  open = async () => {
    this.host.status(
      'Opening… choose your passkey once to open the account and enable routine access.',
    );
    await withRoutineLogin(this.host.state.reviewedRoutineMinutes, async () =>
      this.host.opened(
        await (await this.host.connector()).openAccount({ onEvent: this.host.onEvent }),
        'reopened',
      ),
    );
  };
  openAt = async () => {
    const requestedAddress = knownAccAddress(this.host.ui.knownAddress());
    traceOperation('account.openByAddress.requested', { accountAddress: requestedAddress });
    this.host.status('Opening the known ACC… choose an enrolled passkey once.');
    await withRoutineLogin(this.host.state.reviewedRoutineMinutes, async () => {
      const accountApi = await this.host.connector();
      if (!accountApi.openAccountAt)
        throw new Error('This Passport connector cannot open by address.');
      const restored = await accountApi.openAccountAt(requestedAddress, {
        onEvent: this.host.onEvent,
      });
      if (restored.address !== requestedAddress)
        throw new Error('The connector returned a different ACC address.');
      await this.host.opened(restored, 'opened by address');
      traceOperation('account.openByAddress.verified', { accountAddress: restored.address });
    });
  };
  unlockRoutine = async () => {
    if (!this.host.state.account) throw new Error('Open a Passport account first.');
    await routineKeys.unlock(
      this.host.state.account,
      this.host.state.reviewedRoutineMinutes,
      RP_ID,
      ORIGIN,
    );
    this.host.status(
      'Quick actions unlocked. A PRF-derived JubJub key is ready; transfers still need a separate scoped permission.',
    );
    traceOperation('routine.unlocked', {
      accountAddress: this.host.state.account.address,
      expiresAt: routineKeys.snapshot().expiresAt,
      publicKey: routineKeys.snapshot().publicKey,
    });
  };
  unlockOwner = async () => {
    const primary = this.host.state.primaryAccount;
    if (!primary) throw new Error('Open a Passport account first.');
    try {
      await routineKeys.unlock(
        primary,
        this.host.state.reviewedRoutineMinutes,
        RP_ID,
        ORIGIN,
        true,
      );
      const owner = routineKeys.ownerSession(primary);
      if (!owner) throw new Error('The authenticated owner session is unavailable.');
      this.host.stage('verify');
      const api = await connectAccount(this.host.network, owner);
      const authenticated = await authenticateOwnerAccount({
        primary,
        owner,
        storage: localStorage,
        options: { onEvent: this.host.onEvent },
        open: () => openAccountAt(api, primary.address, { onEvent: this.host.onEvent }),
        confirm: async (publicKey, readerPublicKey) =>
          window.confirm(
            `Enable this deterministic JubJub key as a FULL owner of your Passport account?\n\nAccount: ${primary.address}\nOwner key: ${publicKey}\nReader key: ${readerPublicKey}\n\nIt can transfer assets, change devices, rotate keys, and issue or revoke permissions, just like your passkey. Local timeout only clears this browser's key. The on-chain owner remains until removed. Code with page-memory access could copy this key and bypass this app’s fresh-approval policy. This first enrollment needs passkey signatures.`,
          ),
        trace: traceOperation,
      });
      owner.check();
      this.host.state.authenticatedAccount = authenticated;
      routineKeys.verifyOwner(primary);
      this.host.record('authenticatedOwner', {
        accountAddress: primary.address,
        publicKey: owner.publicKey,
        readerPublicKey: owner.readerPublicKey,
        expiresAt: routineKeys.snapshot().expiresAt,
      });
      this.host.status(
        'Account unlocked. Routine actions reuse keys; critical operations require fresh passkey approval before using the JubJub owner.',
      );
    } catch (error) {
      routineKeys.lock();
      throw error;
    }
  };
  refresh = async () => {
    if (!this.host.state.account) throw new Error('Open a Passport account before refreshing it.');
    const current = this.host.state.account;
    const state = await current.state();
    this.host.ui.showAccount({
      address: current.address,
      networkId: current.networkId,
      bindingId: current.bindingId,
      state,
    });
    this.host.record('refreshed', { accountAddress: current.address, state });
    traceOperation('account.state.refreshed', {
      accountAddress: current.address,
      authNonce: state.authNonce.toString(),
      deviceEpoch: state.deviceEpoch.toString(),
      entryCount: state.entryCount,
      specVersion: state.specVersion,
    });
    const balancesRead = this.host.state.balanceAssetColor
      ? await this.host.ui.attempt('balances', async () => {
          return (await this.host.refreshAccountBalances(current.address)) !== undefined;
        })
      : undefined;
    this.host.status(
      this.host.state.balanceAssetColor && !balancesRead
        ? `ACC ${current.address.slice(0, 12)}… state refreshed; balances unavailable (see event log).`
        : `ACC ${current.address.slice(0, 12)}… state refreshed from the chain.`,
    );
  };
  holdings = async () => {
    checkRoutineReview();
    if (!this.host.state.account?.readShieldedHoldings)
      throw new Error('Open a sealed Passport account before reading its shielded holdings.');
    const current = this.host.state.account;
    const read = current.readShieldedHoldings;
    if (!read) throw new Error('This Passport account cannot read shielded holdings.');
    this.host.status(
      'Opening the sealed ACC inbox and checking coin commitments against the chain…',
    );
    this.host.stage('verify');
    const verified = await read({ onEvent: this.host.onEvent });
    checkRoutineReview();
    const coins = verified.map((holding) => ({
      inboxIndex: holding.inboxIndex,
      color: Array.from(holding.coin.color, (byte) => byte.toString(16).padStart(2, '0')).join(''),
      value: holding.coin.value.toString(),
    }));
    this.host.ui.showShieldedHoldings(current.address, coins);
    this.host.record('shieldedHoldings', { accountAddress: current.address, coins });
    traceOperation('account.shieldedHoldings.verified', {
      accountAddress: current.address,
      count: coins.length,
      coins,
    });
    this.host.status(
      `Verified ${coins.length} shielded ${coins.length === 1 ? 'coin' : 'coins'} held by ACC ${current.address.slice(0, 12)}….`,
    );
  };
}
