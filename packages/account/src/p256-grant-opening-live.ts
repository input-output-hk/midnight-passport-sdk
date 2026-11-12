import { PassportConnectorError } from './errors.js';
import { grantScopeInvalid } from './grant-issue-fields.js';
import {
  p256GrantOpeningSchema,
  type P256GrantOpeningPure,
  type P256UnshieldedGrantOpening,
} from './p256-grant-opening.js';
import { checkP256GrantOpening, matchesP256Scope } from './p256-grant-spend-check.js';
import type { P256GrantSpendSource } from './ports/p256-grant-spend.js';
import { NetworkIdSchema } from './validation.js';

/** Verify the holder's opening against a live, network-pinned ACC read. */
export async function verifyLiveP256GrantOpening(
  opening: P256UnshieldedGrantOpening,
  ports: {
    readonly networkId: string;
    readonly source: P256GrantSpendSource;
    readonly pure: Pick<
      P256GrantOpeningPure,
      'derive_grant_id_with_p256' | 'derive_grant_rp_commit' | 'derive_grant_object_commit'
    >;
    readonly nowSeconds?: () => number;
  },
): Promise<P256UnshieldedGrantOpening> {
  const { networkId, source, pure } = ports;
  const nowSeconds = ports.nowSeconds ?? (() => Math.floor(Date.now() / 1000));
  const checkPins = () => {
    if (!NetworkIdSchema.safeParse(networkId).success || source.networkId !== networkId)
      throw new PassportConnectorError(
        'NetworkMismatch',
        'Grant verification requires one pinned network.',
      );
    if (source.bindingId !== 'acc-s3r1.1')
      throw new PassportConnectorError(
        'BindingUnsupported',
        'Grant verification requires acc-s3r1.1.',
      );
  };
  checkPins();
  const parsed = p256GrantOpeningSchema.safeParse(opening);
  if (!parsed.success) return grantScopeInvalid('malformed holder opening');
  const approved = parsed.data;
  const commitments = checkP256GrantOpening(approved, pure);
  const live = await source.readP256GrantSpendContext(approved.scope.account, approved.grantId);
  checkPins();
  if (!live) throw new PassportConnectorError('GrantNotFound', 'The grant is absent on chain.');
  if (
    !live.active ||
    live.grantEpoch !== live.deviceEpoch ||
    live.grantGeneration !== live.generation
  )
    throw new PassportConnectorError(
      'GrantRevoked',
      'The grant is inactive in the current ACC epoch.',
    );
  const now = nowSeconds();
  if (
    !Number.isSafeInteger(now) ||
    now < 0 ||
    (live.expiresAt !== 0n && live.expiresAt <= BigInt(now))
  )
    return grantScopeInvalid('grant has expired or the current time is invalid');
  if (!matchesP256Scope(live, commitments))
    return grantScopeInvalid('opening differs from the live grant');
  return approved;
}
