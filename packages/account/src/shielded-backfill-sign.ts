import { fromHex } from './codec.js';
import { PassportConnectorError } from './errors.js';
import { JUBJUB_READER_SCAN_LIMIT } from './jubjub-readers.js';
import { p256 } from './p256-device.js';
import { equalBytes } from './p256-operation-guards.js';
import type { AccountHint, AccLedgerView, Authoriser, CurvePoint } from './ports/index.js';
import type { AccPureCircuits, JubjubPureCircuits } from './seams.js';

export type ShieldedBackfillPure = Pick<
  AccPureCircuits,
  'derive_device_entry_with_p256' | 'challenge_append_inbox_with_p256'
> &
  Pick<
    JubjubPureCircuits,
    'derive_device_entry_with_jubjub' | 'challenge_append_inbox_with_jubjub'
  >;

function notOwner(): never {
  throw new PassportConnectorError('NotAuthorised', 'The selected key is not an active ACC owner.');
}

const samePoint = (a: CurvePoint, b: CurvePoint) => a.x === b.x && a.y === b.y;

function findCounter(
  view: AccLedgerView,
  derive: (counter: bigint) => Uint8Array,
  limit: bigint,
): bigint {
  for (let counter = 0n; counter < limit; counter++)
    if (view.hasEntry(derive(counter))) return counter;
  return notOwner();
}

export async function signShieldedBackfill(
  owner: AccountHint,
  authoriser: Authoriser,
  pure: ShieldedBackfillPure,
  view: AccLedgerView,
  envelope: string,
) {
  const selected = { ...(await authoriser.devicePublicKey()) };
  if (
    owner.status !== 'active' ||
    authoriser.scheme !== owner.scheme ||
    !samePoint(selected, owner.publicKey)
  )
    return notOwner();
  const self = { bytes: fromHex(owner.address) };
  const nonce = view.authNonce;
  const entry = () => fromHex(envelope);

  if (owner.scheme === 'p256-webauthn') {
    const { credentialId, policy } = owner;
    const challenge = pure.challenge_append_inbox_with_p256;
    if (!credentialId || !policy || !authoriser.deviceBinding || !challenge) return notOwner();
    const binding = await authoriser.deviceBinding();
    if (
      !equalBytes(binding.credentialId, credentialId) ||
      !equalBytes(binding.policy.origin, policy.origin) ||
      !equalBytes(binding.policy.rp_id_hash, policy.rp_id_hash)
    )
      return notOwner();
    const pk = p256(selected);
    const counter = findCounter(
      view,
      (value) => pure.derive_device_entry_with_p256(self, pk, policy, view.deviceEpoch, value),
      64n,
    );
    const circuit = 'append_inbox_with_p256' as const;
    const signed = await authoriser.authorise({
      account: owner.address,
      circuit,
      args: [entry()],
      witnessValues: [],
      authNonce: nonce,
      useCounter: counter,
      credentialId: Uint8Array.from(credentialId),
      challenge: challenge(self, pk, entry(), nonce),
    });
    if (
      signed.scheme !== owner.scheme ||
      signed.useCounter !== counter ||
      !samePoint(signed.pk, pk)
    )
      return notOwner();
    return {
      circuit,
      args: [
        entry(),
        {
          pk,
          policy,
          use_counter: counter,
          authenticator_data: Uint8Array.from(signed.authenticatorData),
          sig: { ...signed.sig },
        },
      ],
    };
  }

  if (owner.scheme !== 'jubjub-schnorr') return notOwner();
  const counter = findCounter(
    view,
    (value) => pure.derive_device_entry_with_jubjub(self, selected, view.deviceEpoch, value),
    JUBJUB_READER_SCAN_LIMIT,
  );
  const circuit = 'append_inbox_with_jubjub' as const;
  const signed = await authoriser.authorise({
    account: owner.address,
    circuit,
    args: [entry()],
    witnessValues: [],
    authNonce: nonce,
    useCounter: counter,
    challenge: (r, grind) =>
      pure.challenge_append_inbox_with_jubjub(self, r, selected, entry(), nonce, grind),
  });
  if (
    signed.scheme !== owner.scheme ||
    signed.useCounter !== counter ||
    !samePoint(signed.pk, selected)
  )
    return notOwner();
  return {
    circuit,
    args: [entry(), selected, counter, { ...signed.sigR }, signed.sigS, signed.grindNonce],
  };
}
