import { AGENT_GRANT_SPEND_CIRCUIT, type FlowOptions } from '@input-output-hk/mn-passport-protocol';
import { z } from 'zod';
import {
  runAgentGrantSpend,
  type AgentGrantDispatch,
  type AgentJubjubGrantSpendInput,
  type AgentJubjubGrantSpendPorts,
} from './agent-grant-holder.js';
import { toHex } from './codec.js';
import { PassportConnectorError } from './errors.js';
import { mutationDigest } from './mutation-codec.js';
import {
  type AgentGrantSpendReceiptStore,
  type AgentGrantSpendReservation,
} from './p256-grant-spend-recovery.js';
import type { DurableAgentGrantSpendPort, PinnedChain } from './ports/index.js';
import { AmountSchema, NetworkIdSchema } from './validation.js';

export interface DurableAgentGrantSpendPorts extends AgentJubjubGrantSpendPorts {
  readonly chain: PinnedChain & DurableAgentGrantSpendPort;
  readonly receipts: AgentGrantSpendReceiptStore;
}

export class DurableAgentGrantSpendUnsettled extends PassportConnectorError {
  constructor(
    readonly requestId: string,
    readonly txHash?: string,
    cause?: unknown,
  ) {
    super('MutationUnsettled', `Reconcile original agent grant spend ${requestId}.`, {
      retryable: false,
      cause,
    });
  }
}

function reservation(
  requestId: string,
  dispatch: AgentGrantDispatch,
  pure: DurableAgentGrantSpendPorts['pure'],
): AgentGrantSpendReservation {
  const { call, checked, intent, issuance, networkId, expiresAt } = dispatch;
  const fields = {
    requestId,
    circuit: AGENT_GRANT_SPEND_CIRCUIT,
    networkId: NetworkIdSchema.parse(networkId),
    account: intent.account,
    grantId: intent.grantId,
    color: intent.color,
    amount: AmountSchema.parse(checked.amount.toString()),
    recipient: intent.recipient,
    issuedAt: issuance.issuedAt.toString(),
    epoch: issuance.epoch.toString(),
    generation: issuance.generation.toString(),
    previousNonce: checked.nonce.toString(),
    validUntilSeconds: expiresAt - 1,
    expectedSpentCommit: toHex(
      pure.derive_grant_spent_commit(checked.scopeSalt, checked.spentPrev + checked.amount),
    ),
    callArgsSha256: mutationDigest(call.args),
  } as const;
  return Object.freeze({
    ...fields,
    intentSha256: mutationDigest({
      ...fields,
      requestDigest: issuance.requestDigest,
      spentPrev: checked.spentPrev,
    }),
  });
}

/** Submit one original agent withdrawal with a crash-durable reservation and finalized identity. */
export async function spendWithDurableAgentJubjubGrant(
  input: AgentJubjubGrantSpendInput & { readonly requestId: string },
  ports: DurableAgentGrantSpendPorts,
  options: FlowOptions = {},
) {
  const id = z.uuid().safeParse(input.requestId);
  if (!id.success)
    throw new PassportConnectorError('GrantScopeInvalid', 'Invalid agent spend request ID.');
  const requestId = id.data;
  const { chain, receipts, pure } = ports;
  if (typeof chain.submitDurableAgentGrantSpend !== 'function')
    throw new PassportConnectorError(
      'BindingUnsupported',
      'A durable agent spend dispatcher is required.',
    );
  let reserved = false;
  let txHash: string | undefined;
  try {
    return await runAgentGrantSpend(input, ports, options, {
      async beforeReview() {
        const prior = await receipts.readRecord(requestId);
        if (prior) throw new DurableAgentGrantSpendUnsettled(requestId, prior.transaction?.txHash);
      },
      async submit(dispatch) {
        const { call } = dispatch;
        if (call.circuit !== AGENT_GRANT_SPEND_CIRCUIT)
          throw new DurableAgentGrantSpendUnsettled(requestId);
        const original = reservation(requestId, dispatch, pure);
        // A store error can mean the reservation was committed before its reply was lost.
        reserved = true;
        if (!(await receipts.reserve(original)))
          throw new DurableAgentGrantSpendUnsettled(requestId);
        await dispatch.verify();
        const tx = await chain.submitDurableAgentGrantSpend({
          ...call,
          circuit: AGENT_GRANT_SPEND_CIRCUIT,
          mutation: {
            requestId,
            intentSha256: original.intentSha256,
            validUntilSeconds: original.validUntilSeconds,
          },
        });
        txHash = tx.txHash;
        await receipts.recordTransaction(original, txHash);
        return tx;
      },
    });
  } catch (cause) {
    if (!reserved || cause instanceof DurableAgentGrantSpendUnsettled) throw cause;
    throw new DurableAgentGrantSpendUnsettled(requestId, txHash, cause);
  }
}
