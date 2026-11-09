import { PassportConnectorError } from '@input-output-hk/mn-passport-account';
import type { PasskeyCeremony } from '@input-output-hk/mn-passport-adapter-webauthn';
import { FLOWS, type ActionId } from './flows.js';
import { traceOperation } from './operation-trace.js';
import { CRITICAL_ACTIONS } from './credential-policy.js';
import {
  admitExactReview,
  exactReviewText,
  refuseExactReview,
  type ExactReview,
} from './exact-review.js';

const PURPOSES: Partial<Record<ActionId, string>> = {
  unlockOwner:
    'Unlock the full JubJub owner key in this page for the selected duration (10 minutes by default). Critical actions still require fresh passkey approval, but malicious page code or an extension with page-memory access could copy this key and act as the owner without those approvals. Locking or expiry clears local copies; it does not revoke a copied key’s on-chain authority. On a P-256 account, adding this owner requires separate enrollment approval and passkey signatures.',
  unlockRoutine:
    'Use the open account’s passkey PRF to unlock routine reading and built-in wallet keys for the selected 10–30 minute lifetime. Keep these only in this page’s memory and derive a separate JubJub key. This does not add an owner or grant spending permission. Device changes, key rotation, and issuing/revoking permissions still require fresh passkey approval. Lock, hidden tab, page exit or expiry discards the routine key material.',
  startSession:
    'Unlock a separate PRF-derived JubJub session key with this account’s passkey. Review the exact recipient, asset, caps and absolute expiry before owner signatures issue its on-chain grant. Eligible withdrawals use JubJub without more passkey prompts. Critical owner operations still require a fresh passkey ceremony. Session keys stay in page memory only; locking the page is not chain revocation.',
  revokeSession:
    'Lock the local session key, then use fresh owner passkey approval to revoke its grant on chain. Confirmed and already-submitted transfers cannot be undone.',
  create:
    'Create a passkey and a sponsored Passport account. Setup verifies the passkey and publishes sealed reading keys. This demo permanently retires maintenance authority, so the account cannot be upgraded. Keep your passkey; the demo has no recovery if it is lost.',
  open: 'Open your Passport with its passkey. Keep only reading and wallet keys in this tab for the reviewed lifetime. Login does not approve spending, enroll an owner or connect a wallet. Interrupted setup may need separate signatures.',
  openAt:
    'Open this account with an enrolled passkey. Keep only reading and wallet keys in this tab for the reviewed lifetime. Login does not approve spending or recover a lost passkey.',
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
    'Verify that your new passkey can sign for this account before deployment or enrollment.',
  identify: 'Choose and verify the passkey for this operation.',
  'identify-and-unlock':
    'Choose your passkey and unlock local account keys in this request (PRF). Raw PRF outputs are cleared when login ends.',
  sign: 'Sign the current ACC transaction. This is separate from unlocking local keys.',
  'derive-keys': 'Unlock this account’s local keys with the passkey (PRF).',
};

