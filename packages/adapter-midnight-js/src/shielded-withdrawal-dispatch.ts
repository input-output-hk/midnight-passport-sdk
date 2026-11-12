import { PassportConnectorError } from '@input-output-hk/mn-passport-account/errors';
import type {
  CallRequest,
  FeeSponsor,
  Prover,
  Submitter,
  QualifiedShieldedCoin,
  ShieldedWithdrawalJournal,
  ShieldedWithdrawalReservation,
} from '@input-output-hk/mn-passport-account/ports';
import {
  Transaction,
  type Bindingish,
  type FinalizedTransaction,
  type PreBinding,
  type PreProof,
  type Proof,
  type Proofish,
  type SignatureEnabled,
  type Signaturish,
  type Binding,
  type UnprovenTransaction,
  type Effects,
  type ZswapOffer,
} from '@midnightntwrk/ledger-v9';
import { sameBytes } from './grant-proof-transcript.js';
import { singleContractCall } from './single-contract-call.js';

const MAX_FINALIZED_BYTES = 8 * 1024 * 1024;
const typedArrayPrototype = Object.getPrototypeOf(Uint8Array.prototype);
const byteLengthOf = Object.getOwnPropertyDescriptor(typedArrayPrototype, 'byteLength')?.get;
const bufferOf = Object.getOwnPropertyDescriptor(typedArrayPrototype, 'buffer')?.get;

const toHex = (value: Uint8Array): string =>
  Array.from(value, (byte) => byte.toString(16).padStart(2, '0')).join('');

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
  const bytesSha256 = toHex(digest);
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

export interface StagedShieldedWithdrawalRuntime {
  readonly networkId: string;
  readonly bindingId: string;
  readonly journal: ShieldedWithdrawalJournal;
  readonly prover: Prover;
  readonly wallet: FeeSponsor;
  readonly submitter: Submitter;
  /** Adapt the pinned midnight-js createUnprovenCallTx private.unprovenTx and private.result. */
  readonly build: (
    invocation: Pick<CallRequest, 'address' | 'circuit' | 'args'> & {
      readonly heldCoin: QualifiedShieldedCoin;
    },
  ) => Promise<{
    readonly private: { readonly unprovenTx: UnprovenTransaction; readonly result: unknown };
  }>;
}

function requirePrivateChange(result: unknown, expected: ShieldedWithdrawalReservation['change']) {
  if (
    !result ||
    typeof result !== 'object' ||
    !('is_some' in result) ||
    result.is_some !== true ||
    !('value' in result) ||
    !result.value ||
    typeof result.value !== 'object'
  )
    return changedCall();
  const change = result.value;
  if (
    !('nonce' in change) ||
    !matchesChangeBytes(change.nonce, expected.nonce) ||
    !('color' in change) ||
    !matchesChangeBytes(change.color, expected.color) ||
    !('value' in change) ||
    typeof change.value !== 'bigint' ||
    change.value !== BigInt(expected.value)
  )
    return changedCall();
}

function hasSharedBacking(value: Uint8Array): boolean {
  return (
    typeof SharedArrayBuffer !== 'undefined' && bufferOf?.call(value) instanceof SharedArrayBuffer
  );
}

function matchesChangeBytes(value: unknown, expected: string): boolean {
  return (
    value instanceof Uint8Array &&
    byteLengthOf?.call(value) === 32 &&
    !hasSharedBacking(value) &&
    toHex(new Uint8Array(value)) === expected
  );
}

function ownTransactionBytes(value: Uint8Array): Uint8Array<ArrayBuffer> {
  const length = value instanceof Uint8Array ? byteLengthOf?.call(value) : undefined;
  if (!length || length > MAX_FINALIZED_BYTES || hasSharedBacking(value)) return changedCall();
  return new Uint8Array(value);
}

type ProoflessTransaction = ReturnType<UnprovenTransaction['eraseProofs']>;

