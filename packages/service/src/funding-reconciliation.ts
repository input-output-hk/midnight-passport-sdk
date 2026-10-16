import type { ServiceWire } from '@input-output-hk/mn-passport-protocol';

/** Ordered, chain-backed ACC actions from one pinned indexer. */
export interface FundingContractAction {
  readonly txHash: string;
  readonly identifiers: readonly string[];
  readonly status: 'SUCCESS' | 'PARTIAL_SUCCESS' | 'FAILURE';
  readonly kind: 'ContractDeploy' | 'ContractCall' | 'ContractUpdate';
  readonly entryPoint?: string;
  readonly balances: Readonly<Record<string, string>>;
}

export interface FundingCreditEvidence {
  readonly txHash: string;
  readonly previousBalance: string;
  readonly creditedBalance: string;
}

export interface FundingPendingRecord {
  readonly request: ServiceWire.FundAccRequest;
  readonly progress?: {
    readonly balanceBefore: string;
    readonly preparationTxId?: string;
    readonly depositTxId?: string;
  };
  readonly noSubmit?: true;
}

const DECIMAL = /^(?:0|[1-9][0-9]*)$/;
const balance = (action: FundingContractAction, color: string): bigint => {
  const value = action.balances[color] ?? '0';
  if (!DECIMAL.test(value)) throw new Error('indexer returned an invalid ACC balance');
  return BigInt(value);
};

/** Fail closed unless the recorded transaction's own ACC action credits exactly this request. */
export function verifyFundingCredit(
  pending: FundingPendingRecord,
  actions: readonly FundingContractAction[],
): { readonly result: ServiceWire.FundAccResponse; readonly evidence: FundingCreditEvidence } {
  const { request, progress } = pending;
  if (pending.noSubmit || !progress?.depositTxId || !DECIMAL.test(progress.balanceBefore))
    throw new Error('request has no durable deposit submission to reconcile');
  const depositTxId = progress.depositTxId;
  const matching = actions.flatMap((action, index) =>
    action.identifiers.includes(depositTxId) || action.txHash === depositTxId ? [index] : [],
  );
  if (matching.length !== 1) throw new Error('recorded deposit does not identify one ACC action');
  const index = matching[0]!;
  const action = actions[index]!;
  const previous = actions[index - 1];
  if (
    !previous ||
    action.kind !== 'ContractCall' ||
    action.entryPoint !== 'deposit_unshielded' ||
    action.status !== 'SUCCESS' ||
    !action.txHash
  )
    throw new Error('recorded transaction is not a successful ACC deposit');
  const before = balance(previous, request.color);
  const after = balance(action, request.color);
  if (
    before < BigInt(progress.balanceBefore) ||
    after < before ||
    after - before !== BigInt(request.amount)
  )
    throw new Error('ACC action did not credit the exact reserved amount');
  return {
    result: {
      requestId: request.requestId,
      txId: progress.depositTxId,
      ...(progress.preparationTxId && { preparationTxId: progress.preparationTxId }),
      creditedBalance: after.toString(),
    },
    evidence: {
      txHash: action.txHash,
      previousBalance: before.toString(),
      creditedBalance: after.toString(),
    },
  };
}
