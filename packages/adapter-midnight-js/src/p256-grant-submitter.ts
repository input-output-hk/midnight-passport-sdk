import type {
  FinalizedTransaction,
  Transaction,
  Signaturish,
  Proofish,
  Bindingish,
} from '@midnightntwrk/ledger-v9';
import {
  AGENT_GRANT_SPEND_CIRCUIT,
  P256_GRANT_SPEND_CIRCUIT,
} from '@input-output-hk/mn-passport-protocol';
import type {
  CallRequest,
  AgentGrantSpendReceiptStore,
  P256GrantSpendReceiptStore,
  P256GrantSpendReservation,
  Submitter,
} from '@input-output-hk/mn-passport-account/ports';
import {
  changedCall,
  checkGrantCommitment,
  checkGrantPayout,
  checkedGrantCall,
} from './p256-grant-call.js';

type ReceiptOps<R> = {
  readRecord(id: string): Promise<{ reservation: R; transaction?: unknown } | undefined>;
  matchesCallArguments(reservation: R, args: readonly unknown[]): boolean;
  stageTransaction(
    reservation: R,
    transaction: Parameters<P256GrantSpendReceiptStore['stageTransaction']>[1],
  ): Promise<boolean>;
};

const MAX_FINALIZED_BYTES = 8 * 1024 * 1024;

/** Admit and own the exact signed Compact arguments before any proving or balancing. */
async function prepareGrantDispatch<R extends P256GrantSpendReservation>(
  request: Pick<CallRequest, 'address' | 'mutation' | 'args'>,
  networkId: string,
  receipts: ReceiptOps<R> | undefined,
): Promise<{ readonly args: readonly unknown[]; readonly reservation: R }> {
  const { address, mutation } = request;
  if (!receipts || !mutation) return changedCall();
  const { requestId, intentSha256, validUntilSeconds } = mutation;
  const args = structuredClone(request.args);
  const row = await receipts.readRecord(requestId);
  if (
    !row ||
    row.transaction ||
    row.reservation.networkId !== networkId ||
    row.reservation.requestId !== requestId ||
    row.reservation.intentSha256 !== intentSha256 ||
    row.reservation.account !== address ||
    row.reservation.validUntilSeconds !== validUntilSeconds ||
    !receipts.matchesCallArguments(row.reservation, args)
  )
    return changedCall();
  return { args, reservation: Object.freeze({ ...row.reservation }) };
}

export function prepareP256GrantDispatch(
  request: Pick<CallRequest, 'address' | 'mutation' | 'args'>,
  networkId: string,
  receipts: P256GrantSpendReceiptStore | undefined,
) {
  return prepareGrantDispatch(request, networkId, receipts);
}

async function forwardGrantCall<R extends P256GrantSpendReservation>(
  tx: FinalizedTransaction,
  approved: R,
  callCommitment: string | undefined,
  receipts: ReceiptOps<R>,
  submitter: Submitter,
  signal: CallRequest['signal'],
  circuit: string,
): Promise<string> {
  const { account, requestId, intentSha256 } = approved;
  const call = checkedGrantCall(tx, account, circuit);
  checkGrantCommitment(call, callCommitment);
  checkGrantPayout(call, approved);
  const bytes = Uint8Array.from(tx.serialize());
  if (!bytes.length || bytes.length > MAX_FINALIZED_BYTES) return changedCall();
  const txHash = tx.transactionHash();
  const identifiers = [...tx.identifiers()];
  const bytesSha256 = hex(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)));
  const identity = { txHash, bytesSha256, identifiers };
  const canSend = () =>
    !signal?.aborted &&
    (approved.validUntilSeconds === undefined ||
      Math.floor(Date.now() / 1000) <= approved.validUntilSeconds);
  if (!canSend() || !(await receipts.stageTransaction(approved, identity)) || !canSend())
    return changedCall();
  const submitted = await submitter.submit(bytes, {
    address: account,
    circuit,
    mutation: {
      requestId,
      intentSha256,
      ...(approved.validUntilSeconds !== undefined && {
        validUntilSeconds: approved.validUntilSeconds,
      }),
    },
  });
  if (!identity.identifiers.includes(submitted)) return changedCall();
  return submitted;
}

export function forwardP256GrantCall(
  tx: FinalizedTransaction,
  approved: P256GrantSpendReservation,
  callCommitment: string | undefined,
  receipts: P256GrantSpendReceiptStore,
  submitter: Submitter,
  signal: CallRequest['signal'],
) {
  return forwardGrantCall(
    tx,
    approved,
    callCommitment,
    receipts,
    submitter,
    signal,
    P256_GRANT_SPEND_CIRCUIT,
  );
}

async function dispatch<R extends P256GrantSpendReservation>(
  request: CallRequest,
  networkId: string,
  receipts: ReceiptOps<R> | undefined,
  circuit: string,
) {
  const { signal } = request;
  const { args, reservation } = await prepareGrantDispatch(request, networkId, receipts);
  if (!receipts) return changedCall();
  return {
    args,
    checkedCall<S extends Signaturish, P extends Proofish, B extends Bindingish>(
      tx: Transaction<S, P, B>,
    ) {
      return checkedGrantCall(tx, reservation.account, circuit);
    },
    forward(tx: FinalizedTransaction, commitment: string | undefined, submitter: Submitter) {
      return forwardGrantCall(tx, reservation, commitment, receipts, submitter, signal, circuit);
    },
  };
}

export function selectGrantSpendDispatch(
  request: CallRequest,
  networkId: string,
  p256Receipts: P256GrantSpendReceiptStore | undefined,
  agentReceipts: AgentGrantSpendReceiptStore | undefined,
) {
  if (request.circuit === P256_GRANT_SPEND_CIRCUIT)
    return dispatch(request, networkId, p256Receipts, P256_GRANT_SPEND_CIRCUIT);
  if (request.circuit === AGENT_GRANT_SPEND_CIRCUIT && request.mutation !== undefined)
    return dispatch(request, networkId, agentReceipts, AGENT_GRANT_SPEND_CIRCUIT);
  return undefined;
}

const hex = (bytes: Uint8Array) =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
