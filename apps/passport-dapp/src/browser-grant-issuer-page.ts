import {
  verifyBrowserP256GrantRequest,
  verifyRetainedBrowserP256GrantRequest,
} from '@input-output-hk/mn-passport-adapter-webauthn';
import { grantNetwork, grantPage } from './browser-grant-demo-config.js';
import { runIssuerPageOperation } from './browser-grant-page-ports.js';
import {
  button,
  ceremonyReview,
  checkGrantPage,
  element,
  fields,
  grantOperation,
  input,
  scopeDetails,
  statusLine,
} from './browser-grant-page-ui.js';

const issuerPending = 'passport.demo.browser-grant.issuer.v1';

function retained() {
  const raw = sessionStorage.getItem(issuerPending);
  if (!raw || raw.length > 17000) return;
  try {
    const value: unknown = JSON.parse(raw);
    if (
      typeof value === 'object' &&
      value !== null &&
      'account' in value &&
      typeof value.account === 'string' &&
      'fragment' in value &&
      typeof value.fragment === 'string'
    )
      return { account: value.account, fragment: value.fragment };
  } catch {
    /* A malformed hint cannot authorize recovery. */
  }
}

function readRequest(
  fragment: string,
  issuer: string,
  holder: string,
  account: string,
  fresh: boolean,
) {
  const verify = fresh ? verifyBrowserP256GrantRequest : verifyRetainedBrowserP256GrantRequest;
  const request = verify(fragment, {
    account,
    authoriserOrigin: issuer,
    networkId: grantNetwork,
    nowSeconds: Math.floor(Date.now() / 1000),
  });
  if (request.scope.grantee.origin !== holder || request.redirectUri !== holder + grantPage)
    throw new Error('Unexpected holder.');
  return request;
}

export function mountIssuerPage(
  main: HTMLElement,
  issuer: string,
  holder: string,
  received: string,
) {
  const pending = retained();
  const fragment = received || pending?.fragment;
  main.append(element('h1', 'Review withdrawal permission'));
  if (!fragment) {
    main.append(element('p', 'Open a permission request from the holder page to begin.'));
    return;
  }
  const form = element('form');
  const account = input(
    'Passport account address',
    'account',
    64,
    received ? '' : pending?.account,
  );
  const review = button('Review request', true);
  review.type = 'submit';
  const status = statusLine();
  form.append(account.wrapper, review, status);
  const result = element('section');
  result.hidden = true;
  main.append(
    element(
      'p',
      'Enter the account address the holder requested. Review the recipient and limits before using your owner passkey.',
    ),
    form,
    result,
  );
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const address = account.node.value.trim();
    try {
      const request = readRequest(fragment, issuer, holder, address, false);
      const details = scopeDetails(request.scope);
      const actions = element('div');
      actions.className = 'actions';
      const issue = button('Approve permission', true);
      const recover = button('Recover original request');
      const outcome = statusLine();
      const now = Math.floor(Date.now() / 1000);
      if (now <= request.validUntilSeconds && now < (request.scope.expiresAt ?? 0))
        actions.append(issue);
      actions.append(recover);
      result.replaceChildren(element('h2', 'Requested permission'), details, actions, outcome);
      result.hidden = false;
      bindActions({
        address,
        issuer,
        holder,
        fragment,
        result,
        outcome,
        issue,
        recover,
        account: account.node,
        review,
      });
      status.textContent = '';
    } catch {
      result.hidden = true;
      result.replaceChildren();
      status.textContent = 'This request does not match the selected account or configured holder.';
    }
  });
  account.node.addEventListener('input', () => {
    result.hidden = true;
    result.replaceChildren();
  });
}

interface IssuerActions {
  address: string;
  issuer: string;
  holder: string;
  fragment: string;
  result: HTMLElement;
  outcome: HTMLElement;
  issue: HTMLButtonElement;
  recover: HTMLButtonElement;
  account: HTMLInputElement;
  review: HTMLButtonElement;
}

function bindActions(ui: IssuerActions) {
  const { issuer, holder, fragment, address, issue, recover, outcome, review, account, result } =
    ui;
  for (const [action, control] of [
    ['issue', issue],
    ['recover', recover],
  ] as const) {
    control.addEventListener(
      'click',
      grantOperation([issue, recover, review], outcome, async (signal) => {
        const check = () => {
          checkGrantPage(signal);
          if (account.value.trim() !== address || !outcome.isConnected)
            throw new Error('Selection changed.');
        };
        check();
        const request = readRequest(fragment, issuer, holder, address, action === 'issue');
        const original = JSON.stringify({ account: address, fragment });
        sessionStorage.setItem(issuerPending, original);
        const selection = () => {
          check();
          if (sessionStorage.getItem(issuerPending) !== original)
            throw new Error('Request changed.');
        };
        let grantId: string | undefined;
        const details = () => {
          const view = element('div');
          if (action === 'recover')
            view.append(
              element(
                'p',
                'Recovery checks the original transaction. It may finish a previously prepared submission.',
              ),
            );
          view.append(scopeDetails(request.scope));
          if (grantId) view.append(fields([['Grant ID', grantId]]));
          return view;
        };
        const beforeCeremony = ceremonyReview(
          details,
          [
            'identify-and-unlock',
            'authenticate-grant-relay',
            ...(action === 'issue' ? ['sign' as const] : []),
          ],
          selection,
        );
        outcome.textContent =
          action === 'issue' ? 'Preparing owner approval…' : 'Finding the original request…';
        account.disabled = true;
        try {
          const value = await runIssuerPageOperation(action, {
            issuer,
            account: address,
            fragment,
            beforeCeremony,
            signal,
            checkCurrent: selection,
            async review(approved) {
              selection();
              grantId = approved.grantId;
              return action === 'issue';
            },
          });
          selection();
          if (value.status === 'granted') {
            const back = button('Return verified permission to holder', true);
            back.addEventListener('click', () => {
              if (!result.contains(back) || sessionStorage.getItem(issuerPending) !== original)
                return;
              if (Math.floor(Date.now() / 1000) >= (request.scope.expiresAt ?? 0)) {
                result.replaceChildren(element('h2', 'Permission expired'));
                return;
              }
              location.assign(value.callbackUrl);
            });
            result.replaceChildren(element('h2', 'Permission issued'), details(), back);
          } else {
            outcome.textContent =
              value.status === 'missing'
                ? 'No original request was found.'
                : value.status === 'receipt'
                  ? 'Original transaction confirmed. The permission is unavailable or expired.'
                  : 'The original request is unresolved. Use recovery again to check its outcome.';
          }
        } finally {
          account.disabled = false;
        }
      }),
    );
  }
}
