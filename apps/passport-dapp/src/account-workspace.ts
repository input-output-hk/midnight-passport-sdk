import { createWorkspacePages } from './workspace-pages.js';

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
  root.append(context);
  const pages = {} as Record<AccountPage, HTMLElement>;
  const names = { balances: 'Balances', deposit: 'Deposit', withdraw: 'Withdraw' } as const;
  for (const id of Object.keys(names) as AccountPage[]) {
    const page = element('section');
    page.id = `account-page-${id}`;
    page.dataset.accountPage = id;
    page.className = 'account-page';
    pages[id] = page;
    root.append(page);
  }
  const navigation = createWorkspacePages(root, {
    label: 'Passport account operations',
    className: 'account-tabs',
    initial: 'balances' as AccountPage,
    pages: Object.fromEntries(
      (Object.keys(names) as AccountPage[]).map((id) => [
        id,
        { label: names[id], controlId: `account-tab-${id}`, section: pages[id] },
      ]),
    ) as Record<AccountPage, { label: string; controlId: string; section: HTMLElement }>,
    onChange,
  });

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
  return {
    ...navigation,
    select: (page: AccountPage, notify = true) => navigation.select(page, false, notify),
  };
}
