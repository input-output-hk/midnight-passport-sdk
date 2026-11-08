import type {
  PassportAccount,
  PassportUnshieldedWithdrawal,
} from '@input-output-hk/mn-passport-protocol';
import type { AuthenticatedJubjubOwner } from '@input-output-hk/mn-passport-keys';
import { stageExactCredentialReview } from './consent.js';

type OwnerLease = Pick<AuthenticatedJubjubOwner, 'context' | 'check'>;
interface WithdrawalReview extends PassportUnshieldedWithdrawal {
  readonly recipientAddress: string;
  readonly balance: string;
  readonly outsideSession: boolean;
}
interface OwnerReviewPorts {
  current(): PassportAccount | undefined;
  primary(): PassportAccount | undefined;
  authenticated(): PassportAccount | undefined;
  ownerSession(primary: PassportAccount): OwnerLease | undefined;
  lease(primary: PassportAccount): (() => void) | undefined;
  check(): void;
  confirm(text: string): boolean;
}

const changed = (): never => {
  throw new Error('The reviewed account or owner session changed. Review the operation again.');
};

/** The facade is not the selected owner object; exact approval must pin its actual signer. */
function captureOwnerReview(ports: OwnerReviewPorts, current: PassportAccount) {
  const primary = ports.primary();
  const authenticated = ports.authenticated();
  if (!primary || ports.current() !== current) return changed();
  const owner = ports.ownerSession(primary);
  const lease = ports.lease(primary);
  const signer = authenticated ?? primary;
  const scheme = signer.scheme;
  if (scheme !== 'p256-webauthn' && scheme !== 'jubjub-schnorr') return changed();
  if (authenticated && (!owner || !lease || scheme !== 'jubjub-schnorr')) return changed();
  const context = {
    account: current.address,
    networkId: current.networkId,
    bindingId: current.bindingId,
    scheme,
    route: authenticated ? ('authenticated-owner' as const) : ('primary' as const),
  };
  const sameContext = (account: PassportAccount) =>
    account.address === context.account &&
    account.networkId === context.networkId &&
    account.bindingId === context.bindingId;
  const check = () => {
    if (
      ports.current() !== current ||
      ports.primary() !== primary ||
      ports.authenticated() !== authenticated ||
      ports.ownerSession(primary) !== owner ||
      !sameContext(current) ||
      !sameContext(primary) ||
      !sameContext(signer) ||
      signer.scheme !== scheme
    )
      return changed();
    if (
      owner &&
      (owner.context.account !== context.account ||
        owner.context.networkId !== context.networkId ||
        owner.context.bindingId !== context.bindingId)
    )
      return changed();
    ports.check();
    lease?.();
    owner?.check();
  };
  check();
  return { context, check };
}

/** Demo-only consent wiring; it neither selects another route nor grants owner authority. */
export function createOwnerReview(ports: OwnerReviewPorts) {
  return {
    stageGrantExportReview(current: PassportAccount, grantId: string): void {
      const { context, check } = captureOwnerReview(ports, current);
      stageExactCredentialReview({ ...context, kind: 'exportGrant', grantId }, check);
    },
    stageOwnerWithdrawalReview(current: PassportAccount, transfer: WithdrawalReview): void {
      const { context, check } = captureOwnerReview(ports, current);
      stageExactCredentialReview({ ...transfer, ...context, kind: 'withdraw' }, check);
    },
    reviewScopedWithdrawal(current: PassportAccount, transfer: WithdrawalReview): boolean {
      if (ports.current() !== current) return changed();
      // A scoped grant has no credential ceremony; preserve an explicit exact transfer decision.
      const approved = ports.confirm(
        `Authorization: scoped JubJub session (no passkey prompt)\n\nWithdraw from Passport ACC?\n\nNetwork: ${current.networkId}\nACC: ${current.address}\nAsset color: ${transfer.color}\nAmount: ${transfer.amount} smallest units\nFresh ACC balance: ${transfer.balance}\nRecipient: ${transfer.recipientAddress.trim()}`,
      );
      if (ports.current() !== current) return changed();
      return approved;
    },
  };
}
