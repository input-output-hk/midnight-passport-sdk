import type { ServiceWire } from '@input-output-hk/mn-passport-protocol';
import { createHash } from 'node:crypto';

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

export interface FundingRejectionEvidence {
  readonly rejectedHashes: readonly string[];
  readonly nodeLogSha256: string;
  readonly firstRejectionAt: string;
  readonly lastRejectionAt: string;
  readonly actionFrontierHash: string;
  readonly observedBalance: string;
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

/** Narrow localnet recovery for the four-attempt legacy gas failure, after operator attribution. */
export function verifyFundingRejection(
  pending: FundingPendingRecord,
  actions: readonly FundingContractAction[],
  nodeLog: string,
  now = Date.now(),
): FundingRejectionEvidence {
  const { request, progress } = pending;
  if (
    request.networkId !== 'undeployed' ||
    request.color !== '00'.repeat(32) ||
    pending.noSubmit ||
    !progress?.preparationTxId ||
    progress.depositTxId ||
    !DECIMAL.test(progress.balanceBefore) ||
    !actions.length ||
    nodeLog.length > 4 * 1024 * 1024
  )
    throw new Error('request is not a legacy local NIGHT gas rejection');
  if (
    actions.some(
      (action) => action.kind === 'ContractCall' && action.entryPoint === 'deposit_unshielded',
    )
  )
    throw new Error('ACC has a deposit action; preserve the pending reservation');
  const latest = actions.at(-1);
  if (!latest) throw new Error('ACC action history is empty');
  if (balance(latest, request.color) !== BigInt(progress.balanceBefore))
    throw new Error('ACC balance changed; preserve the pending reservation');
  const rows = [
    ...nodeLog.matchAll(
      /(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})[^\n]*Rejected transaction ([0-9a-f]{64}) from mempool: guaranteed execution would fail: ran out of gas budget/g,
    ),
  ];
  const hashes = rows.map((row) => row[2] ?? '');
  const times = rows.map((row) => Date.parse(`${(row[1] ?? '').replace(' ', 'T')}Z`));
  const first = times[0];
  const last = times.at(-1);
  if (
    rows.length !== 4 ||
    first === undefined ||
    last === undefined ||
    new Set(hashes).size !== 4 ||
    times.some((time) => !Number.isFinite(time)) ||
    times.some((time, index) => index > 0 && time < (times[index - 1] ?? Infinity)) ||
    last - first > 120_000 ||
    now - last < 600_000 ||
    actions.some((action) => hashes.includes(action.txHash))
  )
    throw new Error('node log does not prove the four aged gas-budget rejections');
  return {
    rejectedHashes: hashes,
    nodeLogSha256: createHash('sha256').update(nodeLog).digest('hex'),
    firstRejectionAt: new Date(first).toISOString(),
    lastRejectionAt: new Date(last).toISOString(),
    actionFrontierHash: latest.txHash,
    observedBalance: progress.balanceBefore,
  };
}
