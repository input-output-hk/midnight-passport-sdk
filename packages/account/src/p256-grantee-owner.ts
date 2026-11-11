import { fromHex } from './codec.js';
import { PassportConnectorError } from './errors.js';
import { JUBJUB_READER_SCAN_LIMIT } from './jubjub-readers.js';
import { equalBytes } from './p256-operation-guards.js';
import { decodeMutationValue, encodeMutationValue } from './mutation-codec.js';
import type { PreparedP256UnshieldedGrant } from './p256-grant-opening.js';
import type { IssueP256GrantPure } from './p256-grant-issue.js';
import type { IssueJubjubGrantPure } from './jubjub-grant-issue.js';
import type { AccountHint, Authoriser, CurvePoint } from './ports/index.js';
import type { AccLedgerView } from './seams.js';

export type P256GranteeOwnerPure = Pick<
  IssueP256GrantPure,
  'derive_device_entry_with_p256' | 'challenge_issue_grant_with_p256'
> &
  Pick<
    IssueJubjubGrantPure,
    'derive_device_entry_with_jubjub' | 'challenge_issue_grant_with_jubjub'
  >;

function notOwner(): never {
  throw new PassportConnectorError(
    'NotAuthorised',
    'The selected owner has no matching active ACC entry.',
  );
}

const samePoint = (a: CurvePoint, b: CurvePoint): boolean => a.x === b.x && a.y === b.y;

export async function signP256GranteeIssue(
  owner: AccountHint,
  authoriser: Authoriser,
  pure: P256GranteeOwnerPure,
  view: AccLedgerView,
  prepared: PreparedP256UnshieldedGrant,
) {
  const selected = { ...(await authoriser.devicePublicKey()) };
  if (authoriser.scheme !== owner.scheme || !samePoint(selected, owner.publicKey))
    return notOwner();
  const account = { bytes: fromHex(owner.address) };
  const id = fromHex(prepared.opening.grantId);
  const salt = fromHex(prepared.opening.scopeSalt);
  const args = [id, ...prepared.scopeArgs, salt];
  const nonce = view.authNonce;
  const signerArgs = decodeMutationValue(encodeMutationValue(args));
  if (!Array.isArray(signerArgs)) return notOwner();

  if (owner.scheme === 'p256-webauthn') {
    const { policy, credentialId } = owner;
    if (!policy || !credentialId || !authoriser.deviceBinding) return notOwner();
    const binding = await authoriser.deviceBinding();
    if (
      !equalBytes(credentialId, binding.credentialId) ||
      !equalBytes(policy.origin, binding.policy.origin) ||
      !equalBytes(policy.rp_id_hash, binding.policy.rp_id_hash)
    )
      return notOwner();
    const pk = { x: selected.x, y: selected.y, identity: false as const };
    const counter = findCounter(
      view,
      (value) => pure.derive_device_entry_with_p256(account, pk, policy, view.deviceEpoch, value),
      64n,
    );
    const circuit = 'issue_grant_with_p256';
    const signed = await authoriser.authorise({
      account: owner.address,
      circuit,
      args: signerArgs,
      witnessValues: [],
      authNonce: nonce,
      useCounter: counter,
      credentialId: Uint8Array.from(credentialId),
      challenge: pure.challenge_issue_grant_with_p256(account, pk, id, prepared.scopeDigest, nonce),
    });
    if (
      signed.scheme !== owner.scheme ||
      !samePoint(signed.pk, pk) ||
      signed.useCounter !== counter
    )
      return notOwner();
    return {
      circuit,
      args: [
        ...args,
        {
          pk,
          policy,
          use_counter: counter,
          authenticator_data: Uint8Array.from(signed.authenticatorData),
          sig: { ...signed.sig },
        },
      ],
      nextUseCounter: counter + 1n,
    };
  }

  if (owner.scheme !== 'jubjub-schnorr') return notOwner();
  const counter = findCounter(view, (value) =>
    pure.derive_device_entry_with_jubjub(account, selected, view.deviceEpoch, value),
  );
  const circuit = 'issue_grant_with_jubjub';
  const signed = await authoriser.authorise({
    account: owner.address,
    circuit,
    args: signerArgs,
    witnessValues: [],
    authNonce: nonce,
    useCounter: counter,
    challenge: (r, grind) =>
      pure.challenge_issue_grant_with_jubjub(
        account,
        r,
        selected,
        id,
        prepared.scopeDigest,
        nonce,
        grind,
      ),
  });
  if (
    signed.scheme !== owner.scheme ||
    !samePoint(signed.pk, selected) ||
    signed.useCounter !== counter
  )
    return notOwner();
  return {
    circuit,
    args: [...args, { ...selected }, counter, { ...signed.sigR }, signed.sigS, signed.grindNonce],
    nextUseCounter: counter + 1n,
  };
}

function findCounter(
  view: AccLedgerView,
  entry: (counter: bigint) => Uint8Array,
  limit = JUBJUB_READER_SCAN_LIMIT,
): bigint {
  for (let counter = 0n; counter < limit; counter++) {
    if (view.hasEntry(entry(counter))) return counter;
  }
  return notOwner();
}
