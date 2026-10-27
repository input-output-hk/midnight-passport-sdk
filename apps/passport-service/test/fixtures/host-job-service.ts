// Synthetic service transport fixture: real reference configuration/HTTP/encrypted journals,
// fake chain receipts. Never run this fixture as a production host or native qualification.
import { createHash } from 'node:crypto';
import { readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { configuredHostMutations } from '../../src/host-config.ts';
import { serviceShutdown, shutdownHandler } from '../../src/shutdown.ts';
import type { ServiceConfig } from '../../src/config.ts';
import {
  createServer,
  createDeploymentBudget,
  serial,
  json,
  type HostMutationDriver,
  type HostConfirmation,
} from '@input-output-hk/mn-passport-service';
const [root, mode = 'normal', arm = 'jubjub'] = process.argv.slice(2);
if (
  !root ||
  !['normal', 'before-host', 'after-send'].includes(mode) ||
  !['jubjub', 'p256'].includes(arm)
)
  throw new Error('invalid fixture arguments');
const config: ServiceConfig = {
  networkId: 'undeployed',
  bindingId: 'acc-s3r1.1',
  manifestSha256: '77fb9c17b0d59047456c43115d9a58f5cb99a226ee73b6b974fd724930c3153f',
  host: '127.0.0.1',
  port: 0,
  corsOrigin: 'http://localhost:5173',
  contractDir: root,
  artefactDir: root,
  registryFile: join(root, 'registry'),
  sponsorSeed: '55'.repeat(32),
  maxDeploys: 3,
  nodeUri: 'http://unused',
  indexerUri: 'http://unused',
  indexerWsUri: 'ws://unused',
  proofServerUri: 'http://unused',
  publicStack: {
    networkId: 'undeployed',
    nodeUri: 'http://unused',
    indexerUri: 'http://unused',
    indexerWsUri: 'ws://unused',
    proofServerUri: 'http://unused',
  },
};
const ledgerFile = join(root, 'synthetic-ledger.json');
async function ledger(): Promise<Record<string, HostConfirmation>> {
  try {
    return JSON.parse(await readFile(ledgerFile, 'utf8')) as Record<string, HostConfirmation>;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw e;
  }
}
async function emit(value: object) {
  await new Promise<void>((r, j) =>
    process.stdout.write(JSON.stringify(value) + '\n', (e) => (e ? j(e) : r())),
  );
}
async function hold() {
  const keep = setInterval(() => {}, 1000);
  try {
    await new Promise<void>(() => {});
  } finally {
    clearInterval(keep);
  }
}
const driver: HostMutationDriver = {
  async prepare(i, input) {
    const v = input as Record<string, string>;
    if (i.pins.scheme !== (arm === 'p256' ? 'p256-webauthn' : 'jubjub-schnorr'))
      throw new Error('fixture arm differs');
    if (i.kind === 'call' && v.circuit !== `append_inbox_with_${arm}`)
      throw new Error('fixture circuit differs');
    return { address: 'ab'.repeat(32), steps: i.kind === 'deploy' ? 3 : 1, context: {} };
  },
  async prepareStep(r, index) {
    const watch = createHash('sha256')
      .update(r.identity.requestId + ':' + index)
      .digest('hex');
    return { tx: '01', identifiers: [arm === 'p256' ? '00' + watch : watch] };
  },
  async submit(p) {
    const saved = await ledger(),
      id = p.identifiers[0]!;
    if (saved[id]) throw new Error('duplicate fixture send');
    saved[id] = {
      identifier: id,
      txHash: createHash('sha256').update(id).digest('hex'),
      blockHeight: Object.keys(saved).length + 1,
      succeeded: true,
    };
    const tmp = ledgerFile + '.pending';
    await writeFile(tmp, JSON.stringify(saved), { mode: 0o600 });
    await rename(tmp, ledgerFile);
    if (mode === 'after-send') {
      await emit({ boundary: 'after-send' });
      await hold();
    }
    return id;
  },
  lookup: async (p) => (await ledger())[p.identifiers[0]!],
  check: async () => true,
};
const queue = serial(8);
let held = false;
const run: ReturnType<typeof serial> = async (work) =>
  queue(async () => {
    if (mode === 'before-host' && !held) {
      held = true;
      await emit({ boundary: 'before-host' });
      await hold();
    }
    return work();
  });
Object.assign(run, { drain: queue.drain });
const env = {
  PASSPORT_HOST_MUTATION_DIR: join(root, 'host'),
  PASSPORT_HOST_MUTATION_KEY_FILE: join(root, 'host-key'),
  PASSPORT_HOST_MUTATION_TOKEN_FILE: join(root, 'host-token'),
  PASSPORT_HOST_JOB_DIR: join(root, 'jobs'),
  PASSPORT_HOST_JOB_KEY_FILE: join(root, 'job-key'),
  PASSPORT_HOST_JOB_TOKEN_FILE: join(root, 'job-token'),
};
const budget = createDeploymentBudget(config.maxDeploys),
  host = configuredHostMutations(config, driver, env, run, () => budget.accept());
const server = createServer(config, [
  async (req, res, url) => {
    if (req.method === 'GET' && url.pathname === '/healthz') {
      json(res, 200, { status: 'ready', hostJobs: host?.hostJobs ?? false });
      return true;
    }
    return false;
  },
  ...(host ? [host] : []),
]);
server.listen(0, '127.0.0.1', () => {
  const address = server.address();
  if (!address || typeof address !== 'object') throw new Error('no address');
  void emit({ ready: true, port: address.port });
});
const stop = serviceShutdown(server, host, run);
process.on('SIGTERM', shutdownHandler(stop, { deadlineMs: 150 }));
