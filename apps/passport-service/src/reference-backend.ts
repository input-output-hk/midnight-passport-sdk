import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { ChainBackend } from './backend.ts';
import type { ServiceConfig } from './config.ts';
import { DeploymentLog, sponsoredAddresses } from './deployments.ts';
import { guardedBalance, type ActionClasses, type LedgerTxLike } from './sponsor-policy.ts';

/*
 * The contract team's Node client lives outside this workspace (the fetched tree at
 * `config.contractDir`), so it is imported at runtime and typed here by the few members this file
 * uses. `tsx` transpiles it; its own node_modules supplies the exactly pinned midnight-js stack.
 * No upstream code is copied into the fork.
 */

interface Serialisable {
  serialize(): Uint8Array;
}

/** The v9 era tag midnight-js puts on every transaction crossing the wallet and node seams. */
interface V9Tx {
  readonly version: 'v9';
  readonly tx: Serialisable;
}

interface MidnightProvider {
  submitTx(tx: V9Tx): Promise<string>;
}

interface Providers {
  readonly walletProvider: {
    balanceTx(tx: V9Tx, ttl?: Date): Promise<V9Tx>;
    getCoinPublicKey(): string;
    getEncryptionPublicKey(): string;
  };
  readonly midnightProvider: MidnightProvider;
}

interface ProvingProvider {
  check(preimage: Uint8Array, keyLocation: string): Promise<(bigint | undefined)[]>;
  prove(
    preimage: Uint8Array,
    keyLocation: string,
    overwriteBindingInput?: bigint,
  ): Promise<Uint8Array>;
}

interface SetupModule {
  setupWallet(seed: string): Promise<{ providers: Providers }>;
  compiledAccountContract(): unknown;
}

/** `src/node/wallet.ts`: the endpoints the reference wallet and wave deploy are wired to. */
interface ReferenceNetworkModule {
  readonly CONFIG: {
    readonly networkId: string;
    readonly indexer: string;
    readonly indexerWS: string;
    readonly node: string;
    readonly proofServer: string;
  };
}

interface WaveDeployModule {
  deployAccountInWaves(
    providers: unknown,
    compiledContract: unknown,
    options: {
      firstArm: 'p256';
      args: unknown[];
      privateStateId: string;
      initialPrivateState: unknown;
      retireAuthority: boolean;
    },
  ): Promise<string>;
}

interface WitnessesModule {
  emptyCoinStore(): unknown;
}

interface SignerModule {
  JubjubDevice: { generate(): { readonly pk: unknown } };
}

interface ProofProviderModule {
  httpClientProvingProvider(url: string, zkConfig: unknown): ProvingProvider;
}

/** `@midnightntwrk/ledger-v9`, the module instance the wallet itself uses. */
interface UnprovenTxLike {
  prove(provider: ProvingProvider, costModel: unknown): Promise<{ serialize(): Uint8Array }>;
}

interface LedgerModule extends ActionClasses {
  Transaction: {
    deserialize(
      markerS: 'signature',
      markerP: 'proof',
      markerB: 'pre-binding',
      raw: Uint8Array,
    ): LedgerTxLike;
    deserialize(
      markerS: 'signature',
      markerP: 'pre-proof',
      markerB: 'pre-binding',
      raw: Uint8Array,
    ): UnprovenTxLike;
  };
  CostModel: { initialCostModel(): unknown };
}

interface ZkConfigModule {
  nodeZkConfigRegistry(artifactRoot: string): Promise<unknown>;
}

/**
 * Imports a module by absolute path and checks that it still exports what this file calls, so a
 * change in the reference client fails at start-up with a clear message, not on a request.
 */
async function loadModule<T>(file: string, names: readonly (keyof T & string)[]): Promise<T> {
  const mod = (await import(pathToFileURL(file).href)) as Record<string, unknown>;
  for (const name of names) {
    if (typeof mod[name] !== 'function') {
      throw new Error(
        `passport-service: ${file} does not export ${name}(); reference client changed`,
      );
    }
  }
  return mod as T;
}

/** The wallet's transaction seams read only `serialize()`, so raw bytes cross them in this wrapper. */
const tag = (bytes: Uint8Array): V9Tx => ({ version: 'v9', tx: { serialize: () => bytes } });

