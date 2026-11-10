import { walletFacts } from './wallet/view.js';

import { byId, el, shorten } from './ui-dom.js';
import type { UiModel } from './ui-state.js';

type Fact = { label: string; value: string; full?: string; copy?: string; hint?: string };
function copyTo(
  announce: (text: string) => void,
  button: HTMLButtonElement,
  value: string,
  what: string,
) {
  return (async (button: HTMLButtonElement, value: string, what: string) => {
    try {
      await navigator.clipboard.writeText(value);
      button.textContent = 'Copied';
      announce(`${what} copied.`);
      setTimeout(() => {
        button.textContent = 'Copy';
      }, 1500);
    } catch {
      announce('Copy failed: the browser refused clipboard access.');
    }
  })(button, value, what);
}
export class AccountCards {
  constructor(
    private readonly model: UiModel,
    private readonly announce: (text: string) => void,
  ) {}
  renderFacts = (list: HTMLElement, facts: readonly Fact[]) => {
    list.replaceChildren(
      ...facts.map((fact) => {
        const row = el('div', 'fact');
        const dt = el('dt', undefined, fact.label);
        const dd = el('dd');
        const value = el('span', 'value', fact.value);
        if (fact.full) value.title = fact.full;
        dd.append(value);
        if (fact.copy !== undefined) {
          const copy = el('button', 'btn-copy', 'Copy');
          copy.type = 'button';
          copy.setAttribute('aria-label', `Copy ${fact.label.toLowerCase()}`);
          const text = fact.copy;
          copy.addEventListener('click', () => void copyTo(this.announce, copy, text, fact.label));
          dd.append(copy);
        }
        if (fact.hint) dd.append(el('span', 'fact-hint', fact.hint));
        row.append(dt, dd);
        return row;
      }),
    );
  };
  renderAccount = () => {
    byId('account-empty').hidden = !!this.model.account;
    const list = byId('account-facts');
    list.hidden = !this.model.account;
    const context = byId('account-action-context');
    context.hidden = !this.model.account;
    byId('account-context-empty').hidden = !!this.model.account;
    byId('account-state-details').hidden = !this.model.account;
    byId('account-balances-empty').hidden = !this.model.account || !!this.model.accountBalances;
    if (!this.model.account) return;
    const { address, networkId, bindingId, state, lastTx } = this.model.account;
    this.renderFacts(context, [
      { label: 'Passport ACC', value: shorten(address, 10, 8), full: address, copy: address },
      { label: 'Network', value: networkId },
    ]);
    this.renderFacts(list, [
      { label: 'Address', value: shorten(address, 10, 8), full: address, copy: address },
      { label: 'Network', value: networkId },
      ...(this.model.accountBalances?.address === address
        ? [
            {
              label: 'NIGHT (Passport ACC)',
              value:
                this.model.accountBalances.night ?? this.model.accountBalances.error ?? 'Reading…',
              hint: this.model.accountBalances.error
                ? 'Latest refresh unavailable. Any displayed amount is a prior snapshot, not a new balance.'
                : 'Unshielded balance in smallest units.',
            },
            ...(this.model.accountBalances.color === '00'.repeat(32)
              ? []
              : [
                  {
                    label: `Test token ${shorten(this.model.accountBalances.color, 6, 4)}`,
                    value:
                      this.model.accountBalances.fundedAsset ??
                      this.model.accountBalances.error ??
                      'Reading…',
                    hint: this.model.accountBalances.error
                      ? 'Latest refresh unavailable. Any displayed amount is a prior snapshot, not a new balance.'
                      : 'Unshielded balance in smallest units.',
                  },
                ]),
          ]
        : []),
    ]);
    this.renderFacts(byId('account-state-facts'), [
      { label: 'Spec version', value: String(state.specVersion) },
      { label: 'Activated', value: state.booted ? 'Yes' : 'No' },
      { label: 'Auth nonce', value: state.authNonce.toString() },
      { label: 'Device epoch', value: state.deviceEpoch.toString() },
      {
        label: 'Device entries',
        value: String(state.entryCount),
        hint: 'Entries in the device set, not a device count (erratum 8).',
      },
      { label: 'Binding', value: bindingId },
      lastTx
        ? {
            label: 'Last transaction',
            value:
              shorten(lastTx.txHash, 10, 8) +
              (lastTx.blockHeight !== undefined ? ` · block ${lastTx.blockHeight}` : ''),
            full: lastTx.txHash,
            copy: lastTx.txHash,
          }
        : {
            label: 'Last transaction',
            value: '—',
            hint: 'Create and open do not report a transaction; rotate does.',
          },
    ]);
  };
  renderHoldings = () => {
    const current =
      this.model.account && this.model.shieldedHoldings?.address === this.model.account.address
        ? this.model.shieldedHoldings
        : undefined;
    const list = byId('holdings-facts');
    const empty = byId('holdings-empty');
    list.hidden = !current || current.coins.length === 0;
    empty.hidden = !!current && current.coins.length > 0;
    if (!current) {
      empty.textContent = 'Open an account, then read its shielded holdings.';
      return;
    }
    if (current.coins.length === 0) {
      empty.textContent = 'No chain-verified shielded coins found.';
      return;
    }
    this.renderFacts(
      list,
      current.coins.flatMap((coin) => [
        {
          label: `Inbox #${coin.inboxIndex}`,
          value: `${coin.value} smallest units`,
          hint: 'Chain-verified shielded coin.',
        },
        { label: 'Color', value: shorten(coin.color, 8, 6), full: coin.color, copy: coin.color },
      ]),
    );
  };
  renderRoster = () => {
    const current =
      this.model.account && this.model.deviceRoster?.address === this.model.account.address
        ? this.model.deviceRoster
        : undefined;
    const list = byId('roster-facts');
    const empty = byId('roster-empty');
    list.hidden = !current;
    empty.hidden = !!current;
    if (!current) return;
    this.renderFacts(list, [
      { label: 'Device epoch', value: current.deviceEpoch.toString() },
      { label: 'Auth nonce', value: current.authNonce.toString() },
      { label: 'Live entries', value: String(current.commitments.length) },
      ...current.commitments.map((commitment, index) => ({
        label: `Entry ${index + 1}`,
        value: shorten(commitment, 10, 8),
        full: commitment,
        copy: commitment,
      })),
    ]);
  };
  renderGrantRoster = () => {
    const current =
      this.model.account && this.model.grantRoster?.address === this.model.account.address
        ? this.model.grantRoster.roster
        : undefined;
    const list = byId('grant-roster-facts');
    const empty = byId('grant-roster-empty');
    list.hidden = !current;
    empty.hidden = !!current;
    if (!current) return;
    this.renderFacts(list, [
      { label: 'Generation', value: current.generation.toString() },
      { label: 'Auth nonce', value: current.authNonce.toString() },
      {
        label: 'Active grants',
        value: String(current.entries.filter((entry) => entry.active).length),
      },
      ...current.entries.map((entry, index) => ({
        label: `Grant ${index + 1}`,
        value: `${shorten(entry.id, 10, 8)} · ${entry.active ? 'active' : 'revoked'}${entry.read ? ' · read' : ''}`,
        full: entry.id,
        copy: entry.id,
      })),
    ]);
  };
  renderWallet = () => {
    const connected = Object.keys(this.model.wallet).length > 0;
    byId('wallet-empty').hidden = connected;
    const list = byId('wallet-facts');
    list.hidden = !connected;
    if (!connected) return;
    this.renderFacts(list, walletFacts(this.model.wallet));
  };
}
