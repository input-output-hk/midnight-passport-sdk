import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { ServiceConfig } from './config.ts';
import { DeploymentLog } from './deployments.ts';
import type {
  SetupModule,
  WaveDeployModule,
  WitnessesModule,
  SignerModule,
  ProofProviderModule,
  LedgerModule,
  ZkConfigModule,
  DeployBuilder,
  ProtocolModule,
} from './reference-runtime.ts';
import { z } from 'zod';
const networkModule = z.object({
  CONFIG: z.object({
    networkId: z.string(),
    indexer: z.string(),
    indexerWS: z.string(),
    node: z.string(),
    proofServer: z.string(),
  }),
});

/**
 * Imports a module by absolute path and checks that it still exports what this file calls, so a
 * change in the reference client fails at start-up with a clear message, not on a request.
 */
export async function loadReferenceModule<T>(
  file: string,
  names: readonly (keyof T & string)[],
  statics: Partial<Record<keyof T, readonly string[]>> = {},
): Promise<T> {
  const mod = (await import(pathToFileURL(file).href)) as Record<string, unknown>;
  for (const name of names) {
    const value = mod[name];
    if (typeof value !== 'function') {
      throw new Error(
        `passport-service: ${file} does not export ${name}(); reference client changed`,
      );
    }
    for (const member of statics[name] ?? []) {
      const capability: unknown = Reflect.get(value, member);
      if (typeof capability !== 'function')
        throw new Error(`passport-service: reference export ${name}.${member}() is unavailable`);
    }
  }
  return mod as T;
}

/** Select the same verified ACC asset root for compiled-contract construction. */
export async function selectedAccountSetup(
  config: Pick<ServiceConfig, 'contractDir' | 'artefactDir'>,
  setup: SetupModule,
  resolvePackage: (name: string) => string,
): Promise<SetupModule> {
  const referenceAssets = join(config.contractDir, 'contracts/managed/account');
  if (config.artefactDir === referenceAssets) return setup;
  const packagePath = resolvePackage('@midnight-ntwrk/compact-js/package.json');
  const packageInfo = JSON.parse(readFileSync(packagePath, 'utf8')) as {
    version?: unknown;
    exports?: { '.': { import?: unknown } };
  };
  if (
    packageInfo.version !== '3.0.0-rc.3' ||
    packageInfo.exports?.['.']?.import !== './dist/esm/index.js'
  )
    throw new Error(
      'passport-service: reference Compact runtime differs from the pinned asset selector',
    );
  const compact = (await import(
    pathToFileURL(join(dirname(packagePath), 'dist/esm/index.js')).href
  )) as {
    CompiledContract?: {
      getCompiledAssetsPath?: (contract: unknown) => string;
      withCompiledFileAssets?: (contract: unknown, path: string) => unknown;
    };
  };
  const getAssets = compact.CompiledContract?.getCompiledAssetsPath;
  const withAssets = compact.CompiledContract?.withCompiledFileAssets;
  if (
    typeof getAssets !== 'function' ||
    typeof withAssets !== 'function' ||
    getAssets(setup.compiledAccountContract()) !== referenceAssets
  )
    throw new Error('passport-service: reference compiled ACC assets differ from the pinned tree');
  return {
    ...setup,
    compiledAccountContract: () => withAssets(setup.compiledAccountContract(), config.artefactDir),
  };
}

/** Preserve the reference providers only when they already use the selected ACC root. */
export function selectedAccountProviders<T extends { readonly zkConfigProvider: unknown }>(
  config: Pick<ServiceConfig, 'contractDir' | 'artefactDir' | 'proofServerUri'>,
  providers: T,
  registry: unknown,
  zkConfig: ZkConfigModule,
  proofProvider: ProofProviderModule,
) {
  if (config.artefactDir === join(config.contractDir, 'contracts/managed/account'))
    return providers;
  return {
    ...providers,
    zkConfigProvider: new zkConfig.NodeZkConfigProvider(config.artefactDir),
    proofProvider: proofProvider.httpClientProofProvider(config.proofServerUri, registry),
  };
}