interface ConsentContext {
  readonly network: string;
  readonly arm: 'p256' | 'jubjub';
  readonly account?: string | undefined;
  readonly target?: string | undefined;
  readonly routineUnlocked?: boolean;
  readonly ownerUnlocked?: boolean;
  readonly routineMinutes?: number;
  readonly check?: () => void;
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
interface ActiveConsent {
  readonly action: ActionId;
  readonly id: string;
  readonly context: ConsentContext;
  readonly purpose: string;
  requests: number;
  signatures: number;
  reviewed: boolean;
  retirementApproved: boolean;
  exact?: {
    readonly intent: ExactReview;
    readonly check: () => void;
    approved: boolean;
  };
}
let active: ActiveConsent | undefined;
let pendingCeremony: { cancel(): void } | undefined;
let ceremonyInFlight = false;

/** Stage known exact fields for a route that must obtain a credential before its effect. */
export function stageExactCredentialReview(input: ExactReview, check: () => void): void {
  const consent = active;
  if (!consent || consent.exact || consent.requests || ceremonyInFlight || pendingCeremony)
    return refuseExactReview();
  checkActive(consent);
  const intent = admitExactReview(input);
  const { context } = consent;
  const route = context.ownerUnlocked ? 'authenticated-owner' : 'primary';
  const scheme =
    context.ownerUnlocked || context.arm === 'jubjub' ? 'jubjub-schnorr' : 'p256-webauthn';
  if (
    intent.kind !== consent.action ||
    intent.account !== context.account ||
    intent.networkId !== context.network ||
    intent.route !== route ||
    intent.scheme !== scheme
  )
    return refuseExactReview();
  check();
  consent.exact = { intent, check, approved: false };
}

function approvedExact(kind: ExactReview['kind']): ExactReview {
  const consent = active;
  if (!consent || !consent.exact?.approved || consent.exact.intent.kind !== kind)
    return refuseExactReview();
  checkActive(consent);
  return consent.exact.intent;
}

/** Final host effect boundary. A staged intent, preparation access or another action is insufficient. */
export function assertExactWithdrawal(input: {
  account: string;
  scheme: 'p256-webauthn' | 'jubjub-schnorr';
  color: string;
  amount: string;
  recipient: string;
}): void {
  const intent = approvedExact('withdraw');
  if (
    intent.kind !== 'withdraw' ||
    input.account !== intent.account ||
    input.scheme !== intent.scheme ||
    input.color !== intent.color ||
    input.amount !== intent.amount ||
    input.recipient !== intent.recipient
  )
    return refuseExactReview();
}

export function assertExactGrantExport(account: string, grantId: string): void {
  const intent = approvedExact('exportGrant');
  if (intent.kind !== 'exportGrant' || intent.account !== account || intent.grantId !== grantId)
    return refuseExactReview();
}

/** Prepare one action; only the actual credential review grants passkey approval. */
export async function reviewDemoAction(action: ActionId, input: ConsentContext): Promise<boolean> {
  finishDemoConsent();
  const context = Object.freeze({ ...input });
  const ownerPurpose: Partial<Record<ActionId, string>> = {
    holdings: 'Decrypt and chain-verify private holdings.',
    wallet: 'Connect the separate built-in HD wallet; this does not change ACC ownership.',
    issueGrant: 'Review the holder, asset, recipient, caps and expiry before issuing a permission.',
    exportGrant: 'Export the selected encrypted-journal grant opening, not a private signing key.',
    revokeGrant: 'Review and revoke the selected permission; confirmed transfers cannot be undone.',
    recoverGrants: 'Reconcile staged grant bookkeeping using the original records and intents.',
    enrollDevice:
      'Review the new owner’s keys and live roster before delivering sealed keys and enrolling it.',
    removeDevice:
      'Review the exact entry, holdings and survivors before key rotation and removal. Earlier plaintext remains known.',
    rotate:
      'Review the live devices, holdings and read grants before resealing and rotating viewing keys.',
    withdraw:
      'Review the exact network, account, recipient, asset and smallest-unit amount. Existing grant and unknown-transaction fences remain enforced.',
    startSession:
      'Review and issue a separately scoped transfer permission for its own holder, caps and expiry.',
    revokeSession: 'Lock the local grant signer and revoke its on-chain permission after review.',
  };
  const purpose =
    context.ownerUnlocked && ownerPurpose[action]
      ? CRITICAL_ACTIONS.has(action)
        ? action === 'withdraw'
          ? `A matching scoped transfer uses its approved JubJub grant without a passkey. Owner transfers require fresh passkey approval before the JubJub signature. ${ownerPurpose[action]}`
          : `Require fresh passkey approval before this critical action uses the authenticated JubJub owner. ${ownerPurpose[action]}`
        : `Use the authenticated JubJub owner with no new passkey request. ${ownerPurpose[action]}`
      : context.routineUnlocked && (action === 'holdings' || action === 'wallet')
        ? action === 'holdings'
          ? 'Use the account’s explicitly unlocked reader keys to read and verify private holdings. This action uses no new passkey request and grants no spending permission.'
          : 'Use the explicitly unlocked keys to connect the separate built-in Midnight wallet. This action uses no new passkey request and grants no ACC spending permission.'
        : PURPOSES[action];
  if (!purpose) return true;
  active = {
    action,
    context,
    purpose,
    id: crypto.randomUUID(),
    requests: 0,
    signatures: 0,
    reviewed: false,
    retirementApproved: false,
  };
  traceOperation('consent.prepared', { action, flowId: active.id, networkId: context.network });
  return true;
}

function operationDetails(consent: ActiveConsent): string {
  if (consent.exact) return exactReviewText(consent.exact.intent);
  const { action, context, purpose } = consent;
  const accountReview = reviewedAccount(action, context);
  const routine =
    action === 'unlockOwner' ||
    action === 'unlockRoutine' ||
    action === 'open' ||
    action === 'openAt' ||
    (!!context.account &&
      !context.routineUnlocked &&
      (action === 'holdings' || action === 'wallet'));
  return (
    `Network: ${context.network}\nOwner arm: ${context.ownerUnlocked ? 'authenticated JubJub owner' : context.arm}\nACC: ${accountReview.label}\n\n${purpose}` +
    (routine
      ? `\n\nKeep the reviewed local keys in this tab for ${context.routineMinutes ?? 15} minutes. Lock, hidden tab, page exit or expiry clears them.`
      : '')
  );
}

function checkActive(consent: ActiveConsent): void {
  if (active !== consent)
    throw new PassportConnectorError('UserCancelled', 'The operation approval ended.');
  consent.context.check?.();
  consent.exact?.check();
}

async function reviewCeremony(consent: ActiveConsent, ceremonyId: string): Promise<boolean> {
  const dialog = document.getElementById('ceremony-dialog') as HTMLDialogElement;
  const proceed = document.getElementById('ceremony-continue') as HTMLButtonElement;
  const cancel = document.getElementById('ceremony-cancel') as HTMLButtonElement;
  const retirement = document.getElementById('consent-retirement') as HTMLElement;
  const acknowledgement = document.getElementById('consent-retirement-ack') as HTMLInputElement;
  const needsAcknowledgement = consent.action === 'create' && !consent.retirementApproved;
  retirement.hidden = !needsAcknowledgement;
  acknowledgement.checked = false;
  proceed.disabled = needsAcknowledgement;
  dialog.dataset.ceremonyId = ceremonyId;
  return new Promise<boolean>((resolve) => {
    const pending = { cancel: () => dialog.close('declined') };
    const changed = () => {
      proceed.disabled = needsAcknowledgement && !acknowledgement.checked;
    };
    const close = () => {
      acknowledgement.removeEventListener('change', changed);
      dialog.removeEventListener('close', close);
      proceed.removeEventListener('click', yes);
      cancel.removeEventListener('click', no);
      if (pendingCeremony === pending) pendingCeremony = undefined;
      const approved =
        dialog.returnValue === 'approved' &&
        active === consent &&
        (!needsAcknowledgement || acknowledgement.checked);
      if (approved && needsAcknowledgement) consent.retirementApproved = true;
      resolve(approved);
    };
    const yes = () => {
      if (!proceed.disabled) dialog.close('approved');
    };
    const no = () => dialog.close('declined');
    pendingCeremony = pending;
    acknowledgement.addEventListener('change', changed);
    dialog.addEventListener('close', close);
    proceed.addEventListener('click', yes);
    cancel.addEventListener('click', no);
    dialog.returnValue = '';
    dialog.showModal();
    cancel.focus();
  });
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

function checkCeremony(ceremony: Readonly<PasskeyCeremony>): void {
  if (
    ceremony.rpId !== 'localhost' ||
    ceremonyInFlight ||
    !Object.hasOwn(CEREMONIES, ceremony.purpose) ||
    !Number.isInteger(ceremony.attempt) ||
    ceremony.attempt < 1 ||
    ceremony.attempt > 5
  )
    throw new PassportConnectorError('UserCancelled', 'Start an operation before using a passkey.');
}

/** One combined review approves exactly this browser access; later calls and retries review again. */
export async function beforeDemoCeremony(input: Readonly<PasskeyCeremony>): Promise<void> {
  const consent = active;
  if (!consent)
    throw new PassportConnectorError('UserCancelled', 'Start an operation before using a passkey.');
  const ceremony = Object.freeze({ ...input });
  checkCeremony(ceremony);
  ceremonyInFlight = true;
  try {
    checkActive(consent);
    if (consent.exact && ceremony.purpose !== 'derive-keys' && ceremony.purpose !== 'sign')
      return refuseExactReview();
    const request = ++consent.requests;
    if (ceremony.purpose === 'sign' && ceremony.attempt === 1) consent.signatures++;
    const ceremonyId = crypto.randomUUID();
    const setup =
      ceremony.purpose === 'sign' && consent.action === 'create'
        ? `Setup signature ${consent.signatures}: publish a sealed viewing-key entry to the ACC inbox. Reader envelopes and registrations use separate setup transactions.\n\n`
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
    document.getElementById('ceremony-title')!.textContent =
      `Passkey request ${request} · ${FLOWS[consent.action].title}`;
    document.getElementById('ceremony-details')!.textContent =
      operationDetails(consent) +
      '\n\n' +
      setup +
      CEREMONIES[ceremony.purpose] +
      (ceremony.attempt > 1
        ? `\n\nRetry ${ceremony.attempt}: the browser returned an unsupported signing format. Try the passkey again; signed bytes are never rewritten.`
        : '') +
      '\n\nContinue opens your passkey provider. Cancel stops the remaining steps; submitted transactions may still complete.';
    dialog.dataset.ceremonyId = ceremonyId;
    traceOperation('consent.ceremony', {
      action: consent.action,
      flowId: consent.id,
      purpose: ceremony.purpose,
      attempt: ceremony.attempt,
      ceremonyId,
      request,
    });
    Object.assign(dialog.dataset, {
      flowId: consent.id,
      purpose: ceremony.purpose,
      attempt: String(ceremony.attempt),
      rpId: ceremony.rpId,
    });
    const approved = await reviewCeremony(consent, ceremonyId);
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
    checkActive(consent);
    if (!consent.reviewed) {
      consent.reviewed = true;
      const accountReview = reviewedAccount(consent.action, consent.context);
      traceOperation('consent.approved', {
        action: consent.action,
        flowId: consent.id,
        ceremonyId,
        networkId: consent.context.network,
        ...(accountReview.address && { accountAddress: accountReview.address }),
      });
    }
    document.dispatchEvent(new Event('passport:present-ceremony'));
    // The first rAF is before paint; its promise continuation would still be before paint.
    // Cross a second frame so the visible explanation has a rendering opportunity first.
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
    checkActive(consent);
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
    if (consent.exact) consent.exact.approved = true;
  } finally {
    ceremonyInFlight = false;
  }
}
