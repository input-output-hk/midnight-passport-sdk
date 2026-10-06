import { CompiledContract, type Contract } from '@midnight-ntwrk/compact-js';
import { submitCallTx } from '@midnight-ntwrk/midnight-js-contracts';
import { FetchZkConfigProvider } from '@midnight-ntwrk/midnight-js-fetch-zk-config-provider';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import {
  createMidnightProvider,
  createProofProvider,
  createWalletProvider,
  type MidnightProvider,
  type ProofProvider,
  type PublicDataProvider,
  type WalletProvider,
} from '@midnight-ntwrk/midnight-js-types';
import {
  PassportConnectorError,
  fromHex,
  toHex,
  type AccLedgerView,
  type AccPureCircuits,
  type ChainSeam,
  type FetchLike,
} from '@midnight-ntwrk/mn-passport-account';
import { Transaction } from '@midnightntwrk/ledger-v9';
import { delegatedProvingProvider } from './delegated-proving.js';
import {
  defaultFetch,
  postService,
  stringMember,
  type ServiceConfigWire,
} from './service-client.js';

export interface GeneratedAccModule {
  /** The generated `Contract` class; its witness type is the reference's coin store. */
  readonly Contract: new (witnesses: never) => Contract.Any;
  /** The generated ledger projection; `unknown` because the generated `Ledger` type stays in the artefact. */
  ledger(data: unknown): unknown;
  readonly pureCircuits: AccPureCircuits;
}

interface LedgerShape {
  booted: boolean;
  auth_nonce: bigint;
  device_epoch: bigint;
  spec_version: bigint;
  devices: { member(e: Uint8Array): boolean; size(): bigint };
}

/**
 * midnight-js's proving seam over the service. The era tag is the factory's: it unwraps the
 * `{ version: 'v9', tx }` it is given and tags the proven transaction the same way.
 */
export function serviceProofProvider(base: string, fetchFn: FetchLike): ProofProvider {
  return createProofProvider(delegatedProvingProvider(base, fetchFn));
}

/**
 * The wallet seam: the service's sponsor balances (and signs) the unbound call transaction. The
 * factory hands `balanceTx` the untagged v9 transaction out of `{ version: 'v9', tx }` and tags
 * what it returns `'v9'` again (Ruling R16(a)). The answer is a finalized transaction, which the
 * facade deserialises with the `'signature', 'proof', 'binding'` markers.
 */
export function serviceWalletProvider(
  base: string,
  keys: Pick<ServiceConfigWire, 'coinPublicKey' | 'encryptionPublicKey'>,
  fetchFn: FetchLike,
): WalletProvider {
  return createWalletProvider({
    getCoinPublicKey: () => keys.coinPublicKey,
    getEncryptionPublicKey: () => keys.encryptionPublicKey,
    // The service sets the transaction's lifetime, so the caller's `ttl` has no use here.
    async balanceTx(tx) {
      const answer = await postService(
        fetchFn,
        base,
        '/sponsor/balance',
        { tx: toHex(tx.serialize()) },
        'sponsor',
      );
      return Transaction.deserialize(
        'signature',
        'proof',
        'binding',
        fromHex(stringMember(answer, 'tx', '/sponsor/balance')),
      );
    },
  });
}

/** The submit seam: the service's sponsor submits the balanced transaction (Ruling R16(a)). */
export function serviceMidnightProvider(base: string, fetchFn: FetchLike): MidnightProvider {
  return createMidnightProvider(async (tx) => {
    const answer = await postService(
      fetchFn,
      base,
      '/sponsor/submit',
      { tx: toHex(tx.serialize()) },
      'sponsor',
    );
    return stringMember(answer, 'txId', '/sponsor/submit');
  });
}

export function createServiceChain(opts: {
  serviceUrl: string;
  config: ServiceConfigWire;
  module: GeneratedAccModule;
  fetchFn?: FetchLike;
  /** Replaces the indexer-backed reader; a test seam, so `readLedger` needs no indexer. */
  publicDataProvider?: PublicDataProvider;
}): ChainSeam {
  const { serviceUrl, config, module } = opts;
  const fetchFn = opts.fetchFn ?? defaultFetch;
  setNetworkId(config.networkId);
  // The MVP circuits never invoke the account's only witness (held_coin); refuse loudly if one does.
  const witnesses = {
    held_coin: () => {
      throw new Error('held_coin is not available in the Passport prototype');
    },
  };
  const compiledContract = CompiledContract.make('account', module.Contract as never).pipe(
    CompiledContract.withWitnesses(witnesses as never),
  );
  const publicDataProvider: PublicDataProvider =
    opts.publicDataProvider ??
    indexerPublicDataProvider({
      queryURL: config.indexerUri,
      subscriptionURL: config.indexerWsUri,
    });
  // No privateStateProvider: the MVP circuits read no private state, so a call needs none.
  const providers = {
    publicDataProvider,
    zkConfigProvider: new FetchZkConfigProvider<string>(config.zkBaseUrl, {
      verify: 'require',
      expectedManifestHash: config.manifestSha256,
    }),
    proofProvider: serviceProofProvider(serviceUrl, fetchFn),
    walletProvider: serviceWalletProvider(serviceUrl, config, fetchFn),
    midnightProvider: serviceMidnightProvider(serviceUrl, fetchFn),
  };

  return {
    async deploy(args) {
      const answer = await postService(
        fetchFn,
        serviceUrl,
        '/deploy',
        { boot: toHex(args.boot), encKey: toHex(args.encKey) },
        'sponsor',
      );
      const hashes = answer.txHashes;
      return {
        address: stringMember(answer, 'address', '/deploy'),
        txHashes: Array.isArray(hashes)
          ? hashes.filter((h): h is string => typeof h === 'string')
          : [],
      };
    },
    async readLedger(address): Promise<AccLedgerView | undefined> {
      const state = await publicDataProvider.queryContractState(address);
      if (!state) return undefined;
      const l = module.ledger(state.data) as LedgerShape;
      return {
        booted: l.booted,
        authNonce: l.auth_nonce,
        deviceEpoch: l.device_epoch,
        entryCount: Number(l.devices.size()),
        specVersion: Number(l.spec_version),
        hasEntry: (entry) => l.devices.member(entry),
      };
    },
    async call(address, circuit, args) {
      // `as never` at the one call site: the overloads are generic over the generated module's own
      // circuit and parameter types, which live outside this package.
      const result = await submitCallTx(providers, {
        compiledContract,
        contractAddress: address,
        circuitId: circuit,
        args,
      } as never);
      const { txId, blockHeight } = result.public;
      return { txHash: txId, blockHeight };
    },
  };
}
