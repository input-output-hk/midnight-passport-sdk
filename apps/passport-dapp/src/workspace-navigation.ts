import { createNavigationButton } from './navigation-drawer.js';

export const workspaceNames = {
  overview: 'Log in',
  account: 'Passport account',
  wallet: 'Midnight wallet',
  audit: 'Audit',
  settings: 'Settings',
} as const;
export type WorkspaceId = keyof typeof workspaceNames;

function createView(id: WorkspaceId): HTMLElement {
  const view = document.createElement('section');
  view.id = `workspace-${id}`;
  view.dataset.workspace = id;
  view.className = 'workspace-view';
  const heading = document.createElement('h2');
  heading.textContent = workspaceNames[id];
  heading.id = `workspace-${id}-title`;
  heading.tabIndex = -1;
  view.setAttribute('aria-labelledby', heading.id);
  const title = document.createElement('div');
  title.className = 'workspace-heading';
  title.append(heading);
  view.append(title);
  return view;
}

/** Authentication is an entry screen, never a workspace menu or a logout action. */
export function createWorkspaceNavigation() {
  const navigation = document.createElement('nav');
  navigation.className = 'workspace-nav';
  navigation.setAttribute('aria-label', 'Main navigation');
  const views: Record<WorkspaceId, HTMLElement> = {
    overview: createView('overview'),
    account: createView('account'),
    wallet: createView('wallet'),
    audit: createView('audit'),
    settings: createView('settings'),
  };
  const buttons = new Map<WorkspaceId, HTMLButtonElement>();
  for (const id of ['account', 'wallet', 'audit', 'settings'] as const) {
    const button = createNavigationButton(id, workspaceNames[id], views[id].id);
    buttons.set(id, button);
    const group = document.createElement('div');
    group.className = 'workspace-nav-group';
    group.append(button);
    navigation.append(group);
  }
  return { navigation, views, buttons };
}

/** A public route never creates authentication; only the verified-open callback sets that flag. */
export function entryWorkspace(id: WorkspaceId, accountOpened: boolean): WorkspaceId {
  return id === 'overview' && accountOpened ? 'account' : id;
}
