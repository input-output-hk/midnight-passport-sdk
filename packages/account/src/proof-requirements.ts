import type { AccountPreflightRequest } from './preflight.js';

export type SupportedOwnerScheme = 'p256-webauthn' | 'jubjub-schnorr';
export const ACCOUNT_PREFLIGHT_BINDING = Object.freeze({
  bindingId: 'acc-s3r1.1',
  manifestSha256: '77fb9c17b0d59047456c43115d9a58f5cb99a226ee73b6b974fd724930c3153f',
} as const);

export interface AccountProofRequirements {
  readonly schemaVersion: 1;
  readonly bindingId: 'acc-s3r1.1';
  readonly manifestSha256: string;
  readonly scheme: SupportedOwnerScheme;
  readonly operation: AccountPreflightRequest['operation'];
  /** Set of proving keys needed by any successful branch of this declared operation. */
  readonly proofCircuits: readonly string[];
  /** Includes helpers required by connector guards, even when a branch does not call them. */
  readonly pureHelpers: readonly string[];
  readonly limits: readonly string[];
}

const JUBJUB_BASE = [
  'derive_boot_commitment_with_jubjub',
  'derive_device_entry_with_jubjub',
  'challenge_append_inbox_with_jubjub',
  'challenge_rotate_enc_key_with_jubjub',
  'challenge_remove_device_with_jubjub',
  'challenge_add_device_with_jubjub',
];
const frozenNames = (names: readonly string[]) => Object.freeze([...new Set(names)].sort());

/**
 * Pure planning for the existing sealed-owner profile, not a deployment/initial activation plan.
 * Read issue includes rotation and inbox publication for a mixed live reader roster. Cardinality
 * and live openings remain runtime inputs; this is a key set, never a transaction/prompt budget.
 */
export function getAccountProofRequirements(
  scheme: SupportedOwnerScheme,
  request: AccountPreflightRequest,
): AccountProofRequirements {
  if (scheme !== 'p256-webauthn' && scheme !== 'jubjub-schnorr')
    throw new RangeError('Proof planning supports only the P-256 and JubJub owner arms.');
  const arm = scheme === 'p256-webauthn' ? 'p256' : 'jubjub';
  const proof: string[] = [];
  const pure = scheme === 'jubjub-schnorr' ? [...JUBJUB_BASE] : ['derive_device_entry_with_p256'];
  switch (request.operation) {
    case 'withdraw-unshielded':
    case 'withdraw-shielded': {
      const circuit = `withdraw_${request.operation === 'withdraw-shielded' ? 'shielded' : 'unshielded'}_with_${arm}`;
      proof.push(circuit);
      pure.push(`challenge_${circuit}`);
      break;
    }
    case 'issue-grant':
    case 'recover-pending-grants': {
      pure.push(
        'derive_grant_id_with_jubjub',
        'derive_grant_object_commit',
        'derive_grant_scope_digest',
        `challenge_issue_grant_with_${arm}`,
        `challenge_append_inbox_with_${arm}`,
      );
      proof.push(`append_inbox_with_${arm}`);
      if (request.operation === 'issue-grant') {
        if (typeof request.grantRead !== 'boolean')
          throw new RangeError('Grant issue proof planning requires an explicit read choice.');
        proof.push(`issue_grant_with_${arm}`);
        if (request.grantRead) {
          proof.push(`rotate_enc_key_with_${arm}`);
          pure.push(
            `challenge_rotate_enc_key_with_${arm}`,
            'derive_device_entry_with_p256',
            'derive_device_entry_with_jubjub',
          );
        }
      }
      break;
    }
    default:
      throw new RangeError('This operation is outside the sealed-owner proof profile.');
  }
  return Object.freeze({
    schemaVersion: 1,
    ...ACCOUNT_PREFLIGHT_BINDING,
    scheme,
    operation: request.operation,
    proofCircuits: frozenNames(proof),
    pureHelpers: frozenNames(pure),
    limits: Object.freeze([
      'Existing active sealed account only; creation and pending activation require a different plan.',
      'Advertised keys and method presence do not authenticate artifacts, ownership, grant openings or a provider.',
      'Read-grant issue includes rotation/publication; key count is not a call, prompt or proof-count budget.',
      ...(request.operation === 'withdraw-shielded'
        ? ['Exact-value selected shielded coin only.']
        : []),
    ]),
  });
}
