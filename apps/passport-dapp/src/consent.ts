import { PassportConnectorError } from '@input-output-hk/mn-passport-account';
import type { PasskeyCeremony } from '@input-output-hk/mn-passport-adapter-webauthn';
import { FLOWS, type ActionId } from './flows.js';
import { traceOperation } from './operation-trace.js';

const PURPOSES: Partial<Record<ActionId, string>> = {
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
    'Review the exact network, ACC, recipient, asset and base-unit amount before signing an unshielded withdrawal. Reader-key derivation and P-256 signing are separate purposes. A timeout after submission does not mean no transfer.',
};

const CEREMONIES: Record<PasskeyCeremony['purpose'], string> = {
  create: 'Create a new passkey for this operation.',
  'verify-created': 'Verify the new passkey’s signing format before deployment or enrollment.',
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
  { readonly action: ActionId; readonly id: string; readonly context: ConsentContext } | undefined;

/** The demo permits one operation at a time; approval ends with that action, including failure. */
export async function reviewDemoAction(
  action: ActionId,
  context: ConsentContext,
): Promise<boolean> {
  active = undefined;
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
  if (approved) active = { action, id, context: Object.freeze({ ...context }) };
  return approved;
}

export function finishDemoConsent(): void {
  active = undefined;
}

/** All actual browser accesses, including profile retries, pass through this purpose display. */
export async function beforeDemoCeremony(ceremony: Readonly<PasskeyCeremony>): Promise<void> {
  const consent = active;
  if (!consent || ceremony.rpId !== 'localhost')
    throw new PassportConnectorError(
      'UserCancelled',
      'Approve the demo operation before using a passkey.',
    );
  const text = `${FLOWS[consent.action].title}: ${CEREMONIES[ceremony.purpose]} Attempt ${ceremony.attempt}.`;
  document.getElementById('ceremony-purpose')!.textContent = text;
  traceOperation('consent.ceremony', {
    action: consent.action,
    flowId: consent.id,
    purpose: ceremony.purpose,
    attempt: ceremony.attempt,
  });
  // Give the application explanation a paint before native UI can cover the page.
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  if (active !== consent)
    throw new PassportConnectorError('UserCancelled', 'The operation approval ended.');
}
