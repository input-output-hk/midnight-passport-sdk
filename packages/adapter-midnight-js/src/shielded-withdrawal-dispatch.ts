import { PassportConnectorError } from '@input-output-hk/mn-passport-account/errors';
import type {
  CallRequest,
  QualifiedShieldedCoin,
  ShieldedWithdrawalJournal,
  ShieldedWithdrawalReservation,
} from '@input-output-hk/mn-passport-account/ports';
import {
  Transaction,
  type Bindingish,
  type FinalizedTransaction,
  type Proof,
  type Proofish,
  type SignatureEnabled,
  type Signaturish,
  type Binding,
  type Effects,
  type ZswapOffer,
} from '@midnightntwrk/ledger-v9';
import { singleContractCall } from './single-contract-call.js';

const MAX_FINALIZED_BYTES = 8 * 1024 * 1024;

function changedCall(): never {
  throw new PassportConnectorError(
    'MutationUnsettled',
    'The shielded withdrawal differs from the original authorized call or is already staged.',
    { retryable: false },
  );
}

function rejectSharedBuffers(value: unknown, depth = 0): void {
  if (typeof SharedArrayBuffer === 'undefined') return;
  if (depth > 32) return changedCall();
  if (value instanceof SharedArrayBuffer) return changedCall();
  if (ArrayBuffer.isView(value)) {
    if (value.buffer instanceof SharedArrayBuffer) return changedCall();
    return;
  }
  if (value !== null && typeof value === 'object') {
    for (const item of Object.values(value)) rejectSharedBuffers(item, depth + 1);
  }
}

/** Admit the exact signed arguments and private witness before building a Ledger 9 call. */
export async function prepareShieldedWithdrawalDispatch(
  requestId: string,
  request: Pick<CallRequest, 'address' | 'circuit' | 'args' | 'heldCoin'>,
  pins: { readonly networkId: string; readonly bindingId: string },
  journal: ShieldedWithdrawalJournal,
): Promise<{
  readonly args: readonly unknown[];
  readonly heldCoin: QualifiedShieldedCoin;
  readonly reservation: ShieldedWithdrawalReservation;
}> {
  const { address, circuit } = request;
  const { networkId, bindingId } = pins;
  const { args, heldCoin } = structuredClone({ args: request.args, heldCoin: request.heldCoin });
  rejectSharedBuffers(args);
  rejectSharedBuffers(heldCoin);
  const row = await journal.read(requestId);
  if (!row || row.dispatch || !heldCoin) return changedCall();
  const { heldCoinSha256 } = row.reservation;
  if (!heldCoinSha256) return changedCall();
  const reservation = Object.freeze({ ...row.reservation, heldCoinSha256 });
  if (
    reservation.requestId.toLowerCase() !== requestId.toLowerCase() ||
    reservation.networkId !== networkId ||
    reservation.bindingId !== bindingId ||
    reservation.account !== address ||
    reservation.circuit !== circuit ||
    !journal.matchesInvocation(reservation, args, heldCoin)
  )
    return changedCall();
  return { args, heldCoin, reservation };
}

function checkOffer<P extends Proofish>(
  tx: Transaction<Signaturish, P, Bindingish>,
  { account, inputNullifier, payoutCommitment, changeCommitment }: ShieldedWithdrawalReservation,
): void {
  const offers = [...(tx.fallibleOffer?.values() ?? [])];
  const guaranteed = tx.guaranteedOffer;
  if (guaranteed) offers.push(guaranteed);
  const matchesInput = (input: { contractAddress?: string | undefined; nullifier: string }) =>
    input.contractAddress === account || input.nullifier === inputNullifier;
  const matchesOutput = (output: { contractAddress?: string | undefined; commitment: string }) =>
    output.contractAddress === account ||
    output.commitment === payoutCommitment ||
    output.commitment === changeCommitment;
  const inputs = offers.flatMap((offer) => offer.inputs.filter(matchesInput));
  const outputs = offers.flatMap((offer) => offer.outputs.filter(matchesOutput));
  const transient = offers.some((offer) =>
    offer.transients.some((coin) => matchesInput(coin) || matchesOutput(coin)),
  );
  if (
    transient ||
    inputs.length !== 1 ||
    inputs[0]?.contractAddress !== account ||
    inputs[0]?.nullifier !== inputNullifier ||
    outputs.length !== 2 ||
    !outputs.some(
      (output) => output.commitment === changeCommitment && output.contractAddress === account,
    ) ||
    !outputs.some(
      (output) => output.commitment === payoutCommitment && output.contractAddress === undefined,
    )
  )
    changedCall();
}

