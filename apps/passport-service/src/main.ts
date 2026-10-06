import { verifyArtefacts } from './artefacts.ts';
import { loadConfig } from './config.ts';
import { loadReferenceBackend } from './reference-backend.ts';
import { chainRoute } from './routes/chain.ts';
import { registryRoute } from './routes/registry.ts';
import { configRoute, zkRoute } from './routes/zk.ts';
import { createServer } from './server.ts';

const config = loadConfig(process.env);
verifyArtefacts(config.artefactDir, config.manifestSha256);
console.log(
  `passport-service: artefacts verified (${config.bindingId}, manifest ${config.manifestSha256.slice(0, 12)}…)`,
);
const backend = await loadReferenceBackend(config);
const server = createServer(config, [
  configRoute(config, () => backend.sponsorKeys()),
  zkRoute(config),
  registryRoute(config),
  chainRoute(backend),
]);
server.listen(config.port, () =>
  console.log(`passport-service: http://localhost:${config.port} (network ${config.networkId})`),
);
