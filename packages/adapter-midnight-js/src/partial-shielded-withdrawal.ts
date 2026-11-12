import { ZswapOutput } from '@midnightntwrk/ledger-v9';
import type {
  PartialShieldedWithdrawalHost,
  ShieldedWithdrawalFinalitySource,
  ShieldedCoin,
} from '@input-output-hk/mn-passport-account/ports';
import { PassportConnectorError } from '@input-output-hk/mn-passport-account/errors';
import { deriveMidnightContractCoinCommitment, type HoldingIndexer } from './holdings.js';
import {
  submitStagedShieldedWithdrawal,
  type StagedShieldedWithdrawalRuntime,
} from './shielded-withdrawal-dispatch.js';

const toHex = (bytes: Uint8Array) =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');

export type MidnightPartialShieldedWithdrawalOptions = StagedShieldedWithdrawalRuntime & {
  readonly finality: ShieldedWithdrawalFinalitySource;
  readonly holdingIndexer: Pick<HoldingIndexer, 'coinNullifier'>;
  readonly walletKeys: { readonly coinPublicKey: string; readonly encryptionPublicKey: string };
  readonly deriveWithdrawalCoins: (
    coin: ShieldedCoin,
    amount: bigint,
  ) => Promise<{ readonly sent: ShieldedCoin; readonly change?: ShieldedCoin }>;
  readonly reviewWithdrawal: PartialShieldedWithdrawalHost['reviewWithdrawal'];
};

/** Compose durable dispatch for payouts to the explicitly configured value wallet. */
export function createMidnightPartialShieldedWithdrawalHost(
  options: MidnightPartialShieldedWithdrawalOptions,
): PartialShieldedWithdrawalHost {
  const {
    networkId,
    bindingId,
    journal,
    finality,
    holdingIndexer,
    deriveWithdrawalCoins,
    reviewWithdrawal,
  } = options;
  const runtime = { ...options };
  const { coinPublicKey, encryptionPublicKey } = options.walletKeys;
  if (
    bindingId !== 'acc-s3r1.1' ||
    bindingId !== finality.bindingId ||
    options.wallet.supportsShieldedOffers !== true
  )
    throw new PassportConnectorError(
      'BindingUnsupported',
      'This host needs the pinned ACC and a value-capable wallet.',
    );
  if (networkId !== finality.networkId)
    throw new PassportConnectorError(
      'NetworkMismatch',
      'The finality source uses another network.',
    );
  return {
    journal,
    finality,
    deriveChangeCommitment: deriveMidnightContractCoinCommitment,
    reviewWithdrawal,
    async predict({ account, recipient, coin, amount }) {
      if (recipient !== coinPublicKey)
        throw new PassportConnectorError(
          'TransferInvalid',
          'This host only supports payouts to its configured shielded wallet.',
        );
      const { sent, change } = await deriveWithdrawalCoins(coin, amount);
      if (!change || sent.value !== amount || toHex(sent.color) !== toHex(coin.color))
        throw new PassportConnectorError(
          'TransferInvalid',
          'The selected withdrawal must produce change.',
        );
      const payoutCommitment = ZswapOutput.new(
        { type: toHex(sent.color), nonce: toHex(sent.nonce), value: sent.value },
        undefined,
        coinPublicKey,
        encryptionPublicKey,
      ).commitment;
      return {
        inputNullifier: await holdingIndexer.coinNullifier(account, coin, coin.mt_index),
        payoutCommitment,
        change,
      };
    },
    submitOriginal: (requestId, call) => submitStagedShieldedWithdrawal(requestId, call, runtime),
  };
}
