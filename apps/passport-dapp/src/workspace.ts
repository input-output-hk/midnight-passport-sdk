import { createAccountWorkspace, type AccountPage } from './account-workspace.js';
import { renderSessionDraft } from './session-view.js';

/** Demo-owned layout and navigation. Moving existing nodes keeps action state and IDs intact. */
export type WorkspaceId = 'overview' | 'account' | 'wallet' | 'audit' | 'settings';

const node = <K extends keyof HTMLElementTagNameMap>(tag: K, text?: string) => {
  const result = document.createElement(tag);
  if (text !== undefined) result.textContent = text;
  return result;
};
const byId = (id: string): HTMLElement => {
  const result = document.getElementById(id);
  if (!result) throw new Error(`Missing workspace element ${id}`);
  return result;
};
const panelOf = (id: string) => byId(id).closest<HTMLElement>('section')!;

export function createDemoWorkspace(config: {
  readonly networkId: string;
  readonly bindingId: string;
  readonly serviceUrl: string;
  readonly manifestSha256: string;
}) {
  const main = byId('main');
  const nav = node('nav');
  nav.className = 'workspace-nav';
  nav.setAttribute('aria-label', 'Main navigation');
  const center = node('div');
  center.className = 'workspace-center';
  const names: Record<WorkspaceId, string> = {
    overview: 'Overview',
    account: 'Passport account',
    wallet: 'Midnight wallet',
    audit: 'Audit',
    settings: 'Settings',
  };
  const views = {} as Record<WorkspaceId, HTMLElement>;
  const buttons = {} as Record<WorkspaceId, HTMLButtonElement>;
  for (const id of Object.keys(names) as WorkspaceId[]) {
    const view = node('section');
    view.id = `workspace-${id}`;
    view.dataset.workspace = id;
    view.className = 'workspace-view';
    const heading = node('h2', names[id]);
    heading.id = `workspace-${id}-title`;
    heading.tabIndex = -1;
    view.setAttribute('aria-labelledby', heading.id);
    view.append(heading);
    views[id] = view;
    const button = node('button', names[id]);
    button.type = 'button';
    button.id = `nav-${id}`;
    button.setAttribute('aria-controls', view.id);
    buttons[id] = button;
    nav.append(button);
  }
  // Keep relocated controls in the document: the existing UI intentionally resolves stable
  // IDs while composing later panels. Detaching a whole account card would hide its children.
  center.append(...Object.values(views));
  main.append(nav, center);
  const move = (view: WorkspaceId, item: HTMLElement) => views[view].append(item);
  const intro = main.querySelector<HTMLElement>('.intro')!;
  move('overview', intro);
  const oldActions = main.querySelector<HTMLElement>('.panel-actions')!;
  const actions = (parent: HTMLElement, ids: readonly string[]) => {
    const list = node('ul');
    list.className = 'actions';
    for (const id of ids) list.append(byId(id).closest('li')!);
    parent.append(list);
  };
  actions(views.overview, ['create', 'open', 'openAt']);
  const account = panelOf('account-title');
  const wallet = panelOf('wallet-title');
  const accountPages = createAccountWorkspace(views.account, account, (page) => {
    if (selected === 'account') history.replaceState(null, '', `#account/${page}`);
  });
  move('wallet', wallet);

  const security = node('details');
  security.id = 'settings-devices';
  views.settings.append(node('h3', 'Security & access'));
  security.className = 'panel';
  security.append(node('summary', 'Devices & passkeys'));
  views.settings.append(security);
  actions(security, ['prepareJoiner', 'roster', 'enrollDevice', 'removeDevice', 'rotate']);
  const moveBlock = (parent: HTMLElement, firstId: string, ids: readonly string[]) => {
    const first = byId(firstId);
    if (first.previousElementSibling) parent.append(first.previousElementSibling);
    for (const id of ids) parent.append(byId(id));
  };
  moveBlock(security, 'handoff-empty', ['handoff-empty', 'handoff-fingerprint', 'handoff-output']);
  moveBlock(security, 'roster-empty', ['roster-empty', 'roster-facts']);

  const session = panelOf('session-title');
  const sessions = node('details');
  sessions.id = 'settings-sessions';
  sessions.className = 'panel';
  sessions.append(node('summary', 'Sessions'), session);
  session.classList.remove('panel');
  move('settings', sessions);
  const editScope = byId('session-edit-target');
  const scope = () => {
    const asset = byId('withdraw-asset') as HTMLSelectElement;
    const recipient = byId('withdraw-recipient') as HTMLInputElement;
    renderSessionDraft(asset.value, recipient.value);
  };
  byId('withdraw-asset').addEventListener('change', scope);
  byId('withdraw-recipient').addEventListener('input', scope);
  scope();
  const access = node('details');
  access.id = 'settings-advanced-access';
  access.className = 'panel';
  access.append(node('summary', 'Advanced access · manual grants'));
  views.settings.append(access);
  actions(access, [
    'grantRoster',
    'prepareGrantee',
    'issueGrant',
    'exportGrant',
    'spendGrant',
    'revokeGrant',
    'recoverGrants',
  ]);
  moveBlock(access, 'grant-roster-empty', ['grant-roster-empty', 'grant-roster-facts']);

  // Existing preparation APIs share the explicit public target used by Open by address.
  // Mirror input fields, not account identity or authority, so Settings never relies on a hidden target.
  const target = byId('open-address') as HTMLInputElement;
  for (const [parent, id] of [
    [security, 'joiner-account-address'],
    [access, 'grantee-account-address'],
  ] as const) {
    const label = node('label', 'Target Passport ACC address (shared with Open by address)');
    label.htmlFor = id;
    const input = node('input');
    input.className = 'action-input';
    input.id = id;
    input.maxLength = 64;
    input.autocomplete = 'off';
    const sync = () => {
      input.value = target.value;
      input.disabled = target.disabled;
    };
    input.addEventListener('input', () => {
      if (target.disabled) {
        sync();
        return;
      }
      target.value = input.value;
      target.dispatchEvent(new Event('input', { bubbles: true }));
    });
    target.addEventListener('input', sync);
    new MutationObserver(sync).observe(target, { attributes: true, attributeFilter: ['disabled'] });
    parent.insertBefore(input, parent.children[1] ?? null);
    input.before(label);
    sync();
  }
  const connections = node('section');
  connections.className = 'panel';
  connections.id = 'settings-wallet-connections';
  connections.append(node('h3', 'Wallet connections'));
  connections.append(
    node(
      'p',
      'The built-in Midnight wallet is separate from your Passport ACC. Connecting a wallet grants no ACC authority.',
    ),
  );
  actions(connections, ['wallet']);
  views.settings.append(connections);
  const manage = node('button', 'Manage wallet connections');
  manage.id = 'manage-wallet-connections';
  manage.className = 'btn btn-secondary';
  manage.type = 'button';
  wallet.append(manage);
  const advanced = node('details');
  advanced.id = 'settings-developer-tools';
  advanced.className = 'panel';
  advanced.append(node('summary', 'Advanced · Developer tools'));
  const configuration = node('section');
  configuration.id = 'demo-configuration';
  configuration.className = 'panel';
  configuration.append(node('h3', 'Build configuration · read only'));
  const pins = node('dl');
  for (const [label, value] of [
    ['Network', config.networkId],
    ['ACC binding', config.bindingId],
    ['Passport service', config.serviceUrl],
    ['Pinned manifest SHA-256', config.manifestSha256],
  ]) {
    const term = node('dt', label);
    const definition = node('dd', value);
    definition.className = 'value';
    pins.append(term, definition);
  }
  configuration.append(
    pins,
    node(
      'p',
      'These are build inputs, not a live service-readiness or artifact-integrity check. Change operator configuration outside this page; no token or secret belongs here.',
    ),
  );
  advanced.append(configuration);
  advanced.append(
    panelOf('capability-title'),
    panelOf('name-service-title'),
    panelOf('notes-title'),
  );
  if (import.meta.env.DEV) {
    const example = node('a', 'Optional React host example · synthetic observations only');
    example.href = '/examples/react-activity.html';
    example.target = '_blank';
    example.rel = 'noopener';
    advanced.append(example);
  }
  views.settings.append(advanced);
  oldActions.remove();

  const progress = panelOf('activity-title');
  const auditLog = node('section');
  auditLog.className = 'panel';
  auditLog.append(byId('log-title').parentElement!, byId('log-empty'), byId('log'));
  move('audit', auditLog);
  for (const id of ['trace', 'evidence']) move('audit', byId(id).closest('details')!);
  const auditNote = node(
    'p',
    'Public operation history for this page. Full exchanges are redacted; durable unknown-intent guards remain separate and survive reload. Navigation never retries a transaction.',
  );
  views.audit.insertBefore(auditNote, auditLog);
  const activity = node('aside');
  activity.id = 'activity-panel';
  activity.className = 'panel activity-panel';
  activity.setAttribute('aria-label', 'Activity');
  const content = node('div');
  content.id = 'activity-content';
  activity.append(content);
  const toggle = node('button', 'Hide Activity');
  toggle.type = 'button';
  toggle.id = 'activity-toggle';
  toggle.className = 'btn btn-secondary';
  toggle.setAttribute('aria-controls', activity.id);
  const sheet = node('dialog');
  sheet.id = 'activity-sheet';
  sheet.setAttribute('aria-labelledby', 'activity-sheet-title');
  sheet.setAttribute('aria-modal', 'true');
  const sheetTitle = node('h2', 'Activity');
  sheetTitle.id = 'activity-sheet-title';
  const close = node('button', 'Close Activity');
  close.id = 'activity-close';
  close.type = 'button';
  close.className = 'btn btn-secondary';
  sheet.append(sheetTitle, close);
  sheet.addEventListener('keydown', (event) => {
    if (event.key !== 'Tab' || !sheet.open) return;
    const focusable = [
      ...sheet.querySelectorAll<HTMLElement>(
        'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    ].filter(
      (item) =>
        !item.hidden &&
        item.getClientRects().length > 0 &&
        getComputedStyle(item).visibility !== 'hidden',
    );
    const first = focusable[0] ?? close;
    const last = focusable.at(-1) ?? close;
    if (event.shiftKey && (document.activeElement === first || document.activeElement === sheet)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });
  document.body.append(sheet);
  const mobile = matchMedia('(max-width: 900px)');
  let expanded = true;
  let ceremonySheet = false;
  let selected: WorkspaceId = 'overview';
  const updateActivity = () => {
    main.dataset.activity = expanded && !mobile.matches ? 'expanded' : 'collapsed';
    activity.hidden = mobile.matches || !expanded;
    const phase = content.querySelector<HTMLElement>('.operation-status')?.dataset.phase;
    const attention =
      !byId('operation-safety-notice').hidden || phase === 'unknown' || phase === 'failed';
    const label = mobile.matches ? 'Activity' : expanded ? 'Hide Activity' : 'Show Activity';
    const state = attention
      ? 'Needs attention'
      : phase === 'running'
        ? 'In progress'
        : phase === 'succeeded'
          ? 'Completed'
          : '';
    const caption = state && (mobile.matches || !expanded) ? `${label} · ${state}` : label;
    if (toggle.textContent !== caption) toggle.textContent = caption;
    toggle.classList.toggle('has-attention', attention);
    toggle.setAttribute('aria-live', 'polite');
    toggle.setAttribute('aria-expanded', String(mobile.matches ? sheet.open : expanded));
    toggle.setAttribute('aria-controls', mobile.matches ? sheet.id : activity.id);
  };
  const show = (id: WorkspaceId, focus = true) => {
    selected = id;
    for (const view of Object.keys(views) as WorkspaceId[]) {
      views[view].hidden = view !== id;
      if (view === id) buttons[view].setAttribute('aria-current', 'page');
      else buttons[view].removeAttribute('aria-current');
    }
    if (id === 'audit') expanded = false;
    history.replaceState(
      null,
      '',
      id === 'account' ? `#account/${accountPages.selected()}` : `#${id}`,
    );
    updateActivity();
    if (focus) byId(`workspace-${id}-title`).focus();
    scope();
  };
  for (const id of Object.keys(names) as WorkspaceId[])
    buttons[id].addEventListener('click', () => show(id));
  const closeSheet = (reason = '') => {
    if (sheet.open) sheet.close(reason);
  };
  close.addEventListener('click', () => closeSheet());
  sheet.addEventListener('close', () => {
    activity.append(content);
    updateActivity();
    if (sheet.returnValue !== 'audit') toggle.focus();
  });
  toggle.addEventListener('click', () => {
    ceremonySheet = false;
    if (mobile.matches) {
      sheet.append(content);
      sheet.returnValue = '';
      sheet.showModal();
      updateActivity();
      close.focus();
    } else {
      expanded = !expanded;
      updateActivity();
    }
  });
  mobile.addEventListener('change', () => {
    closeSheet();
    updateActivity();
  });
  manage.addEventListener('click', () => show('settings'));
  editScope.addEventListener('click', () => {
    show('account');
    accountPages.select('withdraw');
    byId('withdraw-recipient').focus();
  });
  const safetyNotice = node('p');
  safetyNotice.id = 'operation-safety-notice';
  safetyNotice.className = 'operation-safety-notice';
  safetyNotice.setAttribute('role', 'alert');
  safetyNotice.hidden = true;
  const operationDetails = node('div');
  operationDetails.className = 'activity-operation-details';
  progress.classList.remove('panel');
  progress.querySelector<HTMLElement>('.panel-head')!.hidden = true;
  progress.setAttribute('aria-label', 'Operation progress and result');
  progress.removeAttribute('aria-labelledby');
  const purpose = byId('ceremony-purpose');
  operationDetails.append(purpose, safetyNotice, progress);
  content.append(operationDetails);
  center.append(toggle, ...Object.values(views));
  main.replaceChildren(nav, center, activity);
  main.classList.add('workspace-shell');
  const [hash, accountPage] = location.hash.slice(1).split('/');
  if (hash === 'account' && ['balances', 'deposit', 'withdraw'].includes(accountPage ?? ''))
    accountPages.select(accountPage as AccountPage, false);
  show(Object.hasOwn(names, hash ?? '') ? (hash as WorkspaceId) : 'overview', false);
  // Presentation events never approve a credential or invoke an account command.
  document.addEventListener('passport:present-ceremony', () => {
    if (document.querySelector('dialog[open]:not(#activity-sheet)')) return;
    if (mobile.matches) {
      if (!sheet.open) {
        ceremonySheet = true;
        sheet.append(content);
        sheet.returnValue = '';
        sheet.showModal();
      }
    } else expanded = true;
    updateActivity();
    purpose.scrollIntoView({ block: 'nearest' });
  });
  document.addEventListener('passport:ceremony-finished', () => {
    if (ceremonySheet) closeSheet('ceremony-complete');
    ceremonySheet = false;
    updateActivity();
  });
  const notices = new MutationObserver(updateActivity);
  notices.observe(safetyNotice, { attributes: true, childList: true, subtree: true });
  notices.observe(progress, { childList: true, subtree: true });
  return {
    activityRoot: content,
    operationDetails,
    show,
    selected: () => selected,
    showAudit(operationId: string) {
      closeSheet('audit');
      show('audit');
      const entry = document.getElementById(`audit-${operationId}`);
      entry?.scrollIntoView({ block: 'nearest' });
    },
  };
}
