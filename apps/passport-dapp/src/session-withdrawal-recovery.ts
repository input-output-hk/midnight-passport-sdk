import type { DemoSessionPorts, DemoSessionSnapshot } from './session.js';

export interface SessionWithdrawalRecoveryRequest {
  readonly accountAddress: string;
  readonly grantId: string;
  readonly requestId: string;
  readonly amount: string;
}

export interface RecoveredWithdrawal {
  readonly txHash: string;
  readonly blockHeight: number;
}

export type RecoverSessionWithdrawal = (
  request: SessionWithdrawalRecoveryRequest,
) => Promise<RecoveredWithdrawal | undefined>;

function pendingSessionWithdrawal(
  snapshot: DemoSessionSnapshot | undefined,
  accountAddress: string,
): SessionWithdrawalRecoveryRequest | undefined {
  if (
    snapshot?.status !== 'blocked' ||
    snapshot.account !== accountAddress ||
    !snapshot.grantId ||
    !snapshot.intentId ||
    !snapshot.pendingWithdrawal
  )
    return undefined;
  return {
    accountAddress,
    grantId: snapshot.grantId,
    requestId: snapshot.intentId,
    amount: snapshot.pendingWithdrawal,
  };
}

function recoveredSessionSnapshot(
  original: DemoSessionSnapshot,
  latest: DemoSessionSnapshot | undefined,
  result: RecoveredWithdrawal,
): DemoSessionSnapshot {
  const { pendingWithdrawal: amount, ...snapshot } = original;
  if (
    !amount ||
    latest?.status !== 'blocked' ||
    latest.intentId !== original.intentId ||
    latest.account !== original.account ||
    latest.grantId !== original.grantId ||
    latest.pendingWithdrawal !== amount ||
    latest.spent !== original.spent ||
    (latest.txHash && latest.txHash !== result.txHash) ||
    (original.txHash && original.txHash !== result.txHash)
  )
    throw new Error(
      'The pending withdrawal changed during observation. Check its original receipt.',
    );
  return {
    ...snapshot,
    status: 'locked',
    spent: (BigInt(snapshot.spent) + BigInt(amount)).toString(),
    txHash: result.txHash,
  };
}

/** Only settle a matching retained spend row. Issue and revoke use other evidence. */
export function createSessionWithdrawalObserver(
  read: () => DemoSessionSnapshot | undefined,
  { recoverWithdrawal, checkpoint }: Pick<DemoSessionPorts, 'recoverWithdrawal' | 'checkpoint'>,
  settle: (snapshot: DemoSessionSnapshot) => void,
) {
  return async (accountAddress: string) => {
    const original = read();
    const input = pendingSessionWithdrawal(original, accountAddress);
    if (!original || !input || !recoverWithdrawal || !checkpoint)
      throw new Error('No original withdrawal can be checked for this account.');
    const result = await recoverWithdrawal(input);
    if (!result) return undefined;
    const next = recoveredSessionSnapshot(original, checkpoint.read(), result);
    settle(next);
    return result;
  };
}
