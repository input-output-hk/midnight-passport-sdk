export type SettingsPage = 'security' | 'sessions' | 'grants' | 'wallets' | 'developer';

/** Navigation only; preserves all controls and drafts without issuing an account command. */
export function createSettingsWorkspace(root: HTMLElement, onChange: (page: SettingsPage) => void) {
  const nav = document.createElement('nav');
  nav.className = 'settings-nav';
  nav.setAttribute('aria-label', 'Settings sections');
  const names: Record<SettingsPage, [string, string]> = {
    security: ['Devices & passkeys', 'settings-devices'],
    sessions: ['Quick actions', 'settings-sessions'],
    grants: ['Permissions', 'settings-advanced-access'],
    wallets: ['Wallet connections', 'settings-wallet-connections'],
    developer: ['Developer tools', 'settings-developer-tools'],
  };
  const buttons = new Map<SettingsPage, HTMLButtonElement>();
  const pages = new Map<SettingsPage, HTMLElement>();
  for (const page of Object.keys(names) as SettingsPage[]) {
    const [label, id] = names[page];
    const section = document.getElementById(id)!;
    section.dataset.settingsPage = page;
    const button = document.createElement('button');
    button.type = 'button';
    button.id = `settings-tab-${page}`;
    button.textContent = label;
    button.setAttribute('aria-controls', id);
    section.setAttribute('aria-labelledby', button.id);
    nav.append(button);
    buttons.set(page, button);
    pages.set(page, section);
  }
  root.querySelector('.workspace-heading')!.after(nav);
  let selected: SettingsPage = 'security';
  const select = (page: SettingsPage, focus = false, notify = true) => {
    selected = page;
    for (const [id, section] of pages) {
      section.hidden = id !== page;
      if (id === page) buttons.get(id)!.setAttribute('aria-current', 'page');
      else buttons.get(id)!.removeAttribute('aria-current');
    }
    if (focus) buttons.get(page)!.focus();
    if (notify) onChange(page);
  };
  for (const [page, button] of buttons) button.addEventListener('click', () => select(page));
  select('security', false, false);
  return {
    navigation: nav,
    select,
    selected: () => selected,
    valid: (page: string): page is SettingsPage => Object.hasOwn(names, page),
  };
}
