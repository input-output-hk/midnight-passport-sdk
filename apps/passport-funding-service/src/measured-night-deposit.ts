import { Transaction } from '@midnightntwrk/ledger-v9';
import {
  proveUnboundNightDeposit,
  type UnboundNightDepositRequest,
} from '@input-output-hk/mn-passport-adapter-midnight-js';
import type { FundingProgress } from '@input-output-hk/mn-passport-service';
import type { createMidnightWalletPorts } from '@input-output-hk/mn-passport-adapter-midnight-js';

type WalletProvider = Parameters<typeof createMidnightWalletPorts>[0];
type MidnightProvider = Parameters<typeof createMidnightWalletPorts>[1];
const ADDRESS = /^[0-9a-f]{64}$/;

/** Wallet and adapter may load distinct WASM class instances for the same Ledger 9 action. */
export function verifyMeasuredNightDepositCall(actions: readonly unknown[], target: string): void {
  const [action] = actions;
  if (
    actions.length !== 1 ||
    !action ||
    typeof action !== 'object' ||
    action.constructor.name !== 'ContractCall' ||
    !('address' in action) ||
    !('entryPoint' in action)
  )
    throw new Error('Funding wallet changed the pinned NIGHT deposit call.');
  const circuit =
    action.entryPoint instanceof Uint8Array
      ? new TextDecoder().decode(action.entryPoint)
      : action.entryPoint;
  if (action.address !== target || circuit !== 'deposit_unshielded')
    throw new Error('Funding wallet changed the pinned NIGHT deposit call.');
}

/** Prove and balance locally; this helper never submits the ACC transaction. */
async function prepareMeasuredNightDeposit(
  request: UnboundNightDepositRequest,
  walletProvider: WalletProvider,
) {
  const proven = await proveUnboundNightDeposit(request);
  const balanced = await walletProvider.balanceTx({
    version: 'v9',
    tx: Transaction.deserialize('signature', 'proof', 'pre-binding', proven),
  });
  if (balanced.version !== 'v9') throw new Error('Funding wallet returned a different ledger era.');
  const tx = balanced.tx;
  const calls = [...(tx.intents?.values() ?? [])].flatMap((intent) => intent.actions);
  verifyMeasuredNightDepositCall(calls, request.target);
  const txId = tx.transactionHash();
  const identifiers = tx.identifiers();
  if (
    !ADDRESS.test(txId) ||
    !identifiers.length ||
    identifiers.length > 32 ||
    identifiers.some((id) => !/^[0-9a-f]{66}$/.test(id))
  )
    throw new Error('Measured NIGHT deposit has no stable transaction identity.');
  return { tx, txId };
}

/** The local funding wallet pays for the exact ACC deposit after a durable send fence. */
export async function submitMeasuredNightDepositAfterPreparation<T>(
  prepare: () => Promise<{ readonly tx: T; readonly txId: string }>,
  submit: (tx: T) => Promise<void>,
  recordProgress: (progress: FundingProgress) => Promise<void>,
): Promise<{ readonly txId: string }> {
  let prepared: Awaited<ReturnType<typeof prepare>>;
  try {
    prepared = await prepare();
  } catch (error) {
    // Proving, balancing and validating cannot submit to the node. Only this
    // pre-fence boundary may durably mark the ACC deposit as not submitted.
    await recordProgress({ stage: 'acc-not-submitted' });
    throw error;
  }
  // Record the original before handing it to the node. A lost response or rejected
  // submission leaves this exact ID available for read-only reconciliation.
  await recordProgress({ stage: 'submitted', txId: prepared.txId });
  await submit(prepared.tx);
  return { txId: prepared.txId };
}

export async function submitMeasuredNightDeposit(
  request: UnboundNightDepositRequest,
  walletProvider: WalletProvider,
  midnightProvider: MidnightProvider,
  recordProgress: (progress: FundingProgress) => Promise<void>,
): Promise<{ readonly txId: string }> {
  return submitMeasuredNightDepositAfterPreparation(
    () => prepareMeasuredNightDeposit(request, walletProvider),
    async (tx) => {
      await midnightProvider.submitTx({ version: 'v9', tx });
    },
    recordProgress,
  );
}
