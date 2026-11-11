export interface ClaimScope {
  readonly networkId: 'undeployed';
  readonly registryAddress: string;
  readonly accountAddress: string;
  readonly name: string;
  readonly ownerCommitment: string;
}

export interface ClaimReceipt extends ClaimScope {
  readonly transaction: {
    readonly identifiers: readonly string[];
    readonly sha256: string;
  };
}

export const claimHex = (value: unknown): value is string =>
  typeof value === 'string' && value.length === 64 && /^[0-9a-f]+$/.test(value);

export const claimName = (value: unknown): value is string =>
  typeof value === 'string' &&
  value.endsWith('.night') &&
  /^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?\.night$/.test(value);

export function normalizeClaimName(input: string): string | undefined {
  const trimmed = input.trim();
  if (!/^[A-Za-z0-9.-]+$/.test(trimmed)) return undefined;
  const name = trimmed.toLowerCase();
  return claimName(name) ? name : undefined;
}

export const claimReceiptLimit = 8192;

// Ledger 9 identifiers are 33-byte hex values, separate from 32-byte transaction hashes.
const transactionIdentifier = (value: unknown): value is string =>
  typeof value === 'string' && value.length === 66 && /^[0-9a-f]+$/.test(value);

export function claimReceipt(value: unknown): ClaimReceipt {
  const invalid = () => new Error('Invalid standalone claim receipt.');
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid();
  const { networkId, registryAddress, accountAddress, name, ownerCommitment, transaction } =
    value as Record<string, unknown>;
  if (
    networkId !== 'undeployed' ||
    !claimHex(registryAddress) ||
    !claimHex(accountAddress) ||
    !claimName(name) ||
    !claimHex(ownerCommitment) ||
    !transaction ||
    typeof transaction !== 'object'
  )
    throw invalid();
  const { identifiers, sha256 } = transaction as Record<string, unknown>;
  if (
    !claimHex(sha256) ||
    !Array.isArray(identifiers) ||
    !identifiers.length ||
    identifiers.length > 64 ||
    !identifiers.every(transactionIdentifier) ||
    new Set(identifiers).size !== identifiers.length
  )
    throw invalid();
  return {
    networkId,
    registryAddress,
    accountAddress,
    name,
    ownerCommitment,
    transaction: { identifiers: [...identifiers], sha256 },
  };
}

export async function claimDigest(value: Uint8Array): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(value)));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export interface ClaimRecovery {
  readonly registryAddress: string;
  availability(
    name: string,
    accountAddress: string,
  ): Promise<'available' | 'taken' | 'unsupported'>;
  dispatch?(receipt: ClaimReceipt): Promise<void>;
  check(receipt: ClaimReceipt): Promise<'pending' | 'conflict' | 'registered'>;
}
