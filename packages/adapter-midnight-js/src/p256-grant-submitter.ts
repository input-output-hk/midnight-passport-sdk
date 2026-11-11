import type { FinalizedTransaction } from '@midnightntwrk/ledger-v9';
import { P256_GRANT_SPEND_CIRCUIT } from '@input-output-hk/mn-passport-protocol';
import type {
  CallRequest,
  P256GrantSpendReceiptStore,
  P256GrantSpendReservation,
  Submitter,
} from '@input-output-hk/mn-passport-account/ports';
import {
  changedCall,
  checkGrantCommitment,
  checkGrantPayout,
  p256GrantCall,
} from './p256-grant-call.js';

const MAX_FINALIZED_BYTES = 8 * 1024 * 1024;

/** Admit and own the exact signed Compact arguments before any proving or balancing. */
export async function prepareP256GrantDispatch(
  request: Pick<CallRequest, 'address' | 'mutation' | 'args'>,
  networkId: string,
  receipts: P256GrantSpendReceiptStore | undefined,
): Promise<{ readonly args: readonly unknown[]; readonly reservation: P256GrantSpendReservation }> {
  const { address, mutation } = request;
  if (!receipts || !mutation) return changedCall();
  const { requestId, intentSha256 } = mutation;
  const args = structuredClone(request.args);
  const row = await receipts.readRecord(requestId);
  if (
    !row ||
    row.transaction ||
    row.reservation.networkId !== networkId ||
    row.reservation.requestId !== requestId ||
    row.reservation.intentSha256 !== intentSha256 ||
    row.reservation.account !== address ||
    !receipts.matchesCallArguments(row.reservation, args)
  )
    return changedCall();
  return { args, reservation: Object.freeze({ ...row.reservation }) };
}

/** Internal to the chain that admitted the signed arguments and built the original call. */
export async function forwardP256GrantCall(
  tx: FinalizedTransaction,
  approved: P256GrantSpendReservation,
  callCommitment: string | undefined,
  receipts: P256GrantSpendReceiptStore,
  submitter: Submitter,
  signal: CallRequest['signal'],
): Promise<string> {
  const { account, requestId, intentSha256 } = approved;
  const call = p256GrantCall(tx, account);
  checkGrantCommitment(call, callCommitment);
  checkGrantPayout(call, approved);
  const bytes = tx.serialize();
  if (!bytes.length || bytes.length > MAX_FINALIZED_BYTES) return changedCall();
  const identity = {
    txHash: tx.transactionHash(),
    bytesSha256: hex(new Uint8Array(await crypto.subtle.digest('SHA-256', Uint8Array.from(bytes)))),
    identifiers: tx.identifiers(),
  };
  if (signal?.aborted || !(await receipts.stageTransaction(approved, identity)))
    return changedCall();
  const submitted = await submitter.submit(bytes, {
    address: account,
    circuit: P256_GRANT_SPEND_CIRCUIT,
    mutation: { requestId, intentSha256 },
  });
  if (!identity.identifiers.includes(submitted)) return changedCall();
  return submitted;
}

const hex = (bytes: Uint8Array) =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
