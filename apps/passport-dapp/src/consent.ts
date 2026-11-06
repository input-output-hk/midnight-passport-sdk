import { PassportConnectorError } from '@input-output-hk/mn-passport-account';
import type { PasskeyCeremony } from '@input-output-hk/mn-passport-adapter-webauthn';
import { FLOWS, type ActionId } from './flows.js';
import { traceOperation } from './operation-trace.js';

const PURPOSES: Partial<Record<ActionId, string>> = {
  startSession:
    'Unlock a separate PRF-derived JubJub session key with this account’s passkey. Review the exact recipient, asset, caps and absolute expiry before owner signatures issue its on-chain grant. Eligible withdrawals use JubJub without more passkey prompts. Critical owner operations still require a fresh passkey ceremony. Session keys stay in page memory only; locking the page is not chain revocation.',
  revokeSession:
    'Lock the local session key, then use fresh owner passkey approval to revoke its grant on chain. Confirmed and already-submitted transfers cannot be undone.',
  create:
    'Create and verify a new passkey, unlock its local signing/reader keys, deploy and activate a sponsored ACC, and publish sealed viewing keys. This demo permanently retires maintenance authority: the account cannot later be upgraded. Keep access to this passkey; the demo provides no total-loss recovery.',
  open: 'Identify your passkey and unlock the reader keys needed to open this ACC. This does not approve a withdrawal or connect the separate HD wallet. Interrupted creation may need further signed activation or sealed-key publication.',
  openAt:
    'Identify an enrolled passkey and unlock the reader keys for the supplied ACC address. Knowing the address alone grants no access. This does not approve spending or recover a lost passkey.',
  holdings:
    'Unlock your reader keys to decrypt inbox entries, then show only holdings matched to the live chain. This is viewing access, not spending approval.',
  prepareJoiner:
    'Create and verify a joining-device passkey and derive its public signing/reader keys. Only its public handoff is exported. It receives no ACC authority until an existing owner approves enrollment.',
  prepareGrantee:
    'Create and verify a separate grant-holder passkey and derive its public JubJub key. The key receives no authority until the owner issues a scoped grant.',
  issueGrant:
    'Unlock the owner reader/journal keys. Then review the exact holder, asset, recipient, caps and expiry before signing a grant that can move ACC funds. Publishing its sealed bookkeeping may need additional signatures.',
  exportGrant:
    'Unlock the owner journal to export the selected grant opening. Give it only to the named grantee; the opening is not a private signing key.',
  spendGrant:
    'Identify the grant-holder passkey and unlock its JubJub signing key. Then separately review the exact recipient, asset, amount and remaining cap before signing this spend.',
  revokeGrant:
    'Unlock the owner keys, then review the selected grant before signing its revocation. This does not undo previously confirmed spending.',
  recoverGrants:
    'Unlock the original issuing reader and inspect sealed pending grant records. Recovery may publish previously staged bookkeeping; it cannot recreate a lost holder key. Reconcile any uncertain original operation before retrying.',
  enrollDevice:
    'Unlock owner reader keys, then review the joining-device fingerprint and live roster before enrolling it and delivering sealed viewing keys. This gives the new signer owner authority.',
  removeDevice:
    'Unlock owner reader keys to inspect holdings and surviving readers. Then review the exact entry before resealing keys and removing it through multiple transactions. Entry removal is not complete compromised-key revocation; earlier plaintext stays known.',
  rotate:
    'Unlock reader keys to inspect holdings, devices and read grants. Then review the live snapshot before publishing fresh seals and switching the ACC viewing key. Each P-256 signed transaction may need another passkey prompt.',
  wallet:
    'Derive the separate built-in HD wallet seed from this passkey’s PRF and sync its balances. This is not the ACC viewing secret, fee sponsor wallet or a recovery mechanism. The demo wallet is read-only.',
  withdraw:
    'An active, matching session uses its scoped JubJub grant after the exact transfer review. Outside its scope, or when you select owner approval, a fresh passkey is required. Review the exact network, ACC, recipient, asset and base-unit amount before signing an unshielded withdrawal. Reader-key derivation and P-256 signing are separate purposes. A timeout after submission does not mean no transfer.',
};

const CEREMONIES: Record<PasskeyCeremony['purpose'], string> = {
  create: 'Create a new passkey for this operation.',
  'verify-created':
    'Verify the new passkey’s signing format before deployment or enrollment. This second request checks that the newly created credential works with the ACC; creating it alone cannot establish that.',
  identify: 'Choose and verify the passkey for this operation.',
  sign: 'Sign the current ACC transaction. This is separate from unlocking local keys.',
  'derive-keys':
    'Unlock passkey-derived local keys (PRF). This is not an ACC transaction signature.',
};

