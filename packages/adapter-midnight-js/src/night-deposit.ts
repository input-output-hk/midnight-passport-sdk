import { CompiledContract } from '@midnight-ntwrk/compact-js';
import { createUnprovenCallTx } from '@midnight-ntwrk/midnight-js-contracts';
import { FetchZkConfigProvider } from '@midnight-ntwrk/midnight-js-fetch-zk-config-provider';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import {
  createWalletProvider,
  encodeContractKeyLocation,
  hashVerifierKey,
} from '@midnight-ntwrk/midnight-js-types';
import type { NetworkConfig, Prover } from '@input-output-hk/mn-passport-account/ports';
import {
  ContractCall,
  ContractCallPrototype,
  ContractState,
  Intent,
  type LedgerParameters,
  QueryContext,
  Transaction,
  communicationCommitmentRandomness,
} from '@midnightntwrk/ledger-v9';
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

/** The pinned Compact 0.35 call may claim only the bytes this state actually deletes. */
export function measuredAccNightDeletionCredit(
  transcript: Parameters<QueryContext['runTranscript']>[0],
  state: ContractState,
  parameters: LedgerParameters,
  target: string,
): bigint {
  if (!ADDRESS.test(target)) throw new Error('Invalid pinned NIGHT deposit ACC.');
  const data = ContractState.deserialize(state.serialize()).data;
  const model = parameters.transactionCostModel.runtimeCostModel;
  const context = () => new QueryContext(data, target);
  const gather = transcript.program.map((part) =>
    typeof part === 'object' && 'popeq' in part ? { popeq: { ...part.popeq, result: null } } : part,
  );
  const credit = context().query(gather, model).gasCost.bytesDeleted;
  if (credit <= 0n || credit > transcript.gas.bytesDeleted)
    throw new Error('The pinned NIGHT deposit deletion credit is outside the declared budget.');
  context().runTranscript(
    { ...transcript, gas: { ...transcript.gas, bytesDeleted: credit } },
    model,
  );
  return credit;
}

type UnsubmittedDeposit = Awaited<ReturnType<typeof createUnprovenCallTx>>;

function pinnedDepositCall(callData: UnsubmittedDeposit, target: string) {
  const original = callData.private.unprovenTx;
  const intents = [...(original.intents?.values() ?? [])];
  const oldIntent = intents[0];
  const [call] = callData.calls;
  const [guaranteed, fallible] = call?.public.partitionedTranscript ?? [];
  const [existing] = oldIntent?.actions ?? [];
  const entry =
    existing instanceof ContractCall && typeof existing.entryPoint === 'string'
      ? existing.entryPoint
      : existing instanceof ContractCall && existing.entryPoint instanceof Uint8Array
        ? new TextDecoder().decode(existing.entryPoint)
        : undefined;
  if (
    !call ||
    callData.calls.length !== 1 ||
    String(call.contractAddress) !== target ||
    String(call.circuitId) !== 'deposit_unshielded' ||
    intents.length !== 1 ||
    !oldIntent ||
    oldIntent.actions.length !== 1 ||
    !(existing instanceof ContractCall) ||
    existing.address !== target ||
    entry !== 'deposit_unshielded' ||
    !guaranteed ||
    fallible ||
    guaranteed.gas.bytesDeleted <= 0n ||
    original.guaranteedOffer ||
    original.fallibleOffer?.size
  )
    throw new Error('The pinned NIGHT deposit is not one supported guaranteed call.');
  return { oldIntent, call, guaranteed };
}

function rebuildMeasuredDeposit(
  callData: UnsubmittedDeposit,
  state: ContractState,
  parameters: LedgerParameters,
  target: string,
  networkId: string,
): ReturnType<typeof Transaction.fromPartsRandomized> {
  const { oldIntent, call, guaranteed } = pinnedDepositCall(callData, target);
  const operation = ContractState.deserialize(state.serialize()).operation('deposit_unshielded');
  if (!operation) throw new Error('The named NIGHT recipient lacks the pinned deposit operation.');
  const keyLocation = encodeContractKeyLocation({
    contractAddress: target,
    circuitId: 'deposit_unshielded',
    verifierKeyHash: hashVerifierKey(operation.verifierKey),
  });
  const credit = measuredAccNightDeletionCredit(guaranteed, state, parameters, target);
  const safe = { ...guaranteed, gas: { ...guaranteed.gas, bytesDeleted: credit } };
  const prototype = new ContractCallPrototype(
    target,
    'deposit_unshielded',
    operation,
    safe,
    undefined,
    call.private.privateTranscriptOutputs,
    call.private.input,
    call.private.output,
    communicationCommitmentRandomness(),
    keyLocation,
  );
  const intent = Intent.new(oldIntent.ttl).addCall(prototype);
  intent.guaranteedUnshieldedOffer = oldIntent.guaranteedUnshieldedOffer;
  intent.fallibleUnshieldedOffer = oldIntent.fallibleUnshieldedOffer;
  const adjusted = Transaction.fromPartsRandomized(networkId, undefined, undefined, intent);
  const [action] = [...(adjusted.intents?.values() ?? [])].flatMap((part) => part.actions);
  if (
    !(action instanceof ContractCall) ||
    action.guaranteedTranscript?.gas.bytesDeleted !== credit ||
    action.guaranteedTranscript.program.length !== guaranteed.program.length
  )
    throw new Error('The pinned NIGHT deposit gas correction changed the call.');
  return adjusted;
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
  const captured: {
    snapshot: Awaited<ReturnType<typeof publicDataProvider.queryZSwapAndContractState>>;
  } = { snapshot: null };
  const pinnedProvider = new Proxy(publicDataProvider, {
    get(provider, property) {
      if (property === 'queryZSwapAndContractState')
        return async (...args: Parameters<typeof provider.queryZSwapAndContractState>) => {
          const snapshot = await provider.queryZSwapAndContractState(...args);
          if (args[0] === target) captured.snapshot = snapshot;
          return snapshot;
        };
      const value = Reflect.get(provider, property, provider);
      return typeof value === 'function' ? value.bind(provider) : value;
    },
  });
  const callData = await createUnprovenCallTx(
    { publicDataProvider: pinnedProvider, zkConfigProvider, walletProvider },
    {
      compiledContract,
      contractAddress: target,
      circuitId: 'deposit_unshielded',
      args: [new Uint8Array(32), amount],
    } as never,
  );
  if (!captured.snapshot) throw new Error('The named NIGHT recipient ACC is absent.');
  const [, state, parameters] = captured.snapshot;
  // Compact 0.35 pads deleted bytes on this Ledger 9 profile. The ACC NIGHT
  // deposit needs its earned credit, so measure it against the same indexed
  // state and cost model before proving the exact call.
  const unprovenTx = rebuildMeasuredDeposit(callData, state, parameters, target, network.networkId);
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
