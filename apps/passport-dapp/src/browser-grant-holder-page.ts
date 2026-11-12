import {
  verifyLiveP256GrantOpening,
  type P256UnshieldedGrantOpening,
} from '@input-output-hk/mn-passport-account';
import type { PasskeyCredential } from '@input-output-hk/mn-passport-account/ports';
import { PassportConnectorError } from '@input-output-hk/mn-passport-account/errors';
import { browserPasskey } from '@input-output-hk/mn-passport-adapter-webauthn';
import { MidnightBech32m, UnshieldedAddress } from '@midnightntwrk/wallet-sdk-address-format';
import { grantNetwork, grantPage } from './browser-grant-demo-config.js';
import {
  captureDemoBrowserGrantCallback,
  checkDemoBrowserGrantDraft,
  pendingBrowserGrantKey,
  prepareDemoBrowserGrantRequest,
} from './browser-grant-holder-journey.js';
import { holderPorts } from './browser-grant-page-ports.js';
import {
  button,
  ceremonyReview,
  checkGrantPage,
  consent,
  element,
  grantOperation,
  input,
  scopeDetails,
  statusLine,
} from './browser-grant-page-ui.js';

function holderDraft(form: HTMLFormElement, issuer: string) {
  const formData = new FormData(form);
  const text = (name: string) => String(formData.get(name) ?? '').trim();
  const cap = text('cap');
  const recipient = MidnightBech32m.parse(text('recipient')).decode(
    UnshieldedAddress,
    grantNetwork,
  ).hexString;
  if (!/^(?:[0-9]|[1-9][0-9]{1,2})$/.test(text('slot'))) throw new Error('Invalid slot.');
  return {
    issuer,
    redirectUri: location.origin + grantPage,
    account: text('account'),
    slot: Number(text('slot')),
    color: text('color'),
    recipient,
    perCallCap: text('per-call'),
    cap,
    maxCoinValue: cap,
    expiresAt: Math.floor(Date.now() / 1000) + 900,
  };
}

function originalUrl(issuer: string): string | undefined {
  const raw = sessionStorage.getItem(pendingBrowserGrantKey);
  if (!raw || raw.length > 17000) return;
  const value: unknown = JSON.parse(raw);
  if (
    typeof value !== 'object' ||
    value === null ||
    !('issuer' in value) ||
    value.issuer !== issuer ||
    !('originalFragment' in value) ||
    typeof value.originalFragment !== 'string' ||
    !/^#request=[\w-]+&proof=[\w-]+$/.test(value.originalFragment)
  )
    return;
  return issuer + grantPage + value.originalFragment;
}

function pendingHolder(
  main: HTMLElement,
  issuer: string,
  verify?: ReturnType<typeof captureDemoBrowserGrantCallback>,
) {
  const panel = element('section');
  const status = statusLine();
  const actions = element('div');
  actions.className = 'actions';
  panel.append(element('h2', 'Pending request'), actions, status);
  const resume = button('Return to issuer');
  const forget = button('Forget this request');
  actions.append(resume, forget);
  resume.addEventListener('click', () => {
    let url: string | undefined;
    try {
      url = originalUrl(issuer);
    } catch {
      /* An invalid record cannot be reopened. */
    }
    if (url) location.assign(url);
    else status.textContent = 'The original request could not be read.';
  });
  forget.addEventListener(
    'click',
    grantOperation([resume, forget], status, async (signal) => {
      if (
        !(await consent(
          'Forget this request?',
          element(
            'p',
            'This clears the request from this tab. Any permission already issued stays active until expiry or revocation.',
          ),
          false,
        ))
      )
        return;
      checkGrantPage(signal);
      sessionStorage.removeItem(pendingBrowserGrantKey);
      location.reload();
    }),
  );
  if (verify) {
    const verifyButton = button('Verify permission', true);
    actions.prepend(verifyButton);
    verifyButton.addEventListener(
      'click',
      grantOperation([resume, forget, verifyButton], status, async (signal) => {
        status.textContent = 'Checking the live Passport account…';
        const { opening, credential } = await verify(await holderPorts(issuer, signal), () =>
          checkGrantPage(signal),
        );
        checkGrantPage(signal);
        showVerified(panel, issuer, opening, credential);
      }),
    );
  }
  main.append(panel);
}