interface ConsentContext {
  readonly network: string;
  readonly arm: 'p256' | 'jubjub';
  readonly account?: string | undefined;
  readonly target?: string | undefined;
}

/** Selection flows must not imply that an already-open ACC is the one being approved. */
export function reviewedAccount(
  action: ActionId,
  context: ConsentContext,
): { label: string; address?: string } {
  if (action === 'create') return { label: 'new ACC; address assigned during deployment' };
  if (action === 'open') return { label: 'selected by the passkey you choose' };
  if (action === 'spendGrant')
    return { label: 'from the grant opening; checked in the later spend review' };
  const address =
    action === 'openAt' || action === 'prepareJoiner' || action === 'prepareGrantee'
      ? context.target
      : context.account;
  return address ? { label: address, address } : { label: 'selected during this operation' };
}
let active:
  | {
      readonly action: ActionId;
      readonly id: string;
      readonly context: ConsentContext;
      requests: number;
      signatures: number;
    }
  | undefined;
let pendingCeremony: { cancel(): void } | undefined;
let ceremonyInFlight = false;

/** The demo permits one operation at a time; approval ends with that action, including failure. */
export async function reviewDemoAction(
  action: ActionId,
  context: ConsentContext,
): Promise<boolean> {
  finishDemoConsent();
  const purpose = PURPOSES[action];
  if (!purpose) return true; // Public reads/funding never authorize a passkey ceremony.
  const dialog = document.getElementById('consent-dialog') as HTMLDialogElement;
  const title = document.getElementById('consent-title')!;
  const details = document.getElementById('consent-details')!;
  const retirement = document.getElementById('consent-retirement')!;
  const acknowledgement = document.getElementById('consent-retirement-ack') as HTMLInputElement;
  const proceed = document.getElementById('consent-continue') as HTMLButtonElement;
  const cancel = document.getElementById('consent-cancel') as HTMLButtonElement;
  const accountReview = reviewedAccount(action, context);
  title.textContent = FLOWS[action].title;
  details.textContent =
    `Network: ${context.network}\nOwner arm: ${context.arm}\n` +
    `ACC: ${accountReview.label}\n\n${purpose}\n\nPrompts vary by provider, retry and transaction count. Cancelling stops future work; it cannot roll back a submitted transaction.`;
  retirement.hidden = action !== 'create';
  acknowledgement.checked = false;
  proceed.disabled = action === 'create';
  const id = crypto.randomUUID();
  const approved = await new Promise<boolean>((resolve) => {
    const changed = () => {
      proceed.disabled = action === 'create' && !acknowledgement.checked;
    };
    const close = () => {
      acknowledgement.removeEventListener('change', changed);
      dialog.removeEventListener('close', close);
      proceed.removeEventListener('click', yes);
      cancel.removeEventListener('click', no);
      resolve(
        dialog.returnValue === 'approved' && (action !== 'create' || acknowledgement.checked),
      );
    };
    const yes = () => dialog.close('approved');
    const no = () => dialog.close('declined');
    acknowledgement.addEventListener('change', changed);
    dialog.addEventListener('close', close);
    proceed.addEventListener('click', yes);
    cancel.addEventListener('click', no);
    dialog.returnValue = '';
    dialog.showModal();
    cancel.focus();
  });
  traceOperation(approved ? 'consent.approved' : 'consent.declined', {
    action,
    flowId: id,
    networkId: context.network,
    ...(accountReview.address && { accountAddress: accountReview.address }),
  });
  if (approved)
    active = { action, id, context: Object.freeze({ ...context }), requests: 0, signatures: 0 };
  return approved;
}

export function finishDemoConsent(): void {
  active = undefined;
  pendingCeremony?.cancel();
  const notice = document.getElementById('ceremony-purpose');
  if (notice) {
    notice.hidden = true;
    notice.dataset.ready = 'false';
  }
  document.dispatchEvent(new Event('passport:ceremony-finished'));
}

