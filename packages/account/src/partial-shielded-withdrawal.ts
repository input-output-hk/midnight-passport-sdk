import type {
  FlowOptions,
  PassportOwnerTransferResult,
  PassportPartialShieldedWithdrawal,
  PassportPartialShieldedWithdrawalResult,
} from '@input-output-hk/mn-passport-protocol';
import { z } from 'zod';
import { toHex } from './codec.js';
import { PassportConnectorError } from './errors.js';
import type { Flow } from './flow.js';
import { mutationDigest } from './mutation-codec.js';
import type { CallRequest, Chain, QualifiedShieldedCoin, ShieldedCoin } from './ports/index.js';
import {
  appendShieldedChange,
  recoverShieldedBackfill,
  resumeShieldedBackfill,
  type ShieldedBackfillPorts,
  type ShieldedBackfillRecoveryPorts,
  type ShieldedBackfillResumePorts,
} from './shielded-backfill.js';
import {
  shieldedWithdrawalReservation,
  shieldedWithdrawCircuit,
  type ShieldedWithdrawalJournal,
} from './shielded-withdrawal-journal.js';
import {
  recoverShieldedWithdrawal,
  type ShieldedWithdrawalRecoveryPorts,
} from './shielded-withdrawal-recovery.js';
import { prepareShieldedWithdrawal } from './unshielded-withdrawal.js';

export interface PartialShieldedWithdrawalReview {
  readonly requestId: string;
  readonly networkId: string;
  readonly bindingId: 'acc-s3r1.1';
  readonly account: string;
  readonly recipient: string;
  readonly color: string;
  readonly amount: string;
  readonly inboxIndex: number;
  readonly changeAmount: string;
}

export interface PartialShieldedWithdrawalHost extends ShieldedWithdrawalRecoveryPorts {
  readonly journal: ShieldedWithdrawalJournal;
  /** Locally derive exact effects for the qualified input and supported recipient. */
  readonly predict: (input: {
    readonly account: string;
    readonly recipient: string;
    readonly coin: QualifiedShieldedCoin;
    readonly amount: bigint;
  }) => Promise<{
    readonly inputNullifier: string;
    readonly payoutCommitment: string;
    readonly change: ShieldedCoin;
  }>;
  readonly reviewWithdrawal: (input: PartialShieldedWithdrawalReview) => Promise<boolean>;
  /** Use the same journal and the checked staged withdrawal adapter. */
  readonly submitOriginal: (requestId: string, call: CallRequest) => Promise<unknown>;
}

type Transfer = ReturnType<typeof prepareShieldedWithdrawal>;
type WithdrawalContext = {
  readonly chain: Chain;
  readonly coin: QualifiedShieldedCoin;
  readonly counter: bigint;
  readonly transfer: Transfer;
  readonly flow: Flow;
  readonly checkCurrent: () => Promise<void>;
};
export type PrepareOwnerShieldedDispatch<T> = (
  context: WithdrawalContext,
) => Promise<(call: CallRequest) => Promise<T>>;

export async function exactOwnerShieldedDispatch({
  chain,
  coin,
  counter,
  transfer,
}: WithdrawalContext): Promise<(call: CallRequest) => Promise<PassportOwnerTransferResult>> {
  if (transfer.amount !== coin.value)
    throw new PassportConnectorError(
      'TransferInvalid',
      'This shielded owner withdrawal must spend the selected coin exactly.',
    );
  return async (call) => ({ ...(await chain.call(call)), nextUseCounter: counter + 1n });
}

function copyCoin<T extends ShieldedCoin>(coin: T): T {
  return { ...coin, nonce: new Uint8Array(coin.nonce), color: new Uint8Array(coin.color) };
}

type OwnerScope = {
  readonly account: string;
  readonly networkId: string;
  readonly bindingId: string;
};

export function capturePartialShieldedWithdrawal(request: PassportPartialShieldedWithdrawal) {
  const { requestId, inboxIndex, color, amount, recipient } = request;
  const transfer = { inboxIndex, color, amount, recipient };
  const validated = prepareShieldedWithdrawal(transfer);
  const publicIntentSha256 = mutationDigest({
    inboxIndex: validated.inboxIndex,
    color: toHex(validated.color),
    amount: validated.amount.toString(),
    recipient: toHex(validated.recipient.bytes),
  });
  return { requestId, transfer, publicIntentSha256 };
}