function checkPhase<P extends Proofish>(
  effects: Effects | undefined,
  offer: ZswapOffer<P> | undefined,
) {
  if (!effects) return;
  if (
    effects.claimedNullifiers.some(
      (nullifier) => !offer?.inputs.some((input) => input.nullifier === nullifier),
    ) ||
    [...effects.claimedShieldedSpends, ...effects.claimedShieldedReceives].some(
      (commitment) => !offer?.outputs.some((output) => output.commitment === commitment),
    )
  )
    changedCall();
}

/** Inspect the same owner call and shielded effects at proving and wallet boundaries. */
export function verifyShieldedWithdrawalCall<
  S extends Signaturish,
  P extends Proofish,
  B extends Bindingish,
>(
  tx: Transaction<S, P, B>,
  reservation: ShieldedWithdrawalReservation,
  expectedCommitment?: string,
): string {
  const { account, circuit, inputNullifier, payoutCommitment, changeCommitment } = reservation;
  const target = singleContractCall(tx, account, circuit);
  if (!target?.call.communicationCommitment) return changedCall();
  const { call, segment } = target;
  if (expectedCommitment !== undefined && call.communicationCommitment !== expectedCommitment)
    return changedCall();

  const effects = [call.guaranteedTranscript, call.fallibleTranscript].flatMap((transcript) =>
    transcript ? [transcript.effects] : [],
  );
  const inputs = effects.flatMap((effect) => effect.claimedNullifiers);
  const spends = effects.flatMap((effect) => effect.claimedShieldedSpends);
  const receives = effects.flatMap((effect) => effect.claimedShieldedReceives);
  if (
    inputs.length !== 1 ||
    inputs[0] !== inputNullifier ||
    spends.length !== 2 ||
    !spends.includes(payoutCommitment) ||
    !spends.includes(changeCommitment) ||
    receives.length !== 1 ||
    receives[0] !== changeCommitment
  )
    return changedCall();
  checkOffer(tx, reservation);
  checkPhase(call.guaranteedTranscript?.effects, tx.guaranteedOffer);
  checkPhase(call.fallibleTranscript?.effects, tx.fallibleOffer?.get(segment));
  return call.communicationCommitment;
}

/** Return the verified finalized bytes only to the caller that won the durable dispatch CAS. */
export async function stageShieldedWithdrawalDispatch(
  tx: FinalizedTransaction,
  reservation: ShieldedWithdrawalReservation,
  expectedCommitment: string,
  journal: ShieldedWithdrawalJournal,
  signal?: CallRequest['signal'],
): Promise<Uint8Array> {
  if (!expectedCommitment || signal?.aborted) return changedCall();
  const bytes = Uint8Array.from(tx.serialize());
  if (!bytes.length || bytes.length > MAX_FINALIZED_BYTES) return changedCall();
  let serialized: FinalizedTransaction;
  try {
    serialized = Transaction.deserialize<SignatureEnabled, Proof, Binding>(
      'signature',
      'proof',
      'binding',
      bytes,
    );
  } catch {
    return changedCall();
  }
  const callCommitment = verifyShieldedWithdrawalCall(serialized, reservation, expectedCommitment);
  const txHash = serialized.transactionHash();
  const identifiers = [...serialized.identifiers()];
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  const bytesSha256 = Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('');
  if (
    signal?.aborted ||
    !(await journal.stageDispatch(reservation, {
      identity: { txHash, bytesSha256, identifiers },
      callCommitment,
    })) ||
    signal?.aborted
  )
    return changedCall();
  return bytes;
}
