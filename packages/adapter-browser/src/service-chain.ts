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
export function serviceProofProvider(
  base: string,
  fetchFn: FetchLike,
  proveTimeoutMs?: number,
): ProofProvider {
  return createProofProvider(delegatedProvingProvider(base, fetchFn, proveTimeoutMs));
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

/**
 * The chain seam over the service.
 *
 * Side effect: this calls midnight-js's `setNetworkId`, which is module-global state, so one page
 * can be bound to one network at a time.
 *
 * Throws `ArtefactIntegrity` when the app's pin is not a 64-hex-character SHA-256, or when the
 * service's manifest hash differs from it (Ruling R18). The pin is the app's own, never the service's: a compromised service could
 * otherwise serve tampered artefacts together with a matching hash.
 */
export function createServiceChain(opts: {
  serviceUrl: string;
  config: ServiceConfigWire;
  /** The app's build-time SHA-256 of the artefacts' `contract-manifest.json`. */
  expectedManifestSha256: string;
  module: GeneratedAccModule;
  fetchFn?: FetchLike;
  /** Replaces the indexer-backed reader; a test seam, so `readLedger` needs no indexer. */
  publicDataProvider?: PublicDataProvider;
  /** Replaces midnight-js's `submitCallTx`; a test seam, so `call` needs no node. */
  submit?: typeof submitCallTx;
}): ChainSeam {
  const { serviceUrl, config, module } = opts;
  // The pin must be a SHA-256 itself: an empty or short pin would otherwise match an equally empty
  // /config value and be refused only at the first verifier-key fetch (Final review M1).
  if (!/^[0-9a-f]{64}$/i.test(opts.expectedManifestSha256)) {
    throw new PassportConnectorError(
      'ArtefactIntegrity',
      `the app's artefact manifest pin is not 64 hex characters (${JSON.stringify(opts.expectedManifestSha256)})`,
    );
  }
  const pin = opts.expectedManifestSha256.toLowerCase();
  if (config.manifestSha256.toLowerCase() !== pin) {
    throw new PassportConnectorError(
      'ArtefactIntegrity',
      `the service's artefact manifest (${config.manifestSha256}) is not the one this app pins (${opts.expectedManifestSha256})`,
    );
  }
  const fetchFn = opts.fetchFn ?? defaultFetch;
  const submit = opts.submit ?? submitCallTx;
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
      expectedManifestHash: pin,
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
      if (!Array.isArray(hashes) || !hashes.every((h): h is string => typeof h === 'string')) {
        throw new PassportConnectorError(
          'InternalError',
          '/deploy answered no "txHashes" list of strings',
        );
      }
      return { address: stringMember(answer, 'address', '/deploy'), txHashes: hashes };
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
      const result = await submit(providers, {
        compiledContract,
        contractAddress: address,
        circuitId: circuit,
        args,
      } as never);
      // `public` is the finalized record: `txId` is an identifier of the submission and `txHash`
      // the hash of the transaction as included, which is what `PassportTxResult` names.
      const { txHash, blockHeight } = result.public;
      return { txHash, blockHeight };
    },
  };
}