export function partialOwnerShieldedDispatch(
  requestId: string,
  publicIntentSha256: string,
  scope: OwnerScope,
  host: PartialShieldedWithdrawalHost,
): PrepareOwnerShieldedDispatch<PassportPartialShieldedWithdrawalResult> {
  return async ({ transfer, coin, flow, checkCurrent }) => {
    if (transfer.amount >= coin.value)
      throw new PassportConnectorError(
        'TransferInvalid',
        'Select an amount below the held coin value.',
      );
    const recipient = toHex(transfer.recipient.bytes);
    const color = toHex(transfer.color);
    const value = coin.value - transfer.amount;
    const prediction = await host.predict({
      account: scope.account,
      recipient,
      amount: transfer.amount,
      coin: copyCoin(coin),
    });
    const { inputNullifier, payoutCommitment, change } = prediction;
    if (change.value !== value || toHex(change.color) !== color)
      throw new PassportConnectorError(
        'MutationUnsettled',
        'The predicted change does not match the selected coin.',
      );
    const changeCommitment = host.deriveChangeCommitment(scope.account, copyCoin(change));
    if (
      !changeCommitment ||
      ![inputNullifier, payoutCommitment, changeCommitment].every((id) =>
        /^[0-9a-f]{64}$/.test(id),
      ) ||
      payoutCommitment === changeCommitment
    )
      throw new PassportConnectorError(
        'MutationUnsettled',
        'The predicted withdrawal effects are invalid.',
      );
    const retainedChange = { nonce: toHex(change.nonce), color, value: value.toString() };
    const heldCoinSha256 = mutationDigest(coin);
    const pinned = {
      requestId,
      account: scope.account,
      networkId: scope.networkId,
      bindingId: 'acc-s3r1.1' as const,
    };
    flow.checkpoint();
    if (
      !(await host.reviewWithdrawal(
        Object.freeze({
          ...pinned,
          recipient,
          color,
          amount: transfer.amount.toString(),
          inboxIndex: transfer.inboxIndex,
          changeAmount: retainedChange.value,
        }),
      ))
    )
      throw new PassportConnectorError('UserCancelled', 'Shielded withdrawal was declined.');
    await checkCurrent();
    flow.checkpoint();
    return async (call) => {
      await checkCurrent();
      flow.checkpoint();
      const reservation = shieldedWithdrawalReservation.safeParse({
        ...pinned,
        circuit: shieldedWithdrawCircuit.parse(call.circuit),
        callArgsSha256: mutationDigest(call.args),
        publicIntentSha256,
        heldCoinSha256,
        inputNullifier,
        payoutCommitment,
        changeCommitment,
        change: retainedChange,
      });
      if (
        !reservation.success ||
        call.address !== pinned.account ||
        mutationDigest(call.heldCoin) !== heldCoinSha256
      )
        throw new PassportConnectorError(
          'MutationUnsettled',
          'The signed withdrawal does not match its reservation.',
        );
      if (!(await host.journal.reserve(reservation.data))) {
        const original = await existingPartialWithdrawal(
          requestId,
          publicIntentSha256,
          scope,
          host,
        );
        if (!original)
          throw new PassportConnectorError(
            'MutationUnsettled',
            'The original withdrawal is reserved but its intent is unavailable.',
          );
        return original;
      }
      flow.checkpoint();
      try {
        await host.submitOriginal(requestId, call);
      } catch {
        // The original may have reached the submitter. Only observation confirms it.
      }
      return observedWithdrawal(requestId, scope, host);
    };
  };
}

export function assertSameOwnerShieldedInput(
  original: { readonly authNonce: bigint; readonly deviceEpoch: bigint },
  latest: {
    readonly authNonce: bigint;
    readonly deviceEpoch: bigint;
    readonly booted: boolean;
    readonly specVersion: number;
  },
  originalCoin: QualifiedShieldedCoin,
  latestCoin: QualifiedShieldedCoin,
) {
  if (
    !latest.booted ||
    latest.specVersion !== 3 ||
    latest.authNonce !== original.authNonce ||
    latest.deviceEpoch !== original.deviceEpoch ||
    mutationDigest(originalCoin) !== mutationDigest(latestCoin)
  )
    throw new PassportConnectorError(
      'MutationUnsettled',
      'The reviewed shielded holding or owner state changed.',
    );
}

