import { ContractCall, Transaction } from '@midnightntwrk/ledger-v9';
import { P256_GRANT_SPEND_CIRCUIT } from '@input-output-hk/mn-passport-protocol';
import { PassportConnectorError } from '@input-output-hk/mn-passport-account/errors';
import type {
  P256GrantSpendReceiptStore,
  Submitter,
} from '@input-output-hk/mn-passport-account/ports';

export interface MidnightP256GrantSubmitterOptions {
  readonly networkId: string;
  readonly receipts: Pick<P256GrantSpendReceiptStore, 'readRecord' | 'stageTransaction'>;
  /** The dedicated value wallet submitter for this network. */
  readonly submitter: Submitter;
}

const MAX_FINALIZED_BYTES = 8 * 1024 * 1024;

/** Bind the exact finalized Ledger 9 transaction to the original request before forwarding once. */
export function createMidnightP256GrantSubmitter(
  options: MidnightP256GrantSubmitterOptions,
): Submitter {
  const { networkId, receipts, submitter } = options;
  return {
    async submit(finalized, context) {
      if (!context || context.circuit !== P256_GRANT_SPEND_CIRCUIT)
        throw new PassportConnectorError(
          'BindingUnsupported',
          'Expected a reserved P-256 grant call.',
        );
      const { address, signal } = context;
      const { requestId, intentSha256 } = context.mutation;
      if (!finalized.length || finalized.length > MAX_FINALIZED_BYTES) return unsettled();
      const bytes = Uint8Array.from(finalized);
      const row = await receipts.readRecord(requestId);
      if (
        !row ||
        row.transaction ||
        row.reservation.networkId !== networkId ||
        row.reservation.requestId !== requestId ||
        row.reservation.intentSha256 !== intentSha256 ||
        row.reservation.account !== address
      )
        return unsettled();
      const tx = Transaction.deserialize('signature', 'proof', 'binding', bytes);
      const actions = [...(tx.intents?.values() ?? [])].flatMap((intent) => [...intent.actions]);
      const [call] = actions;
      if (
        actions.length !== 1 ||
        !(call instanceof ContractCall) ||
        call.address !== address ||
        entryPoint(call.entryPoint) !== P256_GRANT_SPEND_CIRCUIT
      )
        return unsettled();
      const identity = {
        txHash: tx.transactionHash(),
        bytesSha256: hex(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))),
        identifiers: tx.identifiers(),
      };
      if (signal?.aborted || !(await receipts.stageTransaction(row.reservation, identity)))
        return unsettled();
      // This persisted dispatch fence survives a wallet response loss. There is no replay.
      const submitted = await submitter.submit(bytes, {
        address,
        circuit: P256_GRANT_SPEND_CIRCUIT,
        mutation: { requestId, intentSha256 },
      });
      if (!identity.identifiers.includes(submitted)) return unsettled();
      return submitted;
    },
  };
}

const entryPoint = (value: Uint8Array | string) =>
  typeof value === 'string' ? value : new TextDecoder().decode(value);

function unsettled(): never {
  throw new PassportConnectorError(
    'MutationUnsettled',
    'The original grant dispatch could not be confirmed.',
    { retryable: false },
  );
}
const hex = (bytes: Uint8Array) =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
