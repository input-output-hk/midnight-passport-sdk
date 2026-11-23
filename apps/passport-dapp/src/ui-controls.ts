import {
  canFund,
  fundingDescription,
  preferredFundingAsset,
  savedFundingAssets,
  storedFundingOriginal,
  type DemoFundingAsset,
} from './funding.js';

import { promptLabel, promptsFor } from './flows.js';

import { routineKeys, OWNER_ACTIONS } from './routine-access.js';
import { CRITICAL_ACTIONS } from './credential-policy.js';

import { ACTIONS, byId, el, shorten } from './ui-dom.js';
import type { UiModel, UiDom } from './ui-state.js';

export class ActionControls {
  constructor(
    private readonly model: UiModel,
    private readonly dom: UiDom,
  ) {}
  renderPrompts = () => {
    for (const action of ACTIONS) {
      byId(`${action}-prompts`).textContent =
        this.model.account &&
        routineKeys.snapshot().status === 'active' &&
        routineKeys.snapshot().account === this.model.account.address &&
        (['holdings', 'wallet'].includes(action) ||
          (routineKeys.snapshot().ownerVerified && OWNER_ACTIONS.includes(action)))
          ? CRITICAL_ACTIONS.has(action)
            ? action === 'withdraw'
              ? 'Approved scoped transfer: no passkey · owner transfer: fresh passkey'
              : action === 'sendNamedNight'
                ? 'New payment: fresh passkey · original-leg recovery: no new owner signature'
                : 'Fresh passkey approval for this critical action'
            : 'Uses unlocked keys · no new passkey request'
          : ['create', 'open', 'openAt'].includes(action)
            ? 'Passkey approval required'
            : promptsFor(action, !!this.model.account) === 0
              ? promptLabel(0)
              : 'Passkey prompts vary by purpose, provider and transaction count.';
    }
  };
  renderButtons = () => {
    const busy = this.model.log.current !== undefined;
    this.renderEntryButtons(busy);
    this.renderGrantButtons(busy);
    this.renderDeviceButtons(busy);
    this.renderValueButtons(busy); // Entry actions keep their stable primary/secondary hierarchy.
    this.dom.buttons.rotate.classList.toggle('btn-primary', !!this.model.account);
    this.dom.buttons.rotate.classList.toggle('btn-secondary', !this.model.account);
    byId('rotate-needs').hidden = !!this.model.account;
    this.renderPrompts();
    document.body.toggleAttribute('data-busy', busy);
  };
  renderEntryButtons = (busy: boolean) => {
    this.dom.buttons.unlockRoutine.disabled = busy || !this.model.account;
    this.dom.buttons.unlockOwner.disabled = busy || !this.model.account;
    this.dom.buttons.startSession.disabled =
      busy || !this.model.account || this.model.assetsByColor.size === 0;
    this.dom.buttons.endSession.disabled = false;
    this.dom.buttons.revokeSession.disabled = busy || !this.model.account;
    this.dom.buttons.create.disabled = busy || !this.model.ready;
    this.dom.buttons.open.disabled = busy || !this.model.ready;
    this.dom.buttons.openAt.disabled =
      busy || !this.model.ready || !/^[0-9a-f]{64}$/.test(this.dom.knownAddress.value.trim());
    this.dom.knownAddress.disabled = busy;
    this.dom.buttons.refresh.disabled = busy || !this.model.account;
    byId<HTMLButtonElement>('refresh-funding').disabled = busy || !this.model.account;
    this.dom.buttons.holdings.disabled = busy || !this.model.account;
    this.dom.buttons.roster.disabled = busy || !this.model.account;
    this.dom.buttons.grantRoster.disabled = busy || !this.model.account;
    this.dom.buttons.prepareGrantee.disabled =
      busy || !this.model.ready || !/^[0-9a-f]{64}$/.test(this.dom.knownAddress.value.trim());
  };
  renderGrantButtons = (busy: boolean) => {
    this.dom.buttons.issueGrant.disabled =
      busy ||
      !this.model.account ||
      this.model.assetsByColor.size === 0 ||
      !/^[0-9a-f]{64}$/.test(this.dom.grantGrantee.value.trim());
    this.dom.buttons.issueGrant
      .closest('li')
      ?.toggleAttribute('hidden', this.model.assetsByColor.size === 0);
    this.dom.buttons.revokeGrant.disabled =
      busy || !this.model.account || !/^[0-9a-f]{64}$/.test(this.dom.revokeGrantId.value.trim());
    this.dom.grantGrantee.disabled = busy || !this.model.account;
    this.dom.grantAsset.disabled = busy || !this.model.account;
    this.dom.grantRecipient.disabled = busy || !this.model.account;
    this.dom.grantPerCall.disabled = busy || !this.model.account;
    this.dom.grantCap.disabled = busy || !this.model.account;
    this.dom.revokeGrantId.disabled = busy || !this.model.account;
    this.dom.buttons.exportGrant.disabled =
      busy || !this.model.account || !/^[0-9a-f]{64}$/.test(this.dom.exportGrantId.value.trim());
    this.dom.exportGrantId.disabled = busy || !this.model.account;
    this.dom.buttons.spendGrant.disabled =
      busy || !this.model.ready || !this.dom.grantOpeningInput.value.trim();
    this.dom.grantOpeningInput.disabled = busy;
    this.dom.grantSpendAmount.disabled = busy;
    this.dom.grantSpentPrev.disabled = busy;
    this.dom.buttons.recoverGrants.disabled = busy || !this.model.account;
  };
  renderDeviceButtons = (busy: boolean) => {
    this.dom.buttons.prepareJoiner.disabled =
      busy || !this.model.ready || !/^[0-9a-f]{64}$/.test(this.dom.knownAddress.value.trim());
    this.dom.buttons.enrollDevice.disabled =
      busy || !this.model.account || !this.dom.handoffInput.value.trim();
    this.dom.buttons.removeDevice.disabled =
      busy || !this.model.account || !/^[0-9a-f]{64}$/.test(this.dom.removalInput.value.trim());
    this.dom.removalInput.disabled = busy || !this.model.account;
    this.dom.handoffInput.disabled = busy;
    this.dom.buttons.rotate.disabled = busy || !this.model.account;
    this.dom.buttons.wallet.disabled = busy;
    this.dom.buttons.walletRefresh.disabled = busy || !this.model.wallet.unshieldedAddress;
    this.dom.buttons.walletDust.disabled = busy || !this.model.wallet.unshieldedAddress;
  };
  renderValueButtons = (busy: boolean) => {
    const selected = this.model.assetsByColor.get(this.dom.fundingSelect.value);
    const continuing = !!(
      this.model.account &&
      selected &&
      storedFundingOriginal(
        localStorage,
        this.model.header.network,
        this.model.account.address,
        selected.color,
      )
    );
    this.dom.buttons.fund.disabled = !continuing && !canFund(busy, !!this.model.account, selected);
    if (busy || !this.model.account || !selected) this.dom.buttons.fund.disabled = true;
    this.dom.buttons.fund.textContent = continuing ? 'Continue funding' : 'Fund Passport account';
    byId('fund-desc').textContent = continuing
      ? 'Check the saved funding request. This does not send another deposit.'
      : fundingDescription(selected);
    this.dom.fundingSelect.disabled = busy || !this.model.account;
    this.dom.buttons.fund
      .closest('li')
      ?.toggleAttribute('hidden', this.model.assetsByColor.size === 0);
    this.dom.buttons.withdraw.disabled =
      busy || !this.model.account || this.model.assetsByColor.size === 0;
    this.dom.withdrawalSelect.disabled = busy || !this.model.account;
    this.dom.withdrawalAmount.disabled = busy || !this.model.account;
    this.dom.withdrawalRecipient.disabled = busy || !this.model.account;
    byId<HTMLInputElement>('named-night-recipient').disabled = busy || !this.model.account;
    byId<HTMLInputElement>('named-night-amount').disabled = busy || !this.model.account;
    this.dom.buttons.sendNamedNight.disabled =
      busy ||
      !this.model.account ||
      byId('account-named-night').dataset.available !== 'true' ||
      byId('account-named-night').dataset.blocked === 'true';
    this.dom.buttons.withdraw
      .closest('li')
      ?.toggleAttribute('hidden', this.model.assetsByColor.size === 0);
    this.dom.copyButton.disabled =
      busy || (this.model.log.runs.length === 0 && this.model.log.traceEntries.length === 0);
  };
  enableFunding = (assets: readonly DemoFundingAsset[]): void => {
    const previousFunding = this.dom.fundingSelect.value;
    const previousWithdrawal = this.dom.withdrawalSelect.value;
    const previousGrant = this.dom.grantAsset.value;
    const retained = this.model.account
      ? savedFundingAssets(localStorage, this.model.header.network, this.model.account.address)
      : [];
    const visibleAssets = [
      ...new Map([...retained, ...assets].map((asset) => [asset.color, asset])).values(),
    ];
    this.model.assetsByColor = new Map(visibleAssets.map((asset) => [asset.color, asset]));
    this.dom.fundingSelect.replaceChildren(
      ...visibleAssets.map((asset) => {
        const option = el(
          'option',
          undefined,
          asset.amount === '0'
            ? asset.color === '00'.repeat(32)
              ? 'NIGHT original funding request'
              : `Test token ${shorten(asset.color, 6, 4)} original funding request`
            : asset.color === '00'.repeat(32)
              ? `NIGHT (${asset.amount} smallest units)`
              : `Test token ${shorten(asset.color, 6, 4)} (${asset.amount} units)`,
        );
        option.value = asset.color;
        option.disabled = asset.availability !== 'available';
        if (option.disabled)
          option.textContent +=
            asset.availability === 'insufficient'
              ? ' — insufficient funding balance'
              : ' — funding unavailable';
        return option;
      }),
    );
    this.dom.withdrawalSelect.replaceChildren(
      ...assets.map((asset) => {
        const option = el(
          'option',
          undefined,
          asset.color === '00'.repeat(32)
            ? 'NIGHT (smallest units)'
            : `Test token ${shorten(asset.color, 6, 4)} (smallest units)`,
        );
        option.value = asset.color;
        return option;
      }),
    );
    this.dom.grantAsset.replaceChildren(
      ...assets.map((asset) => {
        const option = el(
          'option',
          undefined,
          asset.color === '00'.repeat(32)
            ? 'NIGHT (smallest units)'
            : `Test token ${shorten(asset.color, 6, 4)} (smallest units)`,
        );
        option.value = asset.color;
        return option;
      }),
    );
    this.model.fundingAsset = preferredFundingAsset(visibleAssets, previousFunding);
    if (!this.model.fundingAsset && retained.length)
      this.model.fundingAsset = visibleAssets.find((asset) => asset.color === retained[0]?.color);
    this.dom.fundingSelect.value = this.model.fundingAsset?.color ?? '';
    if (this.model.assetsByColor.has(previousWithdrawal))
      this.dom.withdrawalSelect.value = previousWithdrawal;
    if (this.model.assetsByColor.has(previousGrant)) this.dom.grantAsset.value = previousGrant;
    if (this.model.account && this.model.accountBalances?.address !== this.model.account.address)
      this.model.accountBalances = {
        address: this.model.account.address,
        color: assets.find((asset) => asset.color !== '00'.repeat(32))?.color ?? '00'.repeat(32),
      };

    this.renderButtons();
  };
}