export function validatePartialWithdrawalHost(
  requestId: string,
  scope: OwnerScope,
  host?: PartialShieldedWithdrawalHost,
) {
  if (!z.uuid().safeParse(requestId).success)
    throw new PassportConnectorError('TransferInvalid', 'Keep a valid original withdrawal UUID.');
  if (!host || scope.bindingId !== 'acc-s3r1.1' || host.finality.bindingId !== scope.bindingId)
    throw new PassportConnectorError(
      'BindingUnsupported',
      'A pinned durable shielded withdrawal host is required.',
    );
  if (host.finality.networkId !== scope.networkId)
    throw new PassportConnectorError(
      'NetworkMismatch',
      'The withdrawal host uses another network.',
    );
  return host;
}

async function observedWithdrawal(
  requestId: string,
  scope: OwnerScope,
  ports: ShieldedWithdrawalRecoveryPorts,
): Promise<PassportPartialShieldedWithdrawalResult> {
  const original = await recoverShieldedWithdrawal(requestId, ports);
  if (original.kind === 'change-found' && original.account === scope.account)
    return { kind: 'change-pending', requestId: original.requestId, txHash: original.txHash };
  return { kind: 'withdrawal-pending', requestId };
}

export async function existingPartialWithdrawal(
  requestId: string,
  publicIntentSha256: string,
  scope: OwnerScope,
  host: PartialShieldedWithdrawalHost,
) {
  const row = await host.journal.read(requestId);
  if (!row) return undefined;
  if (
    row.reservation.account !== scope.account ||
    row.reservation.networkId !== scope.networkId ||
    row.reservation.bindingId !== scope.bindingId
  )
    throw new PassportConnectorError(
      'MutationUnsettled',
      'The original withdrawal belongs to another account or network.',
    );
  if (row.reservation.publicIntentSha256 !== publicIntentSha256)
    throw new PassportConnectorError(
      'MutationUnsettled',
      'The retained withdrawal intent is unavailable or differs from this request.',
    );
  return observedWithdrawal(requestId, scope, host);
}

/** Read-only observation of the original withdrawal and its separately journaled append. */
export async function reconcilePartialShieldedWithdrawal(
  requestId: string,
  ports: ShieldedBackfillRecoveryPorts,
): Promise<PassportPartialShieldedWithdrawalResult> {
  const original = await recoverShieldedWithdrawal(requestId, ports.withdrawal);
  if (original.kind !== 'change-found') return { kind: 'withdrawal-pending', requestId };
  const append = await recoverShieldedBackfill(requestId, ports);
  if (append.kind !== 'confirmed')
    return { kind: 'change-pending', requestId: original.requestId, txHash: original.txHash };
  return {
    kind: 'change-published',
    requestId: original.requestId,
    txHash: original.txHash,
    appendTxHash: append.txHash,
    inboxIndex: append.inboxIndex,
  };
}

/** Explicitly approve a new append or resume its retained original. */
export async function settlePartialShieldedWithdrawal(
  requestId: string,
  operation:
    | { readonly kind: 'append'; readonly ports: ShieldedBackfillPorts }
    | { readonly kind: 'resume'; readonly ports: ShieldedBackfillResumePorts },
  options: FlowOptions = {},
): Promise<PassportPartialShieldedWithdrawalResult> {
  const capturedOptions = { ...options };
  const observed = await reconcilePartialShieldedWithdrawal(requestId, operation.ports);
  if (observed.kind !== 'change-pending') return observed;
  const append =
    operation.kind === 'append'
      ? await appendShieldedChange(requestId, operation.ports, capturedOptions)
      : await resumeShieldedBackfill(requestId, operation.ports, capturedOptions);
  return append.kind === 'confirmed'
    ? {
        ...observed,
        kind: 'change-published',
        appendTxHash: append.txHash,
        inboxIndex: append.inboxIndex,
      }
    : observed;
}
