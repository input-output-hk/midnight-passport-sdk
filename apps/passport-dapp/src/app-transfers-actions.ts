import { RP_ID } from './connector.js';

import { withdrawalRequest } from './withdrawal.js';
import { fixedUnshieldedGrantLimits } from './grant-input.js';

import { tracedFetch, traceOperation } from './operation-trace.js';

import {
  fundingRequestFailure,
  fundingExchange,
  fundingUnsettled,
  waitForFundingOriginal,
  fundingStorageKeys,
  storedFundingOriginal,
  checkedFundingConfirmation,
  fundingProgressMessage,
} from './funding.js';

import type { DemoActionHost } from './app-model.js';

export class TransferActions {
  constructor(private readonly host: DemoActionHost) {}
  fund = async () => {
    if (!this.host.state.account) throw new Error('Open a Passport account before funding it.');
    const asset = this.host.ui.selectedFundingAsset();
    if (!asset)
      throw new Error('Deposit availability changed. Refresh availability and try again.');
    const target = this.host.state.account.address;
    const { current: key, legacy: legacyKey } = fundingStorageKeys(
      this.host.network,
      target,
      asset.color,
    );
    let requestId = storedFundingOriginal(localStorage, this.host.network, target, asset.color);
    if (requestId && !localStorage.getItem(key)) localStorage.setItem(key, requestId);
    const continuingOriginal = Boolean(requestId);
    if (!requestId) {
      requestId = crypto.randomUUID();
      localStorage.setItem(key, requestId);
    }
    this.host.stage('deposit');
    traceOperation(continuingOriginal ? 'funding.observe' : 'funding.intent', {
      requestId,
      accountAddress: target,
      networkId: this.host.network,
      color: asset.color,
      ...(!continuingOriginal && { amount: asset.amount }),
    });
    this.host.status(
      continuingOriginal
        ? `Checking original funding for account ${target.slice(0, 12)}…`
        : `Funding account ${target.slice(0, 12)}… with ${asset.amount} ${asset.color === '00'.repeat(32) ? 'NIGHT' : 'test units'}…`,
    );
    const originalUrl = new URL(this.host.fundingUrl);
    originalUrl.pathname += `/${requestId}`;
    originalUrl.searchParams.set('accountAddress', target);
    const observeOriginal = async () => {
      const observed = await fundingExchange(() => tracedFetch(originalUrl.toString()));
      if (!observed.response.ok)
        throw fundingUnsettled('Original funding status is unavailable. Keep this request ID.');
      return observed.result;
    };
    let expectedAmount = asset.amount;
    const awaitOriginal = async (): Promise<Record<string, unknown>> => {
      const status = await waitForFundingOriginal(
        observeOriginal,
        {
          requestId,
          accountAddress: target,
          color: asset.color,
          ...(!continuingOriginal && { amount: asset.amount }),
        },
        (progress) => {
          this.host.status(fundingProgressMessage(progress));
        },
      );
      if (status.state === 'released')
        throw fundingRequestFailure({
          status: 409,
          result: { requestId, code: 'FundingRequestReleased', submission: 'reconciled-no-credit' },
          requestId,
          storage: localStorage,
          keys: [key, legacyKey],
          onNotStarted: (details) => traceOperation('funding.notStarted', details),
          onReconciled: (details) => traceOperation('funding.reconciled', details),
        });
      if (!status.result) throw fundingUnsettled('Funding original has no confirmed result.');
      if (continuingOriginal) expectedAmount = status.amount;
      return {
        ...status.result,
        accountAddress: target,
        color: asset.color,
        amount: status.amount,
      };
    };
    let result;
    if (continuingOriginal) {
      result = await awaitOriginal();
    } else {
      const exchange = await fundingExchange(() =>
        tracedFetch(this.host.fundingUrl.toString(), {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ accountAddress: target, requestId, color: asset.color }),
        }),
      );
      if (exchange.response.status === 202) {
        if (exchange.result.requestId !== requestId || exchange.result.state !== 'pending')
          throw fundingUnsettled('Funding service returned an invalid pending original.');
        result = await awaitOriginal();
      } else if (!exchange.response.ok) {
        throw fundingRequestFailure({
          status: exchange.response.status,
          result: exchange.result,
          requestId,
          storage: localStorage,
          keys: [key, legacyKey],
          onNotStarted: (details) => traceOperation('funding.notStarted', details),
          onReconciled: (details) => traceOperation('funding.reconciled', details),
        });
      } else {
        result = exchange.result;
      }
    }
    const confirmed = checkedFundingConfirmation(result, {
      requestId,
      accountAddress: target,
      color: asset.color,
      amount: expectedAmount,
    });
    this.host.record('funding', {
      requestId,
      accountAddress: target,
      color: asset.color,
      amount: confirmed.amount,
      txId: confirmed.txId,
      ...(confirmed.preparationTxId && { preparationTxId: confirmed.preparationTxId }),
      creditedBalance: confirmed.creditedBalance,
    });
    this.host.ui.showFunding(target, asset.color, confirmed.creditedBalance);
    void this.host.refreshAccountBalances(target).catch(() => {
      traceOperation('account.balances.unavailable', { accountAddress: target });
    });
    traceOperation('funding.confirmed', {
      requestId,
      accountAddress: target,
      color: asset.color,
      amount: confirmed.amount,
      txId: confirmed.txId,
      ...(confirmed.preparationTxId && { preparationTxId: confirmed.preparationTxId }),
      creditedBalance: confirmed.creditedBalance,
    });
    localStorage.removeItem(key);
    if (asset.color !== '00'.repeat(32)) localStorage.removeItem(legacyKey);
    this.host.status(
      `Passport account balance: ${confirmed.creditedBalance} ${asset.color === '00'.repeat(32) ? 'NIGHT smallest units' : 'test token units'}. Transaction ${confirmed.txId.slice(0, 12)}…`,
    );
  };
  startSession = async () => {
    const current = this.host.state.account;
    if (!current?.credentialId) throw new Error('Open your passkey-backed ACC first.');
    const input = this.host.ui.withdrawalInput();
    const minutes = Number((document.getElementById('session-minutes') as HTMLSelectElement).value);
    // Validate asset, recipient and limits before any credential access.
    const scope = fixedUnshieldedGrantLimits(this.host.network, {
      ...input,
      perCallCap: (document.getElementById('session-per-call') as HTMLInputElement).value,
      cap: (document.getElementById('session-cap') as HTMLInputElement).value,
      maxDemoCall: this.host.ui.withdrawalCallLimit(),
    });
    if (!Number.isInteger(minutes) || minutes < 10 || minutes > 30)
      throw new Error('Choose 10–30 minutes.');
    if (
      !window.confirm(
        `Authorize a scoped JubJub session?\n\nACC: ${current.address}\nNetwork: ${this.host.network}\nAsset: ${scope.color}\nRecipient: ${input.recipient}\nPer transfer: ${scope.perCallCap}\nTotal cap: ${scope.cap} smallest units\nAbsolute lifetime: ${minutes} minutes from authorization start (including proving).\n\nGrant issuer: ${this.host.ownerAuthorization()}. Unlock the separate scoped signer if needed, then approve issuing this grant. No owner or read authority is delegated. A copied key may spend until chain expiry or confirmed revocation.`,
      )
    ) {
      this.host.status('Session authorization declined before passkey access.');
      traceOperation('session.authorize.cancelled', { accountAddress: current.address });
      return;
    }
    await this.host.session.start(current, scope, minutes, RP_ID, { onEvent: this.host.onEvent });
    this.host.status(
      'JubJub session active. Matching withdrawals need transfer consent, with no new passkey prompt.',
    );
  };
  endSession = async () => {
    const complete = this.host.lockAllLocalKeys();
    if (!complete)
      this.host.ui.note(
        'Local key cleanup ran, but its checkpoint or presentation failed. Preserve Audit before leaving.',
      );
    this.host.status(
      'Local session locked. Its on-chain grant is not revoked; already-submitted effects still require reconciliation.',
    );
  };
  revokeSession = async () => {
    if (!this.host.state.account) throw new Error('Open the issuing ACC first.');
    const snapshot = this.host.session.snapshot();
    if (
      !window.confirm(
        `Revoke session grant ${snapshot.grantId ?? '(unknown; reconcile the original issue)'} for ACC ${this.host.state.account.address}?\n\nAuthorization: ${this.host.ownerAuthorization()}. This does not undo transfers.`,
      )
    ) {
      this.host.status('Session grant revocation cancelled before signing.');
      traceOperation('session.revoke.cancelled', {
        accountAddress: this.host.state.account.address,
        grantId: snapshot.grantId,
      });
      return;
    }
    const result = await this.host.session.revoke(this.host.state.account, {
      onEvent: this.host.onEvent,
    });
    this.host.record('sessionRevoked', { grantId: snapshot.grantId, txHash: result.txHash });
    this.host.status('Session grant revoked on chain. Authorize a new session to renew.');
  };
  withdraw = async () => {
    if (!this.host.state.account?.withdrawUnshielded || !this.host.state.balanceAssetColor)
      throw new Error('Open a supported Passport account and enable localnet balances first.');
    const current = this.host.state.account;
    const withdrawUnshielded = current.withdrawUnshielded;
    if (!withdrawUnshielded) throw new Error('This Passport account cannot withdraw assets.');
    const input = this.host.ui.withdrawalInput();
    this.host.stage('balance');
    this.host.status('Reading the live ACC balance before withdrawal…');
    const balances = await this.host.refreshAccountBalances(current.address);
    if (!balances) throw new Error('Fresh ACC balances are unavailable.');
    const freshBalance =
      input.color === '00'.repeat(32)
        ? balances.night
        : input.color === this.host.state.balanceAssetColor
          ? balances.fundedAsset
          : undefined;
    if (freshBalance === undefined) throw new Error('The selected asset has no verified balance.');
    const transfer = withdrawalRequest(
      this.host.network,
      input.color,
      input.amount,
      input.recipient,
      freshBalance,
    );
    this.host.stage('review');
    traceOperation('withdrawal.intent', {
      accountAddress: current.address,
      networkId: this.host.network,
      color: transfer.color,
      amount: transfer.amount,
      recipient: input.recipient.trim(),
      recipientHex: transfer.recipient,
      freshBalance,
    });
    if (this.host.session.snapshot().status === 'blocked')
      throw new Error(
        'Reconcile the original session transaction and revoke its grant before another withdrawal. No owner fallback is allowed.',
      );
    const useSession = this.host.sessionUse() && this.host.session.matches(current, transfer);
    const route = useSession
      ? 'scoped JubJub session (no passkey prompt)'
      : this.host.ownerAuthorization();
    const review = {
      ...transfer,
      recipientAddress: input.recipient.trim(),
      balance: freshBalance,
      outsideSession: this.host.sessionUse() && !useSession,
    };
    if (useSession) {
      if (!this.host.ownerReview.reviewScopedWithdrawal(current, review)) {
        this.host.status('Withdrawal cancelled before signing.');
        traceOperation('withdrawal.cancelled', { accountAddress: current.address });
        return;
      }
    } else this.host.ownerReview.stageOwnerWithdrawalReview(current, review);
    this.host.stage('submit');
    this.host.status(
      useSession
        ? 'Signing the scoped withdrawal with the active JubJub session…'
        : `Signing with ${route}; proving and submission may take time…`,
    );
    // A failed/unknown session spend never falls back to an owner send.
    const result = useSession
      ? { ...(await this.host.session.spend(current, transfer)), nextUseCounter: undefined }
      : await withdrawUnshielded(transfer, { onEvent: this.host.onEvent });
    this.host.record('withdrawal', {
      accountAddress: current.address,
      networkId: this.host.network,
      ...transfer,
      recipientAddress: input.recipient.trim(),
      balanceBefore: freshBalance,
      txHash: result.txHash,
      nextUseCounter: result.nextUseCounter,
    });
    traceOperation('withdrawal.confirmed', {
      accountAddress: current.address,
      networkId: this.host.network,
      ...transfer,
      recipientAddress: input.recipient.trim(),
      txHash: result.txHash,
      authorization: route,
      ...(result.nextUseCounter !== undefined && {
        nextUseCounter: result.nextUseCounter.toString(),
      }),
    });
    const after = await this.host.ui.attempt('read', async () => {
      const state = await current.state();
      this.host.ui.showAccount({
        address: current.address,
        networkId: current.networkId,
        bindingId: current.bindingId,
        state,
        lastTx: result,
      });
      return this.host.refreshAccountBalances(current.address);
    });
    this.host.status(
      after
        ? `Withdrawal confirmed: ${result.txHash.slice(0, 12)}… ACC balance is ${input.color === '00'.repeat(32) ? after.night : after.fundedAsset} smallest units.`
        : `Withdrawal confirmed: ${result.txHash.slice(0, 12)}… Refresh ACC state to check its balance.`,
    );
  };
}
