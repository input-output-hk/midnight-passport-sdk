import type * as Ledger from '@midnightntwrk/ledger-v9';
import {
  type FinalizedShieldedWithdrawal,
  type ShieldedWithdrawalFinalitySource,
} from '../../../packages/account/dist/index.js';
import { finalizedTransactionIdentitySchema } from '../../../packages/account/dist/finalized-transaction-identity.js';
import { abortable } from './bounded-json.ts';
import { readHostReceipt, type HostConfirmationRuntime } from './host-confirmation.ts';
import { isHostFinalizedBlock } from './host-finalized-block.ts';
import { readShieldedChangeIndex } from './shielded-withdrawal-events.ts';

type Observation = Pick<FinalizedShieldedWithdrawal, 'account' | 'circuit' | 'inputNullifier'>;
type LedgerReader = Pick<typeof Ledger, 'ContractCall'> & {
  readonly Event: Pick<typeof Ledger.Event, 'deserialize'>;
};

interface VerifiedInsertion {
  readonly txHash: string;
  readonly blockHash: string;
  readonly blockHeight: number;
  readonly account: string;
  readonly commitment: string;
  readonly index: bigint;
}

interface ShieldedWithdrawalRuntime extends HostConfirmationRuntime<Ledger.FinalizedTransaction> {
  readonly ledger: HostConfirmationRuntime<Ledger.FinalizedTransaction>['ledger'] & LedgerReader;
  readonly networkId: string;
  readonly nodeUrl: string;
  /**
   * Independently verify this transaction's inclusion and insertion index from
   * authenticated block evidence or canonical state replay. A second query to
   * the receipt indexer alone is insufficient.
   */
  readonly verifyInsertion: (
    output: VerifiedInsertion,
    signal: AbortSignal,
    transaction: Ledger.FinalizedTransaction,
  ) => Promise<boolean>;
}

function readEffects(tx: Ledger.FinalizedTransaction, ledger: LedgerReader) {
  const actions = [...(tx.intents ?? [])].flatMap(([segment, intent]) =>
    intent.actions.map((action) => ({ segment, action })),
  );
  const [entry] = actions;
  if (actions.length !== 1 || !entry || !(entry.action instanceof ledger.ContractCall))
    return undefined;
  const { action: call, segment } = entry;
  const circuit =
    typeof call.entryPoint === 'string'
      ? call.entryPoint
      : new TextDecoder().decode(call.entryPoint);
  if (circuit !== 'withdraw_shielded_with_p256' && circuit !== 'withdraw_shielded_with_jubjub')
    return undefined;

  const phases = [
    { segment: 0, effects: call.guaranteedTranscript?.effects, offer: tx.guaranteedOffer },
    { segment, effects: call.fallibleTranscript?.effects, offer: tx.fallibleOffer?.get(segment) },
  ];
  const inputs = phases.flatMap(({ segment, effects, offer }) =>
    (effects?.claimedNullifiers ?? []).map((value) => ({
      segment,
      value,
      contract: call.address,
      matched: offer?.inputs.some(
        ({ nullifier, contractAddress }) => nullifier === value && contractAddress === call.address,
      ),
    })),
  );
  const [input] = inputs;
  const receives = phases.flatMap(({ effects }) => effects?.claimedShieldedReceives ?? []);
  const [changeCommitment] = receives;
  if (!input?.matched || inputs.length !== 1 || receives.length !== 1 || !changeCommitment)
    return undefined;

  const outputs = phases.flatMap(({ segment, effects, offer }) =>
    (effects?.claimedShieldedSpends ?? []).map((value) => {
      const contract = value === changeCommitment ? call.address : undefined;
      const matched = offer?.outputs.some(
        ({ commitment, contractAddress }) => commitment === value && contractAddress === contract,
      );
      return { segment, value, contract, matched };
    }),
  );
  const payout = outputs.find(({ value }) => value !== changeCommitment);
  const change = outputs.find(({ value }) => value === changeCommitment);
  if (outputs.length !== 2 || !payout?.matched || !change?.matched) return undefined;
  const effect: Observation = { account: call.address, circuit, inputNullifier: input.value };
  return {
    effect,
    callCommitment: call.communicationCommitment,
    claims: { input, payout, change },
  };
}

/** Observe one original shielded withdrawal. The observer has no signer, wallet or submit port. */
export function createShieldedWithdrawalFinality(
  runtime: ShieldedWithdrawalRuntime,
): ShieldedWithdrawalFinalitySource {
  const networkId = runtime.networkId;
  const bindingId = 'acc-s3r1.1';
  return {
    networkId,
    bindingId,
    async readFinalized(original) {
      const identity = finalizedTransactionIdentitySchema.safeParse(original);
      if (!identity.success) return undefined;
      try {
        const receipt = await readHostReceipt(
          { identifiers: identity.data.identifiers },
          runtime,
          identity.data,
          true,
        );
        const blockHash = receipt?.confirmation.blockHash;
        const blockHeight = receipt?.confirmation.blockHeight;
        if (!receipt || !blockHash || !blockHeight) return undefined;
        if (!(await isHostFinalizedBlock(runtime, blockHeight, blockHash))) return undefined;
        const effects = readEffects(receipt.transaction, runtime.ledger);
        if (!effects) return undefined;
        const { txHash } = identity.data;
        const { claims, effect, callCommitment } = effects;
        const index = readShieldedChangeIndex(runtime.ledger, receipt.shielded, txHash, claims);
        if (index === undefined) return undefined;
        const insertion = Object.freeze({
          txHash,
          blockHash,
          blockHeight,
          account: effect.account,
          commitment: claims.change.value,
          index,
        });
        const signal = AbortSignal.timeout(4000);
        if (
          (await abortable(
            runtime.verifyInsertion(insertion, signal, receipt.transaction),
            signal,
          )) !== true
        )
          return undefined;
        return {
          ...effect,
          dispatch: { identity: identity.data, callCommitment },
          bindingId,
          blockHash,
          blockHeight,
          outputCommitments: [claims.payout.value, claims.change.value],
          changeOutput: { account: effect.account, commitment: claims.change.value, index },
        };
      } catch {
        return undefined;
      }
    },
  };
}
