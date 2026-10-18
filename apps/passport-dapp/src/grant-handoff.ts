import {
  verifyStagedGrantCommitment,
  granteePoint,
  type StagedJubjubGrant,
  type GrantScopePure,
} from '@input-output-hk/mn-passport-account';
import type { UnshieldedGrantContext } from '@input-output-hk/mn-passport-account';
import type { LiveGrantCommitment } from '@input-output-hk/mn-passport-account/ports';

const HEX32 = /^[0-9a-f]{64}$/;
const DECIMAL = /^(0|[1-9][0-9]*)$/;

/** Send directly to the grantee. The scope salt is opening material and is never logged. */
export interface GrantHandoff {
  readonly kind: 'mn-passport-unshielded-grant-v1';
  readonly networkId: string;
  readonly bindingId: 'acc-s3r1.1';
  readonly account: string;
  readonly grantId: string;
  readonly granteePublicKey: string;
  readonly origin: string;
  readonly slot: number;
  readonly scopeSalt: string;
  readonly color: string;
  readonly recipient: string;
  readonly maxCoinValue: string;
  readonly perCallCap: string;
  readonly cap: string;
}

export function grantHandoffFromOpening(
  staged: StagedJubjubGrant,
  live: LiveGrantCommitment | undefined,
  context: UnshieldedGrantContext | undefined,
  networkId: string,
  pure: Pick<GrantScopePure, 'derive_grant_id_with_jubjub' | 'derive_grant_object_commit'>,
): GrantHandoff {
  verifyStagedGrantCommitment(staged, live, pure);
  const { scope, bookkeeping } = staged;
  if (
    !context?.active ||
    !context.withdrawUnshielded ||
    context.perCallCap.toString() !== scope.perCallCap ||
    context.cap.toString() !== scope.cap ||
    context.expiresAt !== 0n ||
    scope.read === true ||
    scope.operations.length !== 1 ||
    scope.operations[0] !== 'withdraw-unshielded' ||
    scope.recipient.kind !== 'user-address' ||
    bookkeeping.object.recipient.kind !== 'user-address' ||
    scope.recipient.value !== bookkeeping.object.recipient.value ||
    scope.color !== bookkeeping.object.color ||
    scope.maxCoinValue !== bookkeeping.object.maxCoinValue
  )
    throw new Error('The staged grant is not a live fixed-recipient unshielded grant.');
  return {
    kind: 'mn-passport-unshielded-grant-v1',
    networkId,
    bindingId: 'acc-s3r1.1',
    account: staged.account,
    grantId: bookkeeping.grantId,
    granteePublicKey: bookkeeping.granteePublicKey,
    origin: staged.origin,
    slot: bookkeeping.slot,
    scopeSalt: bookkeeping.scopeSalt,
    color: scope.color,
    recipient: scope.recipient.value,
    maxCoinValue: scope.maxCoinValue,
    perCallCap: scope.perCallCap,
    cap: scope.cap,
  };
}

/** Strict import: the later live ACC check remains authoritative before every signature. */
export function parseGrantHandoff(text: string, networkId: string): GrantHandoff {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('The grant handoff is not valid JSON.');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
    throw new Error('The grant handoff is invalid.');
  const value = parsed as Record<string, unknown>;
  const fields = [
    'account',
    'bindingId',
    'cap',
    'color',
    'grantId',
    'granteePublicKey',
    'kind',
    'maxCoinValue',
    'networkId',
    'origin',
    'perCallCap',
    'recipient',
    'scopeSalt',
    'slot',
  ];
  if (
    Object.keys(value).sort().join(',') !== fields.sort().join(',') ||
    value.kind !== 'mn-passport-unshielded-grant-v1' ||
    value.networkId !== networkId ||
    value.bindingId !== 'acc-s3r1.1' ||
    typeof value.origin !== 'string' ||
    value.origin !== 'localhost' ||
    !Number.isSafeInteger(value.slot) ||
    (value.slot as number) < 0 ||
    (value.slot as number) > 255 ||
    !['account', 'grantId', 'granteePublicKey', 'scopeSalt', 'color', 'recipient'].every(
      (key) => typeof value[key] === 'string' && HEX32.test(value[key] as string),
    ) ||
    !['maxCoinValue', 'perCallCap', 'cap'].every(
      (key) => typeof value[key] === 'string' && DECIMAL.test(value[key] as string),
    )
  )
    throw new Error('The grant handoff does not match this network or format.');
  granteePoint(value.granteePublicKey as string);
  return value as unknown as GrantHandoff;
}