function showVerified(
  panel: HTMLElement,
  issuer: string,
  opening: P256UnshieldedGrantOpening,
  credential: PasskeyCredential | undefined,
) {
  panel.replaceChildren(element('h2', 'Permission verified'), scopeDetails(opening.scope));
  if (!credential) {
    panel.append(element('p', 'The original holder passkey reference is unavailable for export.'));
    return;
  }
  const copy = button('Copy permission JSON');
  const status = statusLine();
  copy.addEventListener(
    'click',
    grantOperation([copy], status, async (signal) => {
      const check = () => checkGrantPage(signal);
      const ports = await holderPorts(issuer, signal);
      check();
      const passkey = browserPasskey({
        rpId: location.hostname,
        origin: location.origin,
        async beforeCeremony({ purpose, attempt }) {
          check();
          if (purpose !== 'sign')
            throw new PassportConnectorError('NotAuthorised', 'Unexpected request.');
          const details = element('div');
          details.append(
            scopeDetails(opening.scope),
            element(
              'p',
              'The copied opening is private. Only share it with a client you trust to use this permission.',
            ),
          );
          const title =
            'Approve private permission export' + (attempt === 1 ? '' : ' · retry ' + attempt);
          if (!(await consent(title, details)))
            throw new PassportConnectorError('UserCancelled', 'Passkey approval declined.');
          check();
        },
      });
      // Prove possession of this holder credential with a fresh challenge. Nothing is submitted.
      await passkey.sign(credential, crypto.getRandomValues(new Uint8Array(32)));
      check();
      const live = await verifyLiveP256GrantOpening(opening, ports);
      check();
      await navigator.clipboard.writeText(JSON.stringify(live));
      status.textContent = 'Permission copied.';
    }),
  );
  panel.append(
    element('p', 'Use your holder passkey to copy the private permission before leaving.'),
    copy,
    status,
  );
}

export function mountHolderPage(
  main: HTMLElement,
  issuer: string,
  hasCallback: boolean,
  verify?: ReturnType<typeof captureDemoBrowserGrantCallback>,
) {
  main.append(
    element('h1', 'Request withdrawal permission'),
    element('p', 'Ask a Passport account owner to approve a limited transfer to one recipient.'),
  );
  if (sessionStorage.getItem(pendingBrowserGrantKey) !== null || hasCallback) {
    pendingHolder(main, issuer, verify);
    return;
  }
  const form = element('form');
  const group = element('div');
  group.className = 'fields';
  group.append(
    input('Per-transfer cap (smallest units)', 'per-call', 39, '1').wrapper,
    input('Total cap (smallest units)', 'cap', 39, '5').wrapper,
    input('Permission slot (0–255)', 'slot', 3, '0').wrapper,
  );
  const start = button('Create permission request', true);
  start.type = 'submit';
  const status = statusLine();
  form.append(
    input('Passport account address', 'account', 64).wrapper,
    input('Fixed recipient’s unshielded Midnight address', 'recipient', 160).wrapper,
    input('Asset ID (NIGHT by default)', 'color', 64, '00'.repeat(32)).wrapper,
    group,
    element('p', 'The permission expires 15 minutes after you start the request.'),
    start,
    status,
  );
  main.append(form);
  const run = grantOperation([start], status, async (signal) => {
    let draft;
    try {
      draft = holderDraft(form, issuer);
      checkDemoBrowserGrantDraft(draft);
    } catch {
      status.textContent = 'Check the account address, recipient, asset, slot and amounts.';
      return;
    }
    const checkCurrent = () => checkGrantPage(signal);
    const beforeCeremony = ceremonyReview(
      () => scopeDetails(draft),
      ['create', 'verify-created', 'request-browser-grant'],
      checkCurrent,
    );
    const passkey = browserPasskey({
      rpId: location.hostname,
      origin: location.origin,
      beforeCeremony,
    });
    const credential = await passkey.create('Passport permission');
    const url = await prepareDemoBrowserGrantRequest({
      ...draft,
      credential,
      checkCurrent,
      beforeCeremony,
    });
    checkCurrent();
    location.assign(url);
  });
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    void run();
  });
}
