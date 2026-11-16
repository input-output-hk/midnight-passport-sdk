import { CompiledContract } from '@midnight-ntwrk/compact-js';
import { createUnprovenCallTx } from '@midnight-ntwrk/midnight-js-contracts';
import { FetchZkConfigProvider } from '@midnight-ntwrk/midnight-js-fetch-zk-config-provider';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import { createWalletProvider } from '@midnight-ntwrk/midnight-js-types';
import type { NetworkConfig, Prover } from '@input-output-hk/mn-passport-account/ports';
import { Transaction } from '@midnightntwrk/ledger-v9';
import { createHeldCoinWitness, type MidnightBinding } from './chain.js';

const ADDRESS = /^[a-f0-9]{64}$/;
const MANIFEST = /^[a-f0-9]{64}$/;
const MAX_PROVEN_BYTES = 4 * 1024 * 1024;

export interface UnboundNightDepositRequest {
  readonly network: NetworkConfig;
  readonly binding: MidnightBinding;
  readonly target: string;
  readonly amount: bigint;
  readonly walletKeys: {
    readonly coinPublicKey: string;
    readonly encryptionPublicKey: string;
  };
  readonly prover: Prover;
}

/** Prove only the pinned ACC call; the device wallet must inspect, balance, sign and fence it. */
export async function proveUnboundNightDeposit(
  request: UnboundNightDepositRequest,
): Promise<Uint8Array> {
  const { network, binding, target, amount, walletKeys, prover } = request;
  if (
    network.networkId !== 'undeployed' ||
    network.bindingId !== 'acc-s3r1.1' ||
    !MANIFEST.test(network.manifestSha256) ||
    !ADDRESS.test(target) ||
    amount <= 0n ||
    amount >= 1n << 128n ||
    !walletKeys.coinPublicKey ||
    !walletKeys.encryptionPublicKey
  )
    throw new Error('Unsupported pinned NIGHT deposit request.');
  setNetworkId(network.networkId);
  const publicDataProvider = indexerPublicDataProvider({
    queryURL: network.indexerUrl,
    subscriptionURL: network.indexerWsUrl,
  });
  const zkConfigProvider = new FetchZkConfigProvider<string>(network.artefactUrl, {
    verify: 'require',
    expectedManifestHash: network.manifestSha256,
  });
  const walletProvider = createWalletProvider({
    getCoinPublicKey: () => walletKeys.coinPublicKey,
    getEncryptionPublicKey: () => walletKeys.encryptionPublicKey,
    balanceTx: async () => {
      throw new Error('Only the device-held wallet may balance a NIGHT deposit.');
    },
  });
  const compiledContract = CompiledContract.make('account', binding.Contract as never).pipe(
    CompiledContract.withWitnesses(createHeldCoinWitness() as never),
  );
  const {
    private: { unprovenTx },
  } = await createUnprovenCallTx({ publicDataProvider, zkConfigProvider, walletProvider }, {
    compiledContract,
    contractAddress: target,
    circuitId: 'deposit_unshielded',
    args: [new Uint8Array(32), amount],
  } as never);
  const proven = await prover.proveTx(unprovenTx.serialize(), {
    networkId: network.networkId,
    bindingId: network.bindingId,
    circuits: ['deposit_unshielded'],
  });
  if (proven.tx.length === 0 || proven.tx.length > MAX_PROVEN_BYTES)
    throw new Error('The NIGHT deposit prover returned an invalid transaction.');
  Transaction.deserialize('signature', 'proof', 'pre-binding', proven.tx);
  return Uint8Array.from(proven.tx);
}
