import { createRequire } from 'node:module';
import { join } from 'node:path';
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
    ['httpClientProvingProvider'],
  );
  const zkConfig = await loadReferenceModule<ZkConfigModule>(
    pkg('@midnight-ntwrk/midnight-js-node-zk-config-provider'),
    ['nodeZkConfigRegistry'],
  );

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
  const { providers } = await setup.setupWallet(config.sponsorSeed);

  // A registry over the account bundle only: delegated proving serves the binding's circuits.
  const registry = await zkConfig.nodeZkConfigRegistry(config.artefactDir);
  const proving = proofProvider.httpClientProvingProvider(config.proofServerUri, registry);

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
    setup,
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