/** Each browser access needs its own approval; an operation review or prior prompt is insufficient. */
export async function beforeDemoCeremony(ceremony: Readonly<PasskeyCeremony>): Promise<void> {
  const consent = active;
  if (!consent || ceremony.rpId !== 'localhost' || ceremonyInFlight)
    throw new PassportConnectorError(
      'UserCancelled',
      'Approve the demo operation before using a passkey.',
    );
  ceremonyInFlight = true;
  try {
    const request = ++consent.requests;
    if (ceremony.purpose === 'sign' && ceremony.attempt === 1) consent.signatures++;
    const ceremonyId = crypto.randomUUID();
    const setup =
      ceremony.purpose === 'sign' && consent.action === 'create'
        ? `Setup signature ${consent.signatures}: publish a sealed viewing-key entry to the ACC inbox. Creation publishes reader envelopes and their registrations in separate signed transactions. These are not another login or an HD wallet transfer.\n\n`
        : '';
    const text = `${FLOWS[consent.action].title} — passkey request ${request}: ${CEREMONIES[ceremony.purpose]} Attempt ${ceremony.attempt}.`;
    const notice = document.getElementById('ceremony-purpose')!;
    notice.textContent = text;
    notice.hidden = false;
    notice.dataset.purpose = ceremony.purpose;
    notice.dataset.attempt = String(ceremony.attempt);
    notice.dataset.ready = 'false';
    notice.dataset.ceremonyId = ceremonyId;
    const dialog = document.getElementById('ceremony-dialog') as HTMLDialogElement;
    const proceed = document.getElementById('ceremony-continue') as HTMLButtonElement;
    const cancel = document.getElementById('ceremony-cancel') as HTMLButtonElement;
    document.getElementById('ceremony-title')!.textContent =
      `Passkey request ${request} · ${FLOWS[consent.action].title}`;
    document.getElementById('ceremony-details')!.textContent =
      `Network: ${consent.context.network}\nOwner arm: ${consent.context.arm}\nACC: ${reviewedAccount(consent.action, consent.context).label}\n\n` +
      setup +
      CEREMONIES[ceremony.purpose] +
      (ceremony.attempt > 1
        ? `\n\nRetry ${ceremony.attempt}: the browser returned a known signing-format variant the ACC cannot accept. No bytes are rewritten; this asks for a new assertion.`
        : '') +
      '\n\nContinue opens your password manager, which may ask for Touch ID or another verification. Cancel stops this request and future work; already submitted transactions remain and must be reconciled before retrying.';
    dialog.dataset.ceremonyId = ceremonyId;
    traceOperation('consent.ceremony', {
      action: consent.action,
      flowId: consent.id,
      purpose: ceremony.purpose,
      attempt: ceremony.attempt,
      ceremonyId,
      request,
    });
    const approved = await new Promise<boolean>((resolve) => {
      const pending = { cancel: () => dialog.close('declined') };
      const close = () => {
        dialog.removeEventListener('close', close);
        proceed.removeEventListener('click', yes);
        cancel.removeEventListener('click', no);
        if (pendingCeremony === pending) pendingCeremony = undefined;
        resolve(dialog.returnValue === 'approved' && active === consent);
      };
      const yes = () => dialog.close('approved');
      const no = () => dialog.close('declined');
      pendingCeremony = pending;
      dialog.addEventListener('close', close);
      proceed.addEventListener('click', yes);
      cancel.addEventListener('click', no);
      dialog.returnValue = '';
      dialog.showModal();
      cancel.focus();
    });
    traceOperation(approved ? 'consent.ceremony-approved' : 'consent.ceremony-declined', {
      action: consent.action,
      flowId: consent.id,
      ceremonyId,
      purpose: ceremony.purpose,
      attempt: ceremony.attempt,
      request,
    });
    if (!approved) {
      if (active === consent) finishDemoConsent();
      throw new PassportConnectorError('UserCancelled', 'The passkey request was declined.');
    }
    document.dispatchEvent(new Event('passport:present-ceremony'));
    // The first rAF is before paint; its promise continuation would still be before paint.
    // Cross a second frame so the visible explanation has a rendering opportunity first.
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
    if (active !== consent)
      throw new PassportConnectorError('UserCancelled', 'The operation approval ended.');
    const rect = notice.getBoundingClientRect();
    const visible =
      !notice.hidden &&
      notice.getClientRects().length > 0 &&
      rect.top >= 0 &&
      rect.bottom <= innerHeight &&
      getComputedStyle(notice).visibility !== 'hidden';
    if (!visible || document.querySelector('dialog[open]:not(#activity-sheet)'))
      throw new PassportConnectorError(
        'UserCancelled',
        'The passkey explanation is not visible. Open Activity and approve the operation again.',
      );
    notice.dataset.ready = 'true';
  } finally {
    ceremonyInFlight = false;
  }
}
