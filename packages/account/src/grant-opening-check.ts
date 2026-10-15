import { sha256 } from '@noble/hashes/sha2.js';
import { fromHex, toHex } from './codec.js';
import { PassportConnectorError } from './errors.js';
import { grantOriginHash, granteePoint, type GrantScopePure } from './grant-scope.js';
import type { StagedJubjubGrant } from './jubjub-grant-issue.js';
import type { LiveGrantCommitment } from './ports/index.js';

const EMPTY = new Uint8Array(32);
const same = (a: Uint8Array, b: Uint8Array): boolean =>
  a.length === b.length && a.every((value, index) => value === b[index]);
const bytes32 = (value: string): Uint8Array => {
  if (!/^[0-9a-f]{64}$/.test(value))
    throw new PassportConnectorError(
      'GrantScopeInvalid',
      'A staged grant field is not 32-byte hex.',
    );
  return fromHex(value);
};

/** Refuse a stale opening if another issue now occupies its grant id on chain. */
export function verifyStagedGrantCommitment(
  staged: StagedJubjubGrant,
  live: LiveGrantCommitment | undefined,
  pure: Pick<GrantScopePure, 'derive_grant_id_with_jubjub' | 'derive_grant_object_commit'>,
): void {
  if (!live?.active)
    throw new PassportConnectorError('GrantRevoked', 'The staged grant is not active on chain.');
  if (
    live.objectCommit.length !== 32 ||
    live.readPkHash.length !== 32 ||
    live.read !== (staged.scope.read === true)
  )
    throw new PassportConnectorError('GrantScopeInvalid', 'The live grant scope differs.');
  try {
    const grant = staged.bookkeeping;
    const derivedId = pure.derive_grant_id_with_jubjub(
      { bytes: bytes32(staged.account) },
      granteePoint(grant.granteePublicKey),
      grantOriginHash(staged.origin),
      BigInt(grant.slot),
    );
    if (
      grant.object.recipient.kind !== 'any' &&
      grant.object.recipient.kind !== 'user-address' &&
      grant.object.recipient.kind !== 'coin-public-key' &&
      grant.object.recipient.kind !== 'contract-address'
    )
      throw new Error('invalid recipient kind');
    const recipientKind =
      grant.object.recipient.kind === 'any'
        ? 0n
        : grant.object.recipient.kind === 'user-address'
          ? 1n
          : grant.object.recipient.kind === 'coin-public-key'
            ? 2n
            : 3n;
    const recipient =
      grant.object.recipient.kind === 'any' ? EMPTY : bytes32(grant.object.recipient.value);
    if (!/^\d+$/.test(grant.object.maxCoinValue)) throw new Error('invalid coin bound');
    const objectCommit = pure.derive_grant_object_commit(
      bytes32(grant.scopeSalt),
      bytes32(grant.object.color),
      recipientKind,
      recipient,
      BigInt(grant.object.maxCoinValue),
    );
    const readPkHash = grant.readPublicKey ? sha256(bytes32(grant.readPublicKey)) : EMPTY;
    if (
      toHex(derivedId) !== grant.grantId ||
      !same(objectCommit, live.objectCommit) ||
      !same(readPkHash, live.readPkHash)
    )
      throw new Error('staged opening does not match the live grant');
  } catch (cause) {
    throw new PassportConnectorError(
      'GrantScopeInvalid',
      'The staged grant opening does not match its live ACC commitments.',
      { cause },
    );
  }
}