function outputBytes(
  tx: ProoflessTransaction,
  pinnedNetwork: ProoflessTransaction,
  reservation: ShieldedWithdrawalReservation,
): readonly [Uint8Array, Uint8Array] {
  // Ledger 9 checks the embedded network when merging two standard
  // transactions. Use an empty probe because v9 has no network getter.
  tx.merge(pinnedNetwork);
  const offers = [...(tx.fallibleOffer?.values() ?? [])];
  if (tx.guaranteedOffer) offers.push(tx.guaranteedOffer);
  const outputs = offers.flatMap(({ outputs }) => outputs);
  const payout = outputs.find(({ commitment }) => commitment === reservation.payoutCommitment);
  const change = outputs.find(({ commitment }) => commitment === reservation.changeCommitment);
  if (!payout || !change) return changedCall();
  return [payout.serialize(), change.serialize()];
}

function requireSameOutputs(
  [expectedPayout, expectedChange]: readonly [Uint8Array, Uint8Array],
  [payout, change]: readonly [Uint8Array, Uint8Array],
) {
  if (!sameBytes(expectedPayout, payout) || !sameBytes(expectedChange, change))
    return changedCall();
}

/** Internal source route for a previously consented and reserved partial withdrawal. */
export async function submitStagedShieldedWithdrawal(
  requestId: string,
  request: CallRequest,
  runtime: StagedShieldedWithdrawalRuntime,
): Promise<{ readonly submissionId: string; readonly txHash: string }> {
  const { journal, prover, wallet, submitter, build, networkId, bindingId } = runtime;
  const { signal } = request;
  const check = () => {
    if (signal?.aborted) return changedCall();
  };
  try {
    check();
    if (wallet.supportsShieldedOffers !== true || request.mutation !== undefined)
      return changedCall();
    const { args, heldCoin, reservation } = await prepareShieldedWithdrawalDispatch(
      requestId,
      request,
      { networkId, bindingId },
      journal,
    );
    const { account: address, circuit } = reservation;
    check();
    const { private: built } = await build({ address, circuit, args, heldCoin });
    requirePrivateChange(built.result, reservation.change);
    const unprovenBytes = ownTransactionBytes(built.unprovenTx.serialize());
    const unproven = Transaction.deserialize<SignatureEnabled, PreProof, PreBinding>(
      'signature',
      'pre-proof',
      'pre-binding',
      unprovenBytes,
    );
    const commitment = verifyShieldedWithdrawalCall(unproven, reservation);
    const pinnedNetwork = Transaction.fromParts(networkId).eraseProofs();
    const originalOutputs = outputBytes(unproven.eraseProofs(), pinnedNetwork, reservation);
    check();
    const proof = await prover.proveTx(unprovenBytes, {
      networkId,
      bindingId,
      circuits: [circuit],
      ...(signal && { signal }),
    });
    const provedBytes = ownTransactionBytes(proof.tx);
    const proved = Transaction.deserialize<SignatureEnabled, Proof, PreBinding>(
      'signature',
      'proof',
      'pre-binding',
      provedBytes,
    );
    verifyShieldedWithdrawalCall(proved, reservation, commitment);
    requireSameOutputs(
      originalOutputs,
      outputBytes(proved.eraseProofs(), pinnedNetwork, reservation),
    );
    check();
    const walletBytes = ownTransactionBytes(await wallet.balanceAndSign(provedBytes));
    const finalized = Transaction.deserialize<SignatureEnabled, Proof, Binding>(
      'signature',
      'proof',
      'binding',
      walletBytes,
    );
    requireSameOutputs(
      originalOutputs,
      outputBytes(finalized.eraseProofs(), pinnedNetwork, reservation),
    );
    const identifiers = finalized.identifiers();
    const txHash = finalized.transactionHash();
    const bytes = await stageShieldedWithdrawalDispatch(
      finalized,
      reservation,
      commitment,
      journal,
      signal,
    );
    check();
    const submissionId = await submitter.submit(bytes);
    if (!identifiers.includes(submissionId)) return changedCall();
    return { submissionId, txHash };
  } catch {
    // The builder or wallet error can carry private circuit data. The retained
    // dispatch, when present, is the only source for subsequent reconciliation.
    return changedCall();
  }
}