export async function loadReferenceModules(config: ServiceConfig) {
  const root = (rel: string) => join(config.contractDir, rel);
  // Resolves the midnight-js packages from the contract tree's own node_modules, whatever their
  // internal layout.
  const requireFromTree = createRequire(root('package.json'));
  const pkg = (name: string) => requireFromTree.resolve(name);

  // setup.ts pulls in node/wallet.ts, which selects the network (MIDNIGHT_NETWORK, default
  // `local`) and, once patched by patch-endpoints.sh, reads CONFIG.local from the same MN_* variables
  // as config.ts.
  const setup = await loadReferenceModule<SetupModule>(root('src/node/setup.ts'), [
    'setupWallet',
    'compiledAccountContract',
  ]);
  // /config advertises the service's stack to the browser; it must be the one the reference wallet
  // actually uses, or the browser would read a different chain from the one sponsored (M5).
  const parsedNetwork = networkModule.safeParse(
    await import(pathToFileURL(root('src/node/wallet.ts')).href),
  );
  if (!parsedNetwork.success) throw new Error('passport-service: invalid reference wallet CONFIG');
  const { CONFIG } = parsedNetwork.data;
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
  const waves = await loadReferenceModule<WaveDeployModule>(root('src/wallet/wave-deploy.ts'), [
    'deployAccountInWaves',
    'allCircuits',
    'planWaves',
  ]);
  const witnesses = await loadReferenceModule<WitnessesModule>(root('src/wallet/witnesses.ts'), [
    'emptyCoinStore',
  ]);
  const signer = await loadReferenceModule<SignerModule>(
    root('src/wallet/signer.ts'),
    ['JubjubDevice'],
    { JubjubDevice: ['generate'] },
  );
  const proofProvider = await loadReferenceModule<ProofProviderModule>(
    pkg('@midnight-ntwrk/midnight-js-http-client-proof-provider'),
    ['httpClientProvingProvider', 'httpClientProofProvider'],
  );
  const zkConfig = await loadReferenceModule<ZkConfigModule>(
    pkg('@midnight-ntwrk/midnight-js-node-zk-config-provider'),
    ['nodeZkConfigRegistry', 'NodeZkConfigProvider'],
  );

  // The reference setup fixes the old account asset path. For an explicit alternate root,
  // rebind the compiled contract and BOTH verifier/proof providers to the verified tree.
  // A partial override would deploy one roster while proving another.
  const selectedSetup = await selectedAccountSetup(config, setup, pkg);

  // The ledger classes the sponsor policy inspects a transaction with. Resolved from the same
  // tree, so `instanceof` holds against the transactions the wallet's own module deserialises.
  const ledger = await loadReferenceModule<LedgerModule>(
    pkg('@midnightntwrk/ledger-v9'),
    ['Transaction', 'ContractCall', 'ContractDeploy', 'MaintenanceUpdate', 'CostModel'],
    { Transaction: ['deserialize'], CostModel: ['initialCostModel'] },
  );
  const deployments = new DeploymentLog(config);

  // The sponsor: the reference wallet over the configured seed, synced once. The seed goes in
  // here and nowhere else; it is never logged or returned.
  // A registry over the account bundle only: delegated proving serves the binding's circuits.
  const registry = await zkConfig.nodeZkConfigRegistry(config.artefactDir);
  const proving = proofProvider.httpClientProvingProvider(config.proofServerUri, registry);
  const { providers: walletProviders } = await setup.setupWallet(config.sponsorSeed);
  const providers = selectedAccountProviders(
    config,
    walletProviders,
    registry,
    zkConfig,
    proofProvider,
  );

  const contracts = await loadReferenceModule<DeployBuilder>(
    pkg('@midnight-ntwrk/midnight-js-contracts'),
    ['createUnprovenDeployTx'],
  );
  const protocol = await loadReferenceModule<ProtocolModule>(
    pkg('@midnight-ntwrk/midnight-js-protocol'),
    ['versionOfRecord'],
  );
  const hostLedger = await loadReferenceModule<LedgerModule>(
    pkg('@midnightntwrk/ledger-v9'),
    [
      'Transaction',
      'ContractState',
      'ContractDeploy',
      'ContractMaintenanceAuthority',
      'Intent',
      'MaintenanceUpdate',
      'ReplaceAuthority',
      'VerifierKeyInsert',
      'ContractOperationVersionedVerifierKey',
      'signData',
      'ContractCall',
      'CostModel',
      'signatureVerifyingKey',
    ],
    {
      Transaction: ['deserialize', 'fromParts'],
      ContractState: ['deserialize'],
      Intent: ['new'],
      CostModel: ['initialCostModel'],
    },
  );

  return {
    providers,
    proving,
    setup: selectedSetup,
    waves,
    signer,
    witnesses,
    ledger,
    contracts,
    protocol,
    hostLedger,
    deployments,
  };
}
