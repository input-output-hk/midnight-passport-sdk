/** App-owned navigation only: existing action nodes retain their state and callbacks. */
export type AccountPage = 'balances' | 'deposit' | 'withdraw';

const element = <K extends keyof HTMLElementTagNameMap>(tag: K, text?: string) => {
  const result = document.createElement(tag);
  if (text !== undefined) result.textContent = text;
  return result;
};

export function createAccountWorkspace(
  root: HTMLElement,
  accountCard: HTMLElement,
  onChange: (page: AccountPage) => void,
) {
  const context = element('section');
  context.className = 'account-context';
  context.setAttribute('aria-label', 'Account for these operations');
  const empty = element('p', 'No account open. Create or open a Passport account from Overview.');
  empty.id = 'account-context-empty';
  const facts = element('dl');
  facts.id = 'account-action-context';
  facts.className = 'facts';
  facts.hidden = true;
  context.append(empty, facts);
  const nav = element('div');
  nav.className = 'account-tabs';
  nav.setAttribute('role', 'tablist');
  nav.setAttribute('aria-label', 'Passport account operations');
  root.append(context, nav);
  const tabs = {} as Record<AccountPage, HTMLButtonElement>;
  const pages = {} as Record<AccountPage, HTMLElement>;
  const names = { balances: 'Balances', deposit: 'Deposit', withdraw: 'Withdraw' } as const;
  for (const id of Object.keys(names) as AccountPage[]) {
    const tab = element('button', names[id]);
    tab.type = 'button';
    tab.id = `account-tab-${id}`;
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-controls', `account-page-${id}`);
    const page = element('section');
    page.id = `account-page-${id}`;
    page.dataset.accountPage = id;
    page.className = 'account-page';
    page.setAttribute('role', 'tabpanel');
    page.setAttribute('aria-labelledby', tab.id);
    page.tabIndex = 0;
    tabs[id] = tab;
    pages[id] = page;
    nav.append(tab);
    root.append(page);
  }
  let selected: AccountPage = 'balances';
  const select = (page: AccountPage, notify = true) => {
    selected = page;
    for (const id of Object.keys(names) as AccountPage[]) {
      tabs[id].setAttribute('aria-selected', String(id === page));
      tabs[id].tabIndex = id === page ? 0 : -1;
      pages[id].hidden = id !== page;
    }
    if (notify) onChange(page);
  };
  const order = Object.keys(names) as AccountPage[];
  for (const id of order) {
    tabs[id].addEventListener('click', () => select(id));
    tabs[id].addEventListener('keydown', (event) => {
      const index = order.indexOf(id);
      const next =
        event.key === 'ArrowRight'
          ? order[(index + 1) % order.length]
          : event.key === 'ArrowLeft'
            ? order[(index + order.length - 1) % order.length]
            : event.key === 'Home'
              ? order[0]
              : event.key === 'End'
                ? order.at(-1)
                : undefined;
      if (!next) return;
      event.preventDefault();
      select(next);
      tabs[next].focus();
    });
  }

  const action = (id: string) => document.getElementById(id)!.closest<HTMLLIElement>('li')!;
  const list = (parent: HTMLElement, ids: readonly string[]) => {
    const result = element('ul');
    result.className = 'actions account-actions';
    for (const id of ids) result.append(action(id));
    parent.append(result);
    return result;
  };
  pages.balances.append(accountCard);
  list(accountCard, ['refresh']);
  const shielded = element('section');
  shielded.className = 'panel';
  shielded.append(element('h3', 'Shielded holdings'));
  list(shielded, ['holdings']);
  for (const id of ['holdings-empty', 'holdings-facts']) {
    const item = document.getElementById(id)!;
    if (id === 'holdings-empty') item.previousElementSibling?.remove();
    shielded.append(item);
  }
  pages.balances.append(shielded);
  for (const [id, title, description, button] of [
    [
      'deposit',
      'Deposit into Passport',
      'The demo funding wallet sends the selected fixed deposit to the open Passport ACC. This does not move funds from your connected wallet.',
      'fund',
    ],
    [
      'withdraw',
      'Withdraw from Passport',
      'Send an unshielded ACC asset to an explicit Midnight user address. Check the asset, amount and destination before approving the transfer.',
      'withdraw',
    ],
  ] as const) {
    const panel = element('section');
    panel.className = 'panel account-transfer';
    panel.append(element('h3', title), element('p', description));
    const unavailable = element(
      'p',
      id === 'deposit'
        ? 'Deposits are unavailable in this configuration. The operator must enable demo funding and its asset policy.'
        : 'No withdrawal asset is available in this demo configuration. Open the account and check funding configuration.',
    );
    unavailable.className = 'hint';
    unavailable.id = `account-${id}-unavailable`;
    panel.append(unavailable);
    const controls = list(panel, [button]);
    const original = controls.firstElementChild as HTMLLIElement;
    const update = () => {
      unavailable.hidden = !original.hidden;
    };
    new MutationObserver(update).observe(original, {
      attributes: true,
      attributeFilter: ['hidden'],
    });
    update();
    pages[id].append(panel);
  }
  select('balances', false);
  return { select, selected: () => selected };
}
