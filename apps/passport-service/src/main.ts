import type { AddressInfo } from 'node:net';
import { bindingCircuits } from './artefacts.ts';
import { assertPinnedBinding } from './binding-pin.ts';
import { loadConfig } from './config.ts';
import { loadReferenceBackend } from './reference-backend.ts';
import { chainRoute } from './routes/chain.ts';
import { registryRoute } from './routes/registry.ts';
import { demoFundingRoute } from './routes/demo-funding.ts';
import { configRoute, pinnedZkRoute } from './routes/zk.ts';
import { createServer } from './server.ts';
import { directoryFile } from './deployments.ts';
import {
  createDeploymentBudget,
  createMemoryJobStore,
  createFileDirectoryStore,
  directoryRoute,
  json,
  jobsRoute,
  serial,
  v1ChainRoute,
} from '@input-output-hk/mn-passport-service';

const config = loadConfig(process.env);
assertPinnedBinding(config);
const artefactRoute = pinnedZkRoute(config);
console.log(
  `passport-service: artefacts verified (${config.bindingId}, manifest ${config.manifestSha256.slice(0, 12)}…)`,
);
const backend = await loadReferenceBackend(config);
const runExclusive = serial(8);
const deploymentBudget = createDeploymentBudget(config.maxDeploys);
const jobs = createMemoryJobStore();
const directory = createFileDirectoryStore(directoryFile(config.registryFile));
const demoFunding = demoFundingRoute(config, process.env);
const server = createServer(config, [
  async (request, response, url) => {
    if (request.method !== 'GET' || url.pathname !== '/healthz') return false;
    json(response, 200, {
      status: 'ready',
      networkId: config.networkId,
      bindingId: config.bindingId,
      manifestSha256: config.manifestSha256,
    });
    return true;
  },
  configRoute(config, () => backend.sponsorKeys()),
  ...(demoFunding ? [demoFunding] : []),
  artefactRoute,
  registryRoute(config),
  directoryRoute({ networkId: config.networkId, store: directory }),
  jobsRoute(jobs),
  v1ChainRoute(backend, { jobs, deploymentBudget, runExclusive }),
  chainRoute(backend, {
    circuits: bindingCircuits(config.artefactDir),
    maxDeploys: config.maxDeploys,
    deploymentBudget,
    runExclusive,
  }),
]);
server.listen(config.port, config.host, () => {
  const { address, port } = server.address() as AddressInfo;
  console.log(`passport-service: http://${address}:${port} (network ${config.networkId})`);
});
