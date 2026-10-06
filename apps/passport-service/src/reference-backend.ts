import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { ChainBackend } from './backend.ts';
import type { ServiceConfig } from './config.ts';
import { serial } from './queue.ts';

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
  // `local`: the 'undeployed' localnet endpoints hard-coded there).
  const setup = await loadModule<SetupModule>(root('src/node/setup.ts'), [
    'setupWallet',
    'compiledAccountContract',
  ]);
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

  // The sponsor: the reference wallet over the configured seed, synced once. The seed goes in
  // here and nowhere else; it is never logged or returned.
  const { providers } = await setup.setupWallet(config.sponsorSeed);

  // A registry over every compiled bundle, so a proof can resolve its circuit's keys.
  const registry = await zkConfig.nodeZkConfigRegistry(root('contracts/managed'));
  const proving = proofProvider.httpClientProvingProvider(config.proofServerUri, registry);

  // The sponsor wallet balances and submits one deployment at a time: concurrent waves would
  // race for the same Dust.
  const deployQueue = serial();

  return {
    check: (preimage, keyLocation) => proving.check(preimage, keyLocation),
    prove: (preimage, keyLocation, overwriteBindingInput) =>
      proving.prove(preimage, keyLocation, overwriteBindingInput),
    balance: async (tx) => {
      const balanced = await providers.walletProvider.balanceTx(tag(tx));
      return balanced.tx.serialize();
    },
    submit: (tx) => providers.midnightProvider.submitTx(tag(tx)),
    deploy: (boot, encKey) =>
      deployQueue(async () => {
        // Records every transaction id the waves submit; the reference returns the address only.
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
        const address = await waves.deployAccountInWaves(
          recording,
          setup.compiledAccountContract(),
          {
            firstArm: 'p256',
            args: [boot, encKey, birth.pk, new Uint8Array(64), 3n * 24n * 3600n],
            privateStateId: `passport-${randomBytes(8).toString('hex')}`,
            initialPrivateState: witnesses.emptyCoinStore(),
            retireAuthority: true,
          },
        );
        return { address, txHashes };
      }),
    sponsorKeys: () => ({
      coinPublicKey: providers.walletProvider.getCoinPublicKey(),
      encryptionPublicKey: providers.walletProvider.getEncryptionPublicKey(),
    }),
  };
}
