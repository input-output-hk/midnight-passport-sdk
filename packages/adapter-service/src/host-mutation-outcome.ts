import { PassportConnectorError } from '@input-output-hk/mn-passport-account/errors';
import type { MutationPins } from '@input-output-hk/mn-passport-account/ports';

export interface MutationIdentity {
  readonly pins: MutationPins;
  readonly requestId: string;
  readonly intentSha256: string;
  readonly kind: 'call' | 'deploy';
}
export type RemoteOutcome =
  | { kind: 'unknown' }
  | {
      kind: 'confirmed';
      digest: string;
      result:
        | { txHash: string; submissionId: string; blockHeight?: number }
        | { address: string; txIds: readonly string[] };
    };
export const mutationFailure = (): never => {
  throw new PassportConnectorError(
    'MutationUnsettled',
    'Host submission is unsettled. Reconcile the same mutation ID; do not create a replacement.',
  );
};
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const hex = (value: unknown): value is string =>
  typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
const watch = (value: unknown): value is string =>
  typeof value === 'string' && /^(?:[0-9a-f]{64}|[0-9a-f]{66})$/.test(value);

// validateHostRecord permits 64 steps; each outcome watch is at most 66 ASCII bytes.
// Largest compact canonical reply: 4610 bytes. 8192 admits formatting headroom.
export const MUTATION_OUTCOME_BYTES_LIMIT = 8192;
export const MUTATION_OUTCOME_STEPS_LIMIT = 64;

export function mutationIdentity(
  pins: MutationPins,
  requestId: string,
  intentSha256: string,
  kind: 'call' | 'deploy',
): MutationIdentity {
  if (
    typeof requestId !== 'string' ||
    !/^[0-9a-f]{32}:(0|[1-9][0-9]{0,2})$/.test(requestId) ||
    Number(requestId.split(':')[1]) > 511 ||
    !hex(intentSha256) ||
    (kind !== 'call' && kind !== 'deploy')
  )
    return mutationFailure();
  return { pins, requestId, intentSha256, kind };
}
function deployResult(value: Record<string, unknown>): { address: string; txIds: string[] } {
  const { address, txIds } = value;
  if (
    !hex(address) ||
    !Array.isArray(txIds) ||
    txIds.length < 1 ||
    txIds.length > MUTATION_OUTCOME_STEPS_LIMIT
  )
    return mutationFailure();
  const length = txIds.length,
    owned: string[] = [];
  for (let index = 0; index < length; index++) {
    const id: unknown = txIds[index];
    if (!watch(id)) return mutationFailure();
    owned.push(id);
  }
  return { address, txIds: owned };
}
function callResult(value: Record<string, unknown>): {
  txHash: string;
  submissionId: string;
  blockHeight?: number;
} {
  const { txHash, submissionId, blockHeight } = value;
  if (
    !hex(txHash) ||
    !watch(submissionId) ||
    (blockHeight !== undefined &&
      (typeof blockHeight !== 'number' || !Number.isSafeInteger(blockHeight) || blockHeight < 0))
  )
    return mutationFailure();
  return { txHash, submissionId, ...(blockHeight !== undefined && { blockHeight }) };
}
export function decodeMutationOutcome(value: unknown, expected: MutationIdentity): RemoteOutcome {
  if (!isRecord(value)) return mutationFailure();
  const { kind, digest, result } = value;
  if (kind === 'unknown') return { kind };
  if (kind !== 'confirmed' || digest !== expected.intentSha256 || !isRecord(result))
    return mutationFailure();
  return {
    kind,
    digest,
    result: expected.kind === 'deploy' ? deployResult(result) : callResult(result),
  };
}
