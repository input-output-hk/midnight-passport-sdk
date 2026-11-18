import { ContractCall, Transaction } from '@midnightntwrk/ledger-v9';
import {
  proveUnboundNightDeposit,
  type UnboundNightDepositRequest,
} from '@input-output-hk/mn-passport-adapter-midnight-js';
import type { FundingProgress } from '@input-output-hk/mn-passport-service';
import type { createMidnightWalletPorts } from '@input-output-hk/mn-passport-adapter-midnight-js';

type WalletProvider = Parameters<typeof createMidnightWalletPorts>[0];
type MidnightProvider = Parameters<typeof createMidnightWalletPorts>[1];
const ADDRESS = /^[0-9a-f]{64}$/;

/** The local funding wallet pays for the exact ACC deposit after a durable send fence. */
export async function submitMeasuredNightDeposit(
  request: UnboundNightDepositRequest,
  walletProvider: WalletProvider,
  midnightProvider: MidnightProvider,
  recordProgress: (progress: FundingProgress) => Promise<void>,
): Promise<{ readonly txId: string }> {
  const proven = await proveUnboundNightDeposit(request);
  const balanced = await walletProvider.balanceTx({
    version: 'v9',
    tx: Transaction.deserialize('signature', 'proof', 'pre-binding', proven),
  });
  if (balanced.version !== 'v9') throw new Error('Funding wallet returned a different ledger era.');
  const tx = balanced.tx;
  const calls = [...(tx.intents?.values() ?? [])].flatMap((intent) => intent.actions);
  const [call] = calls;
  const circuit =
    call instanceof ContractCall && call.entryPoint instanceof Uint8Array
      ? new TextDecoder().decode(call.entryPoint)
      : call instanceof ContractCall
        ? call.entryPoint
        : undefined;
  if (
    calls.length !== 1 ||
    !(call instanceof ContractCall) ||
    call.address !== request.target ||
    circuit !== 'deposit_unshielded'
  )
    throw new Error('Funding wallet changed the pinned NIGHT deposit call.');
  const txId = tx.transactionHash();
  const identifiers = tx.identifiers();
  if (
    !ADDRESS.test(txId) ||
    !identifiers.length ||
    identifiers.length > 32 ||
    identifiers.some((id) => !/^[0-9a-f]{66}$/.test(id))
  )
    throw new Error('Measured NIGHT deposit has no stable transaction identity.');
  // Record the original before handing it to the node. A lost response or rejected
  // submission leaves this exact ID available for read-only reconciliation.
  await recordProgress({ stage: 'submitted', txId });
  await midnightProvider.submitTx({ version: 'v9', tx });
  return { txId };
}
