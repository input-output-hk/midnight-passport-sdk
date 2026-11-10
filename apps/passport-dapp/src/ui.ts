import { type DemoFundingAsset } from './funding.js';
import { type WalletView } from './wallet/view.js';
import type { PassportEvent, PassportGrantRoster } from '@input-output-hk/mn-passport-protocol';

import { type ActionId, FLOWS, plainError } from './flows.js';

import { operationForRun } from './activity-observations.js';

import type { OperationTraceEntry } from './operation-trace.js';
import { ACTIONS, byId } from './ui-dom.js';
import type { UiModel, UiDom, EvidenceHeader, AccountView, UiConsent } from './ui-state.js';

import { createUiModel } from './ui-state.js';
import { createUiDom } from './ui-dom.js';
import { ActionControls } from './ui-controls.js';
import { ActivityView } from './ui-activity.js';
import { AccountCards } from './ui-cards.js';
export type { EvidenceHeader, AccountView } from './ui-state.js';
export type { WalletView } from './wallet/view.js';
export { shorten } from './ui-dom.js';
class DemoUi {
  private readonly model: UiModel;
  private readonly dom: UiDom;
  private readonly controls: ActionControls;
  private readonly activityView: ActivityView;
  private readonly cards: AccountCards;
  readonly activity: UiModel['activity'];
  private ticker: ReturnType<typeof setInterval> | undefined;
  constructor(
    header: EvidenceHeader,
    private readonly consent: UiConsent | undefined,
  ) {
    this.model = createUiModel(header);
    this.dom = createUiDom();
    this.activity = this.model.activity;
    this.controls = new ActionControls(this.model, this.dom);
    this.activityView = new ActivityView(this.model, this.dom);
    this.cards = new AccountCards(this.model, this.announce);
    this.activityView.installAuditListeners();
    for (const action of ACTIONS) byId(`${action}-desc`).textContent = FLOWS[action].summary;
    byId('create-desc').textContent =
      'Set up an account secured by a new passkey. The demo service pays the network fees.';
    byId('open-desc').textContent = 'Use the passkey you previously registered for this account.';
    byId('openAt-desc').textContent =
      'You still need an enrolled passkey. An address alone cannot grant access or recover a lost passkey.';
    this.model.log.subscribe(() => {
      this.controls.renderButtons();
      this.activityView.renderProgress();
      this.activityView.renderLog();
      this.activityView.renderEvidence();
      if (this.model.log.current && !this.ticker) this.ticker = setInterval(this.tick, 250);
      if (!this.model.log.current && this.ticker) {
        clearInterval(this.ticker);
        this.ticker = undefined;
      }
    });
    this.dom.copyButton.addEventListener('click', () => {
      this.activityView.renderEvidence();
      void navigator.clipboard
        .writeText(this.activityView.fullLog())
        .then(() => {
          this.status(
            'Full operation log copied with public request and response fields, and no secrets.',
          );
        })
        .catch(() => this.status('Copy failed: the browser refused clipboard access.'));
    });
    this.dom.knownAddress.addEventListener('input', this.controls.renderButtons);
    this.dom.fundingSelect.addEventListener('change', this.controls.renderButtons);
    this.dom.grantGrantee.addEventListener('input', this.controls.renderButtons);
    this.dom.revokeGrantId.addEventListener('input', this.controls.renderButtons);
    this.dom.exportGrantId.addEventListener('input', this.controls.renderButtons);
    this.dom.grantOpeningInput.addEventListener('input', this.controls.renderButtons);
    this.dom.handoffInput.addEventListener('input', this.controls.renderButtons);
    this.dom.removalInput.addEventListener('input', this.controls.renderButtons);
    this.controls.renderButtons();
    this.activityView.renderProgress();
    this.cards.renderAccount();
    this.cards.renderHoldings();
    this.cards.renderRoster();
    this.cards.renderGrantRoster();
    this.cards.renderWallet();
    this.activityView.renderEvidence();
  }
  status = (text: string) => {
    this.dom.statusEl.textContent = text;
  };
  announce = (text: string) => {
    // Cleared first so that the same message twice is announced twice.
    this.dom.announceEl.textContent = '';
    requestAnimationFrame(() => {
      this.dom.announceEl.textContent = text;
    });
  };
  private tick = () => this.activityView.renderProgress();
  refreshPrompts = () => this.controls.renderPrompts();
  knownAddress = () => this.dom.knownAddress.value;
  handoffJson = () => this.dom.handoffInput.value;
  grantInput = () => ({
    grantee: this.dom.grantGrantee.value.trim(),
    color: this.dom.grantAsset.value,
    maxDemoCall: this.model.assetsByColor.get(this.dom.grantAsset.value)?.amount ?? '0',
    recipient: this.dom.grantRecipient.value.trim(),
    perCallCap: this.dom.grantPerCall.value.trim(),
    cap: this.dom.grantCap.value.trim(),
  });
  revokeGrantId = () => this.dom.revokeGrantId.value.trim();
  exportGrantId = () => this.dom.exportGrantId.value.trim();
  grantSpendInput = () => ({
    handoff: this.dom.grantOpeningInput.value,
    amount: this.dom.grantSpendAmount.value.trim(),
    spentPrev: this.dom.grantSpentPrev.value.trim(),
  });
  showGrantSpentTotal = (value: bigint) => {
    this.dom.grantSpentPrev.value = value.toString();
  };
  showGrantHandoff = (handoff: unknown) => {
    const output = byId<HTMLTextAreaElement>('grant-opening-output');
    output.value = JSON.stringify(handoff, null, 2);
    output.hidden = false;
  };
  clearGrantHandoff = () => {
    const output = byId<HTMLTextAreaElement>('grant-opening-output');
    output.value = '';
    output.hidden = true;
  };
  showGranteePublicKey = (publicKey: string) => {
    const output = byId<HTMLInputElement>('grantee-output');
    output.value = publicKey;
    output.hidden = false;
  };
  removalCommitment = () => this.dom.removalInput.value.trim();
  showHandoff = (handoff: { fingerprint: string }) => {
    this.dom.handoffOutput.value = JSON.stringify(handoff, null, 2);
    this.dom.handoffOutput.hidden = false;
    byId('handoff-empty').hidden = true;
    const value = byId('handoff-fingerprint');
    value.textContent = `Compare this SHA-256 fingerprint on the owner browser: ${handoff.fingerprint}`;
    value.hidden = false;
  };
  showRoster = (
    address: string,
    roster: { deviceEpoch: bigint; authNonce: bigint; commitments: readonly string[] },
  ) => {
    if (this.model.account?.address !== address) return;
    this.model.deviceRoster = { address, ...roster };
    this.cards.renderRoster();
  };
  showGrantRoster = (address: string, roster: PassportGrantRoster) => {
    if (this.model.account?.address !== address) return;
    this.model.grantRoster = { address, roster };
    this.cards.renderGrantRoster();
  };
  stage = (id: string) => this.model.log.stage(id);
  note = (text: string) => this.model.log.note(text);
  event = (e: PassportEvent) => this.model.log.event(e);
  record = (name: string, data: Record<string, unknown> = {}) =>
    this.model.log.attach({ [name]: data });
  trace = (entry: OperationTraceEntry) => this.model.log.trace(entry);
  attempt = async <T>(id: string, fn: () => Promise<T>): Promise<T | undefined> => {
    this.model.log.stage(id);
    try {
      return await fn();
    } catch (e) {
      this.model.log.failStep(plainError(e, this.model.header.serviceUrl));
      return undefined;
    }
  };
  on = (action: ActionId, fn: () => Promise<void>) => {
    const targets =
      action === 'refresh'
        ? [this.dom.buttons[action], byId<HTMLButtonElement>('refresh-funding')]
        : [this.dom.buttons[action]];
    for (const button of targets)
      button.addEventListener('click', async () => {
        if (this.model.log.current) {
          if (action === 'endSession') {
            // An emergency local lock must work during a long issue/proof/settlement.
            // Keep the original operation log/IDs and end its remaining credential consent.
            try {
              await fn();
            } finally {
              this.consent?.after();
            }
          }
          return;
        }
        this.model.log.start(action);
        document.dispatchEvent(new Event('passport:operation-started'));
        try {
          const execute = async () => {
            if (this.consent && !(await this.consent.before(action))) {
              this.status('Operation declined before passkey access or submission.');
              this.model.log.trace({
                at: new Date().toISOString(),
                kind: 'action.declined',
                details: { action },
              });
              this.model.log.finish();
              return;
            }
            await fn();
            this.model.log.finish();
          };
          if (this.consent?.run) await this.consent.run(action, execute);
          else await execute();
        } catch (e) {
          const err = plainError(e, this.model.header.serviceUrl);
          this.model.log.fail(err);
          const outcome =
            this.model.log.last &&
            operationForRun(this.model.log, this.model.log.last, Date.now()).phase;
          const explanation =
            outcome === 'unknown'
              ? 'The transaction outcome is unknown. Keep the original IDs and reconcile in Audit.'
              : outcome === 'cancelled'
                ? 'The attempt was cancelled. Earlier effects may remain; inspect Audit.'
                : err.hint;
          this.status(`${FLOWS[action].title} attempt failed. ${explanation} (${err.code})`);
        } finally {
          this.consent?.after();
          document.dispatchEvent(new Event('passport:operation-finished'));
          // The button was disabled while the action ran, which drops focus: give it back.
          if (document.activeElement === document.body && !button.disabled) button.focus();
        }
      });
  };
  setReady = (value: boolean) => {
    this.model.ready = value;
    this.controls.renderButtons();
  };
  showAccount = (view: AccountView) => {
    if (this.model.account?.address !== view.address) {
      const output = byId<HTMLTextAreaElement>('grant-opening-output');
      output.value = '';
      output.hidden = true;
    }
    // The last transaction carries over only while the same account stays open.
    const keep =
      this.model.account?.address === view.address ? this.model.account.lastTx : undefined;
    const lastTx = view.lastTx ?? keep;
    this.model.account = { ...view, ...(lastTx && { lastTx }) };
    // A later account action may spend a coin; require a fresh chain check.
    this.model.shieldedHoldings = undefined;
    this.model.deviceRoster = undefined;
    this.model.grantRoster = undefined;
    if (this.model.accountBalances?.address !== view.address)
      this.model.accountBalances = this.model.fundingAsset
        ? { address: view.address, color: this.model.fundingAsset.color }
        : undefined;
    this.cards.renderAccount();
    this.cards.renderHoldings();
    this.cards.renderRoster();
    this.cards.renderGrantRoster();
    this.controls.renderButtons();
    this.activityView.renderEvidence();
  };
  showShieldedHoldings = (
    address: string,
    coins: readonly { inboxIndex: number; color: string; value: string }[],
  ) => {
    if (this.model.account?.address !== address) return;
    this.model.shieldedHoldings = { address, coins };
    this.cards.renderHoldings();
    this.activityView.renderEvidence();
  };
  enableFunding = (assets: readonly DemoFundingAsset[]) => this.controls.enableFunding(assets);
  showFundingUnavailable = () => {
    this.controls.enableFunding(
      [...this.model.assetsByColor.values()].map((asset) => ({
        ...asset,
        availability: 'unavailable' as const,
      })),
    );
  };
  selectedFundingAsset = () => {
    const selected = this.model.assetsByColor.get(this.dom.fundingSelect.value);
    return selected?.availability === 'available' ? selected : undefined;
  };
  withdrawalCallLimit = () =>
    this.model.assetsByColor.get(this.dom.withdrawalSelect.value)?.amount ?? '0';
  withdrawalInput = () => {
    return {
      color: this.dom.withdrawalSelect.value,
      amount: this.dom.withdrawalAmount.value,
      recipient: this.dom.withdrawalRecipient.value,
    };
  };
  showFunding = (address: string, color: string, balance: string) => {
    this.model.accountBalances = {
      address,
      color: this.model.accountBalances?.color ?? color,
      ...(color === '00'.repeat(32)
        ? {
            night: balance,
            ...(this.model.accountBalances?.fundedAsset && {
              fundedAsset: this.model.accountBalances.fundedAsset,
            }),
          }
        : {
            ...(this.model.accountBalances?.night && { night: this.model.accountBalances.night }),
            fundedAsset: balance,
          }),
    };
    this.cards.renderAccount();
    this.activityView.renderEvidence();
  };
  showAccountBalances = (address: string, color: string, night: string, fundedAsset: string) => {
    if (this.model.account?.address !== address) return;
    this.model.accountBalances = { address, color, night, fundedAsset };
    this.cards.renderAccount();
    this.activityView.renderEvidence();
  };
  showAccountBalanceError = (address: string) => {
    if (this.model.account?.address !== address || !this.model.accountBalances) return;
    this.model.accountBalances = { ...this.model.accountBalances, error: 'Unavailable' };
    this.cards.renderAccount();
  };
  showExternalWalletConnection = (connected: boolean) => {
    this.model.externalWalletConnected = connected;
    this.activityView.renderActivity();
  };
  showWallet = (view: WalletView) => {
    this.model.wallet = { ...this.model.wallet, ...view };
    this.cards.renderWallet();
    this.controls.renderButtons();
    this.activityView.renderEvidence();
  };
  clearWallet = () => {
    this.model.wallet = {};
    this.cards.renderWallet();
    this.controls.renderButtons();
    this.activityView.renderEvidence();
  };
}
export function createUi(
  header: EvidenceHeader,
  _arm: 'p256' | 'jubjub' = 'p256',
  consent?: UiConsent,
) {
  return new DemoUi(header, consent);
}
