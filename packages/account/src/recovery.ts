/** Read-only admission for an independently qualified total-loss recovery profile. */
import { z } from 'zod';
import { PassportConnectorError } from './errors.js';
import { mutationDigest } from './mutation-codec.js';
import { AccountContextSchema, BindingIdSchema, NetworkIdSchema } from './validation.js';

const hex32 = z.string().regex(/^[0-9a-f]{64}$/);
const zero = '00'.repeat(32);
const uint64 = z
  .bigint()
  .min(0n)
  .max((1n << 64n) - 1n);
const uint32 = uint64.max((1n << 32n) - 1n);
const positiveSeconds = uint64.min(1n);
const verifierRoster = z
  .array(z.tuple([z.string().regex(/^[a-zA-Z_][a-zA-Z0-9_]{0,127}$/), hex32]))
  .min(1)
  .max(255);

/** Match the circuit-to-key assignment, not just the unordered set of verifier hashes. */
export function recoveryVerifierRosterDigest(
  entries: readonly (readonly [circuit: string, verifierSha256: string])[],
): string {
  const sorted = verifierRoster
    .parse(entries)
    .sort(([left], [right]) => (left === right ? 0 : left < right ? -1 : 1));
  if (new Set(sorted.map(([circuit]) => circuit)).size !== sorted.length)
    throw new PassportConnectorError('BindingUnsupported', 'Duplicate recovery verifier circuit.');
  return mutationDigest(sorted);
}

const profileSchema = z
  .strictObject({
    networkId: NetworkIdSchema,
    bindingId: BindingIdSchema,
    verifierRosterSha256: hex32,
    recoveryVersion: uint64.min(1n),
    maxPublicShares: z.number().int().min(1).max(255),
    minimumVetoSeconds: positiveSeconds,
    blockTimeToleranceSeconds: uint64,
  })
  .readonly();

const pendingSchema = z
  .strictObject({
    successorEntry: hex32.refine((entry) => entry !== zero),
    notBeforeSeconds: positiveSeconds,
  })
  .readonly();

const observationSchema = AccountContextSchema.unwrap()
  .strict()
  .extend({
    verifierRosterSha256: hex32,
    recoveryVersion: uint64,
    blockHash: hex32,
    blockTimeSeconds: positiveSeconds,
    deviceEpoch: uint32,
    authorizationNonce: uint64,
    sessionId: hex32,
    viewingPublicKey: hex32,
    publicShareCount: z.number().int().min(0).max(255),
    vetoSeconds: uint64,
    pending: pendingSchema.optional(),
  })
  .readonly();

export type RecoveryTarget = z.input<typeof AccountContextSchema>;
export type RecoveryBindingProfile = z.input<typeof profileSchema>;
export type RecoveryObservation = z.input<typeof observationSchema>;

export interface RecoveryObservationSource {
  /**
   * Read ledger fields and the circuit-to-verifier roster at the latest verified finalized block.
   * Derive the roster digest from deployed verifier bytes and their circuit names.
   */
  readFinalizedRecovery(
    target: z.output<typeof AccountContextSchema>,
  ): Promise<RecoveryObservation | undefined>;
}

export interface RecoverySessionReview {
  readonly phase:
    'no-guardian-session' | 'guardian-session-present' | 'pending-veto' | 'pending-veto-elapsed';
  readonly observation: z.output<typeof observationSchema>;
}

function recoveryPhase(
  state: z.output<typeof observationSchema>,
  tolerance: bigint,
): RecoverySessionReview['phase'] {
  if (state.pending)
    return state.blockTimeSeconds >= state.pending.notBeforeSeconds + tolerance
      ? 'pending-veto-elapsed'
      : 'pending-veto';
  return state.publicShareCount ? 'guardian-session-present' : 'no-guardian-session';
}

/**
 * Review public state only. The host supplies a separately qualified profile and finalized
 * reader. This does not authorize share collection, signing, submission or finalisation.
 */
export async function reviewRecoverySession(
  target: RecoveryTarget,
  profile: RecoveryBindingProfile,
  source: RecoveryObservationSource,
): Promise<RecoverySessionReview> {
  const requested = AccountContextSchema.parse(target);
  const pin = profileSchema.parse(profile);
  if (pin.networkId !== requested.networkId)
    throw new PassportConnectorError('NetworkMismatch', 'Recovery profile is for another network.');
  if (
    pin.bindingId !== requested.bindingId ||
    requested.bindingId === 'acc-s3r1.1' ||
    pin.minimumVetoSeconds <= pin.blockTimeToleranceSeconds
  )
    throw new PassportConnectorError(
      'BindingUnsupported',
      'No qualified recovery profile for this binding.',
    );
  const value = await source.readFinalizedRecovery(requested);
  if (value === undefined)
    throw new PassportConnectorError(
      'AccountNotFound',
      'No finalized account recovery state was found.',
    );
  const state = observationSchema.parse(value);
  if (state.networkId !== requested.networkId)
    throw new PassportConnectorError(
      'NetworkMismatch',
      'Recovery observation is for another network.',
    );
  if (state.account !== requested.account)
    throw new PassportConnectorError(
      'AccountNotFound',
      'Recovery observation is for another account.',
    );
  if (
    state.bindingId !== pin.bindingId ||
    state.verifierRosterSha256 !== pin.verifierRosterSha256 ||
    state.recoveryVersion !== pin.recoveryVersion ||
    state.publicShareCount > pin.maxPublicShares ||
    state.vetoSeconds < pin.minimumVetoSeconds ||
    (state.publicShareCount > 0 && state.sessionId === zero)
  )
    throw new PassportConnectorError(
      'BindingUnsupported',
      'Recovery observation does not match the profile.',
    );
  return Object.freeze({
    phase: recoveryPhase(state, pin.blockTimeToleranceSeconds),
    observation: state,
  });
}

export {
  createRecoveryGuardianCollector,
  type AuthenticatedGuardianShare,
  type GuardianSession,
  type GuardianShareRequest,
  type IndexedRecoveryShare,
  type RecoveryGuardianTransport,
} from './recovery-guardians.js';
export {
  stageRecoveryViewingKey,
  type RecoveryViewingCustody,
  type RecoveryViewingTarget,
} from './recovery-viewing.js';
