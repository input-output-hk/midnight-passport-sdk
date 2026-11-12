import {
  PassportConnectorError,
  prepareSignedJubjubGrantWithdrawal,
  type SignedJubjubGrantWithdrawalPorts,
} from '@input-output-hk/mn-passport-account';
import type {
  AgentGrantSpendReceiptStore,
  DurableAgentGrantSpendPort,
  PinnedChain,
} from '@input-output-hk/mn-passport-account/ports';
import { HttpError } from '@input-output-hk/mn-passport-service';

interface SessionWithdrawalPorts extends SignedJubjubGrantWithdrawalPorts {
  readonly chain: PinnedChain & DurableAgentGrantSpendPort;
  readonly receipts: AgentGrantSpendReceiptStore;
}

/** Validate the grantee signature before taking any durable reservation. */
export async function submitSessionWithdrawal(
  input: {
    readonly requestId: string;
    readonly account: string;
    readonly args: readonly unknown[];
  },
  ports: SessionWithdrawalPorts,
) {
  const { receipts, chain } = ports;
  if (chain.networkId !== ports.networkId || chain.bindingId !== 'acc-s3r1.1')
    throw new HttpError(409, 'Session withdrawal chain differs from the pinned binding.');
  const { requestId: originalRequestId, account, args: originalArgs } = structuredClone(input);
  const original = await receipts.readRecord(originalRequestId);
  if (original)
    throw new HttpError(409, 'Reconcile the original session withdrawal before retrying.');
  const prepare = async (args: readonly unknown[]) => {
    try {
      return await prepareSignedJubjubGrantWithdrawal(
        { requestId: originalRequestId, account, args },
        ports,
      );
    } catch (error) {
      if (error instanceof PassportConnectorError && error.code === 'GrantScopeInvalid')
        throw new HttpError(400, 'Invalid or stale signed session withdrawal.');
      throw error;
    }
  };
  const { args, reservation } = await prepare(originalArgs);
  if (!(await receipts.reserve(reservation)))
    throw new HttpError(409, 'Reconcile the original session withdrawal before retrying.');
  const latest = await prepare(args);
  if (latest.reservation.intentSha256 !== reservation.intentSha256)
    throw new HttpError(
      409,
      'The grant changed before submitting the original session withdrawal.',
    );
  const { requestId, intentSha256, validUntilSeconds } = reservation;
  const result = await chain.submitDurableAgentGrantSpend({
    address: reservation.account,
    args,
    circuit: reservation.circuit,
    mutation: { requestId, intentSha256, validUntilSeconds },
  });
  await receipts.recordTransaction(reservation, result.txHash);
  return result;
}
