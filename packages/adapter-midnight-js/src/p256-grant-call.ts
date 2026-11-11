import {
  ContractCall,
  type Bindingish,
  type Proofish,
  type Signaturish,
  type Transaction,
} from '@midnightntwrk/ledger-v9';
import { P256_GRANT_SPEND_CIRCUIT } from '@input-output-hk/mn-passport-protocol';
import { PassportConnectorError } from '@input-output-hk/mn-passport-account/errors';

export function p256GrantCall<S extends Signaturish, P extends Proofish, B extends Bindingish>(
  tx: Transaction<S, P, B>,
  address: string,
): ContractCall<P> {
  const actions = [...(tx.intents?.values() ?? [])].flatMap((intent) => [...intent.actions]);
  const [call] = actions;
  if (actions.length !== 1 || !(call instanceof ContractCall) || call.address !== address)
    return changedCall();
  const name =
    typeof call.entryPoint === 'string'
      ? call.entryPoint
      : new TextDecoder().decode(call.entryPoint);
  if (name !== P256_GRANT_SPEND_CIRCUIT) return changedCall();
  return call;
}

export function checkGrantCommitment(
  call: ContractCall<Proofish>,
  expected: string | undefined,
): void {
  if (!expected || call.communicationCommitment !== expected) changedCall();
}

export function checkGrantPayout(
  call: ContractCall<Proofish>,
  expected: { readonly color: string; readonly amount: string; readonly recipient: string },
): void {
  const payouts = [
    ...(call.guaranteedTranscript?.effects.claimedUnshieldedSpends ?? []),
    ...(call.fallibleTranscript?.effects.claimedUnshieldedSpends ?? []),
  ];
  const [payout] = payouts;
  if (!payout || payouts.length !== 1) return changedCall();
  const [[token, receiver], amount] = payout;
  if (
    token.tag !== 'unshielded' ||
    token.raw !== expected.color ||
    receiver.tag !== 'user' ||
    receiver.address !== expected.recipient ||
    amount.toString() !== expected.amount
  )
    changedCall();
}

export function changedCall(): never {
  throw new PassportConnectorError(
    'MutationUnsettled',
    'The finalized grant call differs from the approved spend.',
    { retryable: false },
  );
}
