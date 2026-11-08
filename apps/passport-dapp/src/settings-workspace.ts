import { createWorkspacePages } from './workspace-pages.js';

export type SettingsPage = 'security' | 'sessions' | 'grants' | 'wallets' | 'developer';

/** Navigation only; preserves all controls and drafts without issuing an account command. */
export function createSettingsWorkspace(root: HTMLElement, onChange: (page: SettingsPage) => void) {
  const names: Record<SettingsPage, [string, string]> = {
    security: ['Devices & passkeys', 'settings-devices'],
    sessions: ['Quick actions', 'settings-sessions'],
    grants: ['Permissions', 'settings-advanced-access'],
    wallets: ['Wallet connections', 'settings-wallet-connections'],
    developer: ['Developer tools', 'settings-developer-tools'],
  };
  return createWorkspacePages(root, {
    label: 'Settings sections',
    className: 'settings-nav',
    initial: 'security' as SettingsPage,
    pages: Object.fromEntries(
      (Object.keys(names) as SettingsPage[]).map((page) => {
        const [label, id] = names[page];
        const section = document.getElementById(id)!;
        section.dataset.settingsPage = page;
        return [page, { label, controlId: `settings-tab-${page}`, section }];
      }),
    ) as Record<SettingsPage, { label: string; controlId: string; section: HTMLElement }>,
    onChange,
  });
}
