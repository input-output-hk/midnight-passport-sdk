import { z } from 'zod';
import { fromHex } from './codec.js';
import { PassportConnectorError } from './errors.js';
import { mutationDigest } from './mutation-codec.js';
import type { QualifiedShieldedCoin, ShieldedCoin } from './ports/index.js';
import {
  shieldedEffectHex,
  shieldedWithdrawalDispatch,
  shieldedWithdrawalReservation,
  shieldedWithdrawCircuit,
  type ShieldedWithdrawalDispatch,
  type ShieldedWithdrawalJournal,
} from './shielded-withdrawal-journal.js';

const observation = z.strictObject({
  dispatch: shieldedWithdrawalDispatch,
  bindingId: z.literal('acc-s3r1.1'),
  blockHash: shieldedEffectHex,
  blockHeight: z.number().int().positive(),
  account: shieldedEffectHex,
  circuit: shieldedWithdrawCircuit,
  inputNullifier: shieldedEffectHex,
  outputCommitments: z.tuple([shieldedEffectHex, shieldedEffectHex]),
  changeOutput: z.strictObject({
    account: shieldedEffectHex,
    commitment: shieldedEffectHex,
    index: z
      .bigint()
      .min(0n)
      .max((1n << 64n) - 1n),
  }),
});

export type FinalizedShieldedWithdrawal = z.input<typeof observation>;

export interface ShieldedWithdrawalFinalitySource {
  readonly networkId: string;
  readonly bindingId: 'acc-s3r1.1';
  /**
   * Verify successful canonical finality of the exact staged bytes and one
   * shielded withdrawal call. Read its effects and verify the ACC-owned
   * commitment's insertion index for this transaction. Return undefined while
   * any evidence is absent or ambiguous. A historical holding match is insufficient.
   */
  readFinalized(
    identity: ShieldedWithdrawalDispatch['identity'],
  ): Promise<FinalizedShieldedWithdrawal | undefined>;
}

export interface ShieldedWithdrawalRecoveryPorts {
  readonly journal: Pick<ShieldedWithdrawalJournal, 'read'>;
  readonly finality: ShieldedWithdrawalFinalitySource;
  /** Compute locally. The coin description must stay outside the remote finality request. */
  readonly deriveChangeCommitment: (account: string, coin: ShieldedCoin) => string | undefined;
}

export type ShieldedWithdrawalRecovery =
  | { readonly kind: 'unknown' }
  | {
      readonly kind: 'change-found';
      readonly requestId: string;
      readonly txHash: string;
      readonly blockHash: string;
      readonly blockHeight: number;
      /** Private change description and the original insertion index. It may have since been spent. */
      readonly change: QualifiedShieldedCoin;
    };

/** Read the original withdrawal. This operation has no signer, append or submit authority. */
export async function recoverShieldedWithdrawal(
  requestId: string,
  { journal, finality, deriveChangeCommitment }: ShieldedWithdrawalRecoveryPorts,
): Promise<ShieldedWithdrawalRecovery> {
  if (!z.uuid().safeParse(requestId).success) return { kind: 'unknown' };
  const record = await journal.read(requestId);
  if (!record?.dispatch) return { kind: 'unknown' };
  const reservation = shieldedWithdrawalReservation.safeParse(record.reservation);
  const dispatch = shieldedWithdrawalDispatch.safeParse(record.dispatch);
  if (
    !reservation.success ||
    !dispatch.success ||
    reservation.data.requestId.toLowerCase() !== requestId.toLowerCase()
  )
    return { kind: 'unknown' };
  const expected = reservation.data;
  if (finality.networkId !== expected.networkId)
    throw new PassportConnectorError(
      'NetworkMismatch',
      'The original withdrawal used another network.',
    );
  if (finality.bindingId !== expected.bindingId)
    throw new PassportConnectorError(
      'BindingUnsupported',
      'The original withdrawal used another binding.',
    );

  const readChange = (): ShieldedCoin => ({
    nonce: fromHex(expected.change.nonce),
    color: fromHex(expected.change.color),
    value: BigInt(expected.change.value),
  });
  if (deriveChangeCommitment(expected.account, readChange()) !== expected.changeCommitment)
    return { kind: 'unknown' };

  const seen = observation.safeParse(await finality.readFinalized(dispatch.data.identity));
  if (!seen.success) return { kind: 'unknown' };
  const { data } = seen;
  if (
    mutationDigest(data.dispatch) !== mutationDigest(dispatch.data) ||
    data.bindingId !== expected.bindingId ||
    data.account !== expected.account ||
    data.circuit !== expected.circuit ||
    data.inputNullifier !== expected.inputNullifier ||
    !data.outputCommitments.includes(expected.payoutCommitment) ||
    !data.outputCommitments.includes(expected.changeCommitment) ||
    data.changeOutput.account !== expected.account ||
    data.changeOutput.commitment !== expected.changeCommitment
  )
    return { kind: 'unknown' };

  return {
    kind: 'change-found',
    requestId: expected.requestId,
    txHash: dispatch.data.identity.txHash,
    blockHash: data.blockHash,
    blockHeight: data.blockHeight,
    change: {
      ...readChange(),
      mt_index: data.changeOutput.index,
    },
  };
}
