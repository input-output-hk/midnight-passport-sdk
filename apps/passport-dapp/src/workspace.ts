import { createAccountWorkspace } from './account-workspace.js';
import { renderSessionDraft } from './session-view.js';
import { createSettingsWorkspace } from './settings-workspace.js';
import { createWorkspacePages } from './workspace-pages.js';
import { createNavigationDrawer } from './navigation-drawer.js';
import {
  createWorkspaceNavigation,
  entryWorkspace,
  workspaceNames as names,
  type WorkspaceId,
} from './workspace-navigation.js';
import { createLandingPage } from './landing.js';

/** Demo-owned layout and navigation. Moving existing nodes keeps action state and IDs intact. */
export type { WorkspaceId } from './workspace-navigation.js';

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
  const { navigation: nav, views, buttons } = createWorkspaceNavigation();
  const center = node('div');
  center.className = 'workspace-center';
  center.id = 'workspace-content';
  center.tabIndex = -1;
  const skip = document.querySelector<HTMLAnchorElement>('.skip-link')!;
  skip.href = '#workspace-content';
  skip.textContent = 'Skip to content';
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
  createLandingPage(views.overview, (section) => show(section));
  const account = panelOf('account-title');
  const wallet = panelOf('wallet-title');
  const accountPages = createAccountWorkspace(views.account, account, (page) => {
    routePage('account', page);
  });
  const builtIn = node('section');
  builtIn.id = 'wallet-page-builtin';
  builtIn.append(wallet);
  const lace = node('section');
  lace.id = 'wallet-page-lace';
  const walletNote = node(
    'p',
    'These wallets are separate from your Passport account. A wallet connection grants no account permissions.',
  );
  views.wallet.append(walletNote, builtIn, lace);
  const walletPages = createWorkspacePages(views.wallet, {
    label: 'Midnight wallet pages',
    className: 'wallet-nav',
    initial: 'builtin' as 'builtin' | 'lace',
    pages: {
      builtin: { label: 'Built-in wallet', controlId: 'wallet-tab-builtin', section: builtIn },
      lace: { label: 'Lace Wallet', controlId: 'wallet-tab-lace', section: lace },
    },
    onChange: (page) => routePage('wallet', page),
  });

  const security = node('section');
  security.id = 'settings-devices';
  security.className = 'panel';
  security.append(node('h3', 'Devices & passkeys'));
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
  const sessions = node('section');
  sessions.id = 'settings-sessions';
  sessions.className = 'panel';
  sessions.append(node('h3', 'Quick actions'), byId('routine-controls'), session);
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
  const access = node('section');
  access.id = 'settings-advanced-access';
  access.className = 'panel';
  access.append(node('h3', 'Permissions · manual grants'));
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
  views.wallet.insertBefore(manage, builtIn);
  const advanced = node('section');
  advanced.id = 'settings-developer-tools';
  advanced.className = 'panel';
  advanced.append(node('h3', 'Developer tools'));
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
  const settingsPages = createSettingsWorkspace(views.settings, (page) => {
    routePage('settings', page);
  });
  const quick = node('p');
  quick.className = 'quick-access-summary';
  const quickStatus = node('span', 'Quick actions locked');
  quickStatus.id = 'routine-summary';
  const quickManage = node('button', 'Manage quick actions');
  quickManage.type = 'button';
  quickManage.className = 'btn btn-ghost';
  quickManage.addEventListener('click', () => {
    show('settings');
    settingsPages.select('sessions');
    byId('unlockRoutine').focus();
  });
  quick.append(quickStatus, quickManage);
  views.account.querySelector('.account-context')!.append(quick);
  oldActions.remove();

  const progress = panelOf('activity-title');
  const auditLog = node('section');
  auditLog.id = 'audit-page-events';
  auditLog.className = 'panel';
  const auditToolbar = node('div');
  auditToolbar.className = 'workspace-toolbar';
  auditToolbar.append(byId('copy'));
  views.audit.append(auditToolbar);
  auditLog.append(byId('log-title').parentElement!, byId('log-empty'), byId('log'));
  const auditSections = { events: auditLog } as Record<
    'events' | 'requests' | 'export',
    HTMLElement
  >;
  for (const [id, contentId, title] of [
    ['requests', 'trace', 'Requests & responses'],
    ['export', 'evidence', 'Export JSON'],
  ] as const) {
    const original = byId(contentId).closest('details')!;
    const section = node('section');
    section.id = `audit-page-${id}`;
    section.className = 'panel evidence';
    section.append(node('h3', title));
    for (const child of [...original.children])
      if (child.tagName !== 'SUMMARY') section.append(child);
    original.remove();
    auditSections[id] = section;
  }
  const auditNote = node(
    'p',
    'Review operation history, redacted requests and responses, or export the full public log. Navigation never retries a transaction.',
  );
  views.audit.append(auditNote, ...Object.values(auditSections));
  const auditPages = createWorkspacePages(views.audit, {
    label: 'Audit pages',
    className: 'audit-nav',
    initial: 'events' as 'events' | 'requests' | 'export',
    pages: {
      events: { label: 'Event log', controlId: 'audit-tab-events', section: auditSections.events },
      requests: {
        label: 'Requests & responses',
        controlId: 'audit-tab-requests',
        section: auditSections.requests,
      },
      export: {
        label: 'Export JSON',
        controlId: 'audit-tab-export',
        section: auditSections.export,
      },
    },
    onChange: (page) => routePage('audit', page),
  });
  const pagesByWorkspace = {
    account: accountPages,
    wallet: walletPages,
    audit: auditPages,
    settings: settingsPages,
  };
  for (const [id, pages] of Object.entries(pagesByWorkspace)) {
    const submenu = pages.navigation;
    submenu.id = `nav-${id}-submenu`;
    submenu.classList.add('workspace-submenu');
    buttons.get(id as WorkspaceId)?.after(submenu);
  }
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
  let expanded = false;
  let ceremonySheet = false;
  let selected: WorkspaceId = 'overview';
  let accountOpened = false;
  const scrollPositions = new Map<WorkspaceId, number>();
  let navigationDrawer: ReturnType<typeof createNavigationDrawer> | undefined;
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
  const show = (requested: WorkspaceId, focus = true) => {
    const id = entryWorkspace(requested, accountOpened);
    if (requested === 'overview' && accountOpened) accountPages.select('balances', false);
    if (selected !== id) scrollPositions.set(selected, center.scrollTop);
    selected = id;
    main.dataset.landing = String(id === 'overview');
    for (const view of Object.keys(views) as WorkspaceId[]) {
      views[view].hidden = view !== id;
      if (view === id) buttons.get(view)?.setAttribute('aria-current', 'page');
      else buttons.get(view)?.removeAttribute('aria-current');
      if (view !== 'overview') pagesByWorkspace[view].setActive(view === id);
    }
    if (id === 'audit') expanded = false;
    views[id].querySelector('.workspace-heading')!.append(toggle);
    history.replaceState(
      null,
      '',
      id === 'overview' ? '#overview' : `#${id}/${pagesByWorkspace[id].selected()}`,
    );
    updateActivity();
    center.scrollTop = scrollPositions.get(id) ?? 0;
    navigationDrawer?.label(names[id]);
    if (focus) byId(`workspace-${id}-title`).focus({ preventScroll: true });
    scope();
    document.dispatchEvent(new Event('passport:workspace-selected'));
  };
  function routePage(id: Exclude<WorkspaceId, 'overview'>, _page: string) {
    show(id, false);
    center.scrollTop = 0;
    scrollPositions.set(id, 0);
  }
  for (const [id, button] of buttons) button.addEventListener('click', () => show(id));
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
  manage.addEventListener('click', () => {
    show('settings');
    settingsPages.select('wallets');
  });
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
  center.append(...Object.values(views));
  main.replaceChildren(nav, center, activity);
  main.classList.add('workspace-shell');
  document.body.classList.add('workspace-app');
  navigationDrawer = createNavigationDrawer(main, nav, mobile, () => {
    byId(`workspace-${selected}-title`).focus({ preventScroll: true });
  });
  skip.addEventListener('click', (event) => {
    event.preventDefault();
    center.focus({ preventScroll: true });
  });
  const [hash, accountPage] = location.hash.slice(1).split('/');
  if (hash === 'account' && accountPage && accountPages.valid(accountPage))
    accountPages.select(accountPage, false);
  if (hash === 'wallet' && accountPage && walletPages.valid(accountPage))
    walletPages.select(accountPage, false, false);
  if (hash === 'audit' && accountPage && auditPages.valid(accountPage))
    auditPages.select(accountPage, false, false);
  if (hash === 'settings' && accountPage && settingsPages.valid(accountPage))
    settingsPages.select(accountPage, false, false);
  show(Object.hasOwn(names, hash ?? '') ? (hash as WorkspaceId) : 'overview', false);
  byId('brand-home').addEventListener('click', (event) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey)
      return;
    event.preventDefault();
    show('overview');
    navigationDrawer?.closeForNavigation();
  });
  window.addEventListener('hashchange', () => {
    const [workspace, page] = location.hash.slice(1).split('/');
    if (workspace === 'account' && page && accountPages.valid(page))
      accountPages.select(page, false);
    if (workspace === 'wallet' && page && walletPages.valid(page))
      walletPages.select(page, false, false);
    if (workspace === 'audit' && page && auditPages.valid(page))
      auditPages.select(page, false, false);
    if (workspace === 'settings' && page && settingsPages.valid(page))
      settingsPages.select(page, false, false);
    show(Object.hasOwn(names, workspace ?? '') ? (workspace as WorkspaceId) : 'overview');
  });
  // Presentation events never approve a credential or invoke an account command.
  let presentedCredential = false;
  document.addEventListener('passport:operation-started', () => {
    presentedCredential = false;
    if (!mobile.matches) expanded = true;
    updateActivity();
  });
  document.addEventListener('passport:operation-finished', () => {
    const phase = content.querySelector<HTMLElement>('.operation-status')?.dataset.phase;
    if (
      !mobile.matches ||
      presentedCredential ||
      !['succeeded', 'failed', 'unknown'].includes(phase ?? '')
    )
      return;
    if (document.querySelector('dialog[open]:not(#activity-sheet)')) return;
    if (!sheet.open) {
      sheet.append(content);
      sheet.returnValue = '';
      sheet.showModal();
      close.focus();
    }
    // Results without a credential ceremony stay readable, including session withdrawals
    // and early failures. Never infer the actual path from a static prompt estimate.
    ceremonySheet = false;
    updateActivity();
  });
  document.addEventListener('passport:present-ceremony', () => {
    presentedCredential = true;
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
    showAccount() {
      accountOpened = true;
      accountPages.select('balances', false);
      scrollPositions.delete('account');
      show('account');
      navigationDrawer?.closeForNavigation();
    },
    showAudit(operationId: string) {
      closeSheet('audit');
      auditPages.select('events', false, false);
      show('audit');
      navigationDrawer?.closeForNavigation();
      const entry = document.getElementById(`audit-${operationId}`);
      entry?.scrollIntoView({ block: 'nearest' });
    },
  };
}
