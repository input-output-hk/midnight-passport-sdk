import type { PassportAccount } from '@input-output-hk/mn-passport-protocol';
import {
  claimDigest,
  claimHex,
  claimName,
  type ClaimReceipt,
  type ClaimScope,
} from './claim-receipt.js';

export type ClaimDestination = Omit<ClaimScope, 'ownerCommitment'>;

export interface ClaimQuote extends ClaimDestination {
  readonly id: string;
  readonly sponsorAddress: string;
  readonly registryPayee: string;
  readonly night: string;
  readonly maximumDust: string;
  readonly expiresAt: number;
}

/** Host composition for the opt-in standalone claim preparation flow. */
export interface ClaimPreparation {
  quote(destination: ClaimDestination): Promise<unknown>;
  /** Owner-side proof generation without a sponsor write. */
  prove(quote: ClaimQuote, account: PassportAccount): Promise<OwnerProvedClaim>;
  prepare(quote: ClaimQuote, original: OwnerProvedClaim): Promise<unknown>;
  findPrepared(quote: ClaimQuote, ownerCommitment: string): Promise<unknown>;
}

export interface OwnerProvedClaim {
  readonly ownerCommitment: string;
  readonly bytes: Uint8Array;
}

export function claimOwnerProof(value: OwnerProvedClaim): OwnerProvedClaim {
  if (
    !claimHex(value.ownerCommitment) ||
    !(value.bytes instanceof Uint8Array) ||
    value.bytes.length === 0 ||
    value.bytes.length > 1024 * 1024
  )
    throw new Error('Invalid owner-proved claim.');
  return { ownerCommitment: value.ownerCommitment, bytes: new Uint8Array(value.bytes) };
}

function positiveAmount(value: unknown): value is string {
  return (
    typeof value === 'string' && /^[1-9][0-9]{0,38}$/.test(value) && BigInt(value) < 1n << 128n
  );
}

export function claimDestination(value: unknown): ClaimDestination {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid claim destination.');
  const { networkId, registryAddress, accountAddress, name } = value as Record<string, unknown>;
  if (
    networkId !== 'undeployed' ||
    !claimHex(registryAddress) ||
    !claimHex(accountAddress) ||
    !claimName(name)
  )
    throw new Error('Invalid claim destination.');
  return { networkId, registryAddress, accountAddress, name };
}

export function claimQuote(value: unknown): ClaimQuote {
  const destination = claimDestination(value);
  const { id, sponsorAddress, registryPayee, night, maximumDust, expiresAt } = value as Record<
    string,
    unknown
  >;
  if (
    !claimHex(id) ||
    !claimHex(sponsorAddress) ||
    !claimHex(registryPayee) ||
    !positiveAmount(night) ||
    !positiveAmount(maximumDust) ||
    typeof expiresAt !== 'number' ||
    !Number.isSafeInteger(expiresAt) ||
    expiresAt <= 0 ||
    expiresAt > 8_640_000_000_000_000
  )
    throw new Error('Invalid claim quote.');
  return Object.freeze({
    ...destination,
    id,
    sponsorAddress,
    registryPayee,
    night,
    maximumDust,
    expiresAt,
  });
}

export function matchesDestination(a: ClaimQuote | ClaimReceipt, b: ClaimDestination): boolean {
  return (
    a.networkId === b.networkId &&
    a.registryAddress === b.registryAddress &&
    a.accountAddress === b.accountAddress &&
    a.name === b.name
  );
}

export function claimQuoteDigest(quote: ClaimQuote): Promise<string> {
  return claimDigest(new TextEncoder().encode(JSON.stringify(claimQuote(quote))));
}
