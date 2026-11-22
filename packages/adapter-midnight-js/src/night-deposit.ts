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
const MAX_PROVEN_BYTES = 4 * 1024 * 1024;
const NIGHT_DEPOSIT_PINS = Object.freeze({
  'acc-s3r1.1': '77fb9c17b0d59047456c43115d9a58f5cb99a226ee73b6b974fd724930c3153f',
  'acc-s3r1.1-zkir036': '590d3c97db7fce05d5ea85a9bf37c82b7032c498703a2807276ca7ae0ca52e5f',
});
const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);

function localEndpoint(value: string, protocols: readonly string[], pathname: string): boolean {
  try {
    const url = new URL(value);
    return (
      protocols.includes(url.protocol) &&
      LOOPBACK.has(url.hostname) &&
      url.pathname === pathname &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash
    );
  } catch {
    return false;
  }
}

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
  /** Explicit source-only opt-in for the provisional Ledger 9 key profile. */
  readonly provisionalLocal?: boolean;
}

/** Validate the deposit binding before reading chain state or asking the device wallet to sign. */
export function assertNightDepositPreflight(request: UnboundNightDepositRequest): void {
  const { network, binding, target, amount, walletKeys, prover, provisionalLocal } = request;
  const manifest = NIGHT_DEPOSIT_PINS[network.bindingId as keyof typeof NIGHT_DEPOSIT_PINS];
  if (
    network.networkId !== 'undeployed' ||
    !manifest ||
    network.manifestSha256 !== manifest ||
    (network.bindingId === 'acc-s3r1.1-zkir036' &&
      (!provisionalLocal ||
        !localEndpoint(network.nodeUrl, ['http:', 'https:'], '/') ||
        !localEndpoint(network.indexerUrl, ['http:', 'https:'], '/api/v4/graphql') ||
        !localEndpoint(network.indexerWsUrl, ['ws:', 'wss:'], '/api/v4/graphql/ws') ||
        !localEndpoint(network.artefactUrl, ['http:', 'https:'], '/v1/zk/acc-s3r1.1-zkir036'))) ||
    !ADDRESS.test(target) ||
    amount <= 0n ||
    amount >= 1n << 128n ||
    !walletKeys.coinPublicKey ||
    !walletKeys.encryptionPublicKey ||
    typeof binding.Contract !== 'function' ||
    typeof binding.ledger !== 'function' ||
    typeof prover.proveTx !== 'function'
  )
    throw new Error('Unsupported pinned NIGHT deposit request.');
}

/** Replace Compact 0.35's padded or short deletion credit with the measured value. */
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
  context().runTranscript(
    { ...transcript, gas: { ...transcript.gas, bytesDeleted: credit } },
    model,
  );
  return credit;
}

type UnsubmittedDeposit = Awaited<ReturnType<typeof createUnprovenCallTx>>;

function matchesCallPartition(existing: unknown, guaranteed: unknown, fallible: unknown): boolean {
  return (
    existing instanceof ContractCall &&
    Boolean(existing.guaranteedTranscript) === Boolean(guaranteed) &&
    Boolean(existing.fallibleTranscript) === Boolean(fallible)
  );
}

function pinnedDepositCall(callData: UnsubmittedDeposit, target: string) {
  const original = callData.private.unprovenTx;
  const intents = [...(original.intents?.values() ?? [])];
  const oldIntent = intents[0];
  const [call] = callData.calls;
  const [guaranteed, fallible] = call?.public.partitionedTranscript ?? [];
  const transcript = guaranteed ?? fallible;
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
    !transcript ||
    Boolean(guaranteed) === Boolean(fallible) ||
    !matchesCallPartition(existing, guaranteed, fallible) ||
    original.guaranteedOffer ||
    original.fallibleOffer?.size
  )
    throw new Error('The pinned NIGHT deposit is not one supported call.');
  return { oldIntent, call, guaranteed, fallible, transcript };
}

export function rebuildMeasuredDeposit(
  callData: UnsubmittedDeposit,
  state: ContractState,
  parameters: LedgerParameters,
  target: string,
  networkId: string,
  keyLocation: string,
): ReturnType<typeof Transaction.fromPartsRandomized> {
  const { oldIntent, call, guaranteed, fallible, transcript } = pinnedDepositCall(callData, target);
  const operation = ContractState.deserialize(state.serialize()).operation('deposit_unshielded');
  if (!operation) throw new Error('The named NIGHT recipient lacks the pinned deposit operation.');
  const credit = measuredAccNightDeletionCredit(transcript, state, parameters, target);
  const safe = { ...transcript, gas: { ...transcript.gas, bytesDeleted: credit } };
  const prototype = new ContractCallPrototype(
    target,
    'deposit_unshielded',
    operation,
    guaranteed ? safe : undefined,
    fallible ? safe : undefined,
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
    (guaranteed ? action.guaranteedTranscript : action.fallibleTranscript)?.gas.bytesDeleted !==
      credit ||
    (guaranteed ? action.guaranteedTranscript : action.fallibleTranscript)?.program.length !==
      transcript.program.length ||
    Boolean(action.guaranteedTranscript) !== Boolean(guaranteed) ||
    Boolean(action.fallibleTranscript) !== Boolean(fallible)
  )
    throw new Error('The pinned NIGHT deposit gas correction changed the call.');
  return adjusted;
}

/** Prove only the pinned ACC call; the device wallet must inspect, balance, sign and fence it. */
export async function proveUnboundNightDeposit(
  request: UnboundNightDepositRequest,
): Promise<Uint8Array> {
  const { network, binding, target, amount, walletKeys, prover } = request;
  assertNightDepositPreflight(request);
  if (network.bindingId !== 'acc-s3r1.1')
    throw new Error('Provisional NIGHT deposit proof is not qualified.');
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
  const operation = ContractState.deserialize(state.serialize()).operation('deposit_unshielded');
  if (!operation) throw new Error('The named NIGHT recipient lacks the pinned deposit operation.');
  const keyLocation = encodeContractKeyLocation({
    contractAddress: target,
    circuitId: 'deposit_unshielded',
    verifierKeyHash: hashVerifierKey(operation.verifierKey),
  });
  // Compact 0.35 can pad or understate deleted bytes on this Ledger 9 profile.
  // The ACC NIGHT deposit needs its earned credit, so measure it against the same indexed
  // state and cost model before proving the exact call.
  const unprovenTx = rebuildMeasuredDeposit(
    callData,
    state,
    parameters,
    target,
    network.networkId,
    keyLocation,
  );
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