export async function loadReferenceBackend(config: ServiceConfig): Promise<ChainBackend> {
  const root = (rel: string) => join(config.contractDir, rel);
  // Resolves the midnight-js packages from the contract tree's own node_modules, whatever their
  // internal layout.
  const requireFromTree = createRequire(root('package.json'));
  const pkg = (name: string) => requireFromTree.resolve(name);

  // setup.ts pulls in node/wallet.ts, which selects the network (MIDNIGHT_NETWORK, default
  // `local`) and, once patched by patch-endpoints.sh, reads CONFIG.local from the same MN_* variables
  // as config.ts.
  const setup = await loadModule<SetupModule>(root('src/node/setup.ts'), [
    'setupWallet',
    'compiledAccountContract',
  ]);
  // /config advertises the service's stack to the browser; it must be the one the reference wallet
  // actually uses, or the browser would read a different chain from the one sponsored (M5).
  const { CONFIG } = (await import(
    pathToFileURL(root('src/node/wallet.ts')).href
  )) as ReferenceNetworkModule;
  const expected = {
    networkId: CONFIG.networkId,
    indexerUri: CONFIG.indexer,
    indexerWsUri: CONFIG.indexerWS,
    nodeUri: CONFIG.node,
    proofServerUri: CONFIG.proofServer,
  };
  for (const [field, value] of Object.entries(expected) as [keyof typeof expected, string][]) {
    if (config[field] !== value) {
      throw new Error(
        `passport-service: ${field} is "${config[field]}", but the reference client uses "${value}"; run experiments/acc-0.35/patch-endpoints.sh on the contract tree, and give it the same MN_* variables`,
      );
    }
  }
  const waves = await loadModule<WaveDeployModule>(root('src/wallet/wave-deploy.ts'), [
    'deployAccountInWaves',
  ]);
  const witnesses = await loadModule<WitnessesModule>(root('src/wallet/witnesses.ts'), [
    'emptyCoinStore',
  ]);
  const signer = await loadModule<SignerModule>(root('src/wallet/signer.ts'), ['JubjubDevice']);
  const proofProvider = await loadModule<ProofProviderModule>(
    pkg('@midnight-ntwrk/midnight-js-http-client-proof-provider'),
    ['httpClientProvingProvider'],
  );
  const zkConfig = await loadModule<ZkConfigModule>(
    pkg('@midnight-ntwrk/midnight-js-node-zk-config-provider'),
    ['nodeZkConfigRegistry'],
  );

  // The ledger classes the sponsor policy inspects a transaction with. Resolved from the same
  // tree, so `instanceof` holds against the transactions the wallet's own module deserialises.
  const ledger = await loadModule<LedgerModule>(pkg('@midnightntwrk/ledger-v9'), [
    'Transaction',
    'ContractCall',
    'ContractDeploy',
    'MaintenanceUpdate',
    'CostModel',
  ]);
  const deployments = new DeploymentLog(config);

  // The sponsor: the reference wallet over the configured seed, synced once. The seed goes in
  // here and nowhere else; it is never logged or returned.
  const { providers } = await setup.setupWallet(config.sponsorSeed);

  // A registry over the account bundle only: delegated proving serves the binding's circuits.
  const registry = await zkConfig.nodeZkConfigRegistry(config.artefactDir);
  const proving = proofProvider.httpClientProvingProvider(config.proofServerUri, registry);

  return {
    check: (preimage, keyLocation) => proving.check(preimage, keyLocation),
    prove: (preimage, keyLocation, overwriteBindingInput) =>
      proving.prove(preimage, keyLocation, overwriteBindingInput),
    proveTx: async (bytes) => {
      const tx = ledger.Transaction.deserialize('signature', 'pre-proof', 'pre-binding', bytes);
      const proven = await tx.prove(proving, ledger.CostModel.initialCostModel());
      return proven.serialize();
    },
    // The policy guards this endpoint, not the wallet provider: the reference wave deploy calls
    // `walletProvider.balanceTx` itself for its deployment and maintenance transactions.
    balance: guardedBalance({
      // The markers are the ones the wallet facade deserialises an unbound transaction with.
      deserialize: (bytes) =>
        ledger.Transaction.deserialize('signature', 'proof', 'pre-binding', bytes),
      classes: ledger,
      allowed: () => sponsoredAddresses(config, deployments),
      balance: async (tx) => (await providers.walletProvider.balanceTx(tag(tx))).tx.serialize(),
    }),
    submit: (tx) => providers.midnightProvider.submitTx(tag(tx)),
    // The route runs deployments through the same queue as proofs, so they never overlap.
    deploy: async (boot, encKey, retireAuthority) => {
      // Records what each wave's `submitTx` returns; the reference returns the address only.
      // These are submission ids (midnight-js's txId), not the hashes of the transactions as
      // included: the wire keeps the name `txHashes` for the prototype (Final review M4).
      const txHashes: string[] = [];
      const recording: Providers = {
        ...providers,
        midnightProvider: {
          ...providers.midnightProvider,
          submitTx: async (tx) => {
            const id = await providers.midnightProvider.submitTx(tx);
            txHashes.push(String(id));
            return id;
          },
        },
      };
      // Recovery at birth, as the reference does with no artefacts supplied: a fresh JubJub key
      // whose secret is discarded here, a zero wrap, and a 3-day veto window.
      const birth = signer.JubjubDevice.generate();
      const address = await waves.deployAccountInWaves(recording, setup.compiledAccountContract(), {
        firstArm: 'p256',
        args: [boot, encKey, birth.pk, new Uint8Array(64), 3n * 24n * 3600n],
        privateStateId: `passport-${randomBytes(8).toString('hex')}`,
        initialPrivateState: witnesses.emptyCoinStore(),
        // The caller's choice (D-11). Kept, the authority's key stays with this service's wallet.
        retireAuthority,
      });
      // Only now may the sponsor fund calls to it (Ruling R15), once it is also registered.
      deployments.add(address);
      return { address, txHashes };
    },
    sponsorKeys: () => ({
      coinPublicKey: providers.walletProvider.getCoinPublicKey(),
      encryptionPublicKey: providers.walletProvider.getEncryptionPublicKey(),
    }),
  };
}
