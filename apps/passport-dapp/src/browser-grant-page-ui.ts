import { PassportConnectorError } from '@input-output-hk/mn-passport-account/errors';
import type { BeforePasskeyCeremony } from '@input-output-hk/mn-passport-adapter-webauthn';
import { grantNetwork } from './browser-grant-demo-config.js';

export function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  return node;
}

export function fields(values: readonly (readonly [string, string])[]): HTMLDListElement {
  const list = element('dl');
  for (const [label, value] of values) list.append(element('dt', label), element('dd', value));
  return list;
}

export function button(label: string, primary = false) {
  const node = element('button', label);
  node.type = 'button';
  if (primary) node.className = 'primary';
  return node;
}

export function input(label: string, name: string, maxLength: number, value = '') {
  const node = element('input');
  node.name = name;
  node.required = true;
  node.maxLength = maxLength;
  node.value = value;
  node.autocomplete = 'off';
  node.spellcheck = false;
  const wrapper = element('label', label);
  wrapper.append(node);
  return { wrapper, node };
}

export function consent(title: string, details: HTMLElement, passkey = true): Promise<boolean> {
  const dialog = document.querySelector<HTMLDialogElement>('#grant-consent');
  const heading = dialog?.querySelector('#grant-consent-title');
  const body = dialog?.querySelector('#grant-consent-details');
  const approval = dialog?.querySelector('button[value=approve]');
  if (!dialog || dialog.open || !heading || !body || !approval) return Promise.resolve(false);
  heading.textContent = title;
  body.replaceChildren(details);
  approval.textContent = passkey ? 'Continue to passkey' : 'Confirm';
  dialog.returnValue = '';
  return new Promise((resolve) => {
    dialog.addEventListener(
      'close',
      () => {
        body.replaceChildren();
        resolve(dialog.returnValue === 'approve');
      },
      { once: true },
    );
    dialog.showModal();
  });
}

const purposes = {
  create: 'Create a holder passkey',
  'verify-created': 'Verify the new holder passkey',
  'request-browser-grant': 'Sign this permission request',
  'identify-and-unlock': 'Identify your owner passkey and unlock the recovery journal',
  'authenticate-grant-relay': 'Authenticate to the sponsor relay',
  sign: 'Sign this on-chain permission',
} satisfies Partial<Record<Parameters<BeforePasskeyCeremony>[0]['purpose'], string>>;

export function ceremonyReview(
  scope: () => HTMLElement,
  allowed: readonly (keyof typeof purposes)[],
  check: () => void,
): BeforePasskeyCeremony {
  return async ({ purpose, rpId, attempt }) => {
    check();
    if (rpId !== location.hostname || !allowed.some((value) => value === purpose))
      throw new PassportConnectorError('NotAuthorised', 'Unexpected passkey request.');
    const title = purposes[purpose as keyof typeof purposes];
    const label = attempt === 1 ? title : title + ' · retry ' + attempt;
    if (!(await consent(label, scope())))
      throw new PassportConnectorError('UserCancelled', 'Passkey approval declined.');
    check();
  };
}

export function scopeDetails(scope: {
  account: string;
  color: string;
  recipient: string;
  perCallCap: string;
  cap: string;
  maxCoinValue: string;
  expiresAt: number | null;
}) {
  return fields([
    ['Passport account', scope.account],
    ['Network', grantNetwork],
    ['Asset', /^0{64}$/.test(scope.color) ? 'NIGHT' : scope.color],
    ['Fixed recipient', scope.recipient],
    ['Per transfer', scope.perCallCap + ' smallest units'],
    ['Total cap', scope.cap + ' smallest units'],
    ['Maximum coin value', scope.maxCoinValue + ' smallest units'],
    [
      'Expires',
      scope.expiresAt === null ? 'No expiry' : new Date(scope.expiresAt * 1000).toUTCString(),
    ],
  ]);
}

export function statusLine() {
  const status = element('p');
  status.setAttribute('role', 'status');
  return status;
}

export function grantOperation(
  actions: readonly HTMLButtonElement[],
  status: HTMLElement,
  work: (signal: AbortSignal) => Promise<void>,
) {
  return async () => {
    if (actions.some(({ disabled }) => disabled)) return;
    for (const action of actions) action.disabled = true;
    const controller = new AbortController();
    const leave = () => {
      controller.abort();
      const dialog = document.querySelector<HTMLDialogElement>('#grant-consent');
      if (dialog?.open) dialog.close('cancel');
    };
    const hide = () => {
      if (document.hidden) leave();
    };
    window.addEventListener('pagehide', leave, { once: true });
    document.addEventListener('visibilitychange', hide);
    try {
      await work(controller.signal);
    } catch (error) {
      status.textContent =
        error instanceof PassportConnectorError && error.code === 'UserCancelled'
          ? 'Approval cancelled.'
          : 'The action could not finish. Keep the original request and use recovery if it was submitted.';
    } finally {
      window.removeEventListener('pagehide', leave);
      document.removeEventListener('visibilitychange', hide);
      for (const action of actions) action.disabled = false;
    }
  };
}

export function checkGrantPage(signal: AbortSignal) {
  if (signal.aborted || document.hidden)
    throw new PassportConnectorError('Aborted', 'This grant action is no longer active.');
}
