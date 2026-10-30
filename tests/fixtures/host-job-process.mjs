import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  createHostMutationExecutor,
  createHostMutationJobs,
  encryptedHostJobStore,
  encryptedHostMutationStore,
} from '../../packages/service/dist/index.js';
import { descriptor, servicePins } from './host-jobs.mjs';
const [mode, root] = process.argv.slice(2);
if (!root || !['before-execute', 'after-send'].includes(mode ?? ''))
  throw new Error('Invalid test worker input.');
const jobsStore = encryptedHostJobStore(join(root, 'jobs'), new Uint8Array(32).fill(7));
const hostStore = encryptedHostMutationStore(join(root, 'host'), new Uint8Array(32).fill(8));
const identifier = '00' + '01'.repeat(32);
async function hold() {
  setInterval(() => {}, 1000); // Real hosts have a listening socket; retain this owned test worker until killed.
  await new Promise((resolve, reject) =>
    process.stdout.write('claimed\n', (error) => (error ? reject(error) : resolve(undefined))),
  );
  await new Promise(() => {});
}
/** @type {import('../../packages/service/dist/index.js').HostMutationDriver} */
const driver = {
  prepare: async () => ({ address: 'ab'.repeat(32), steps: 1, context: {} }),
  prepareStep: async () => ({ tx: 'ab', identifiers: [identifier] }),
  submit: async () => {
    await writeFile(
      join(root, 'ledger.json'),
      JSON.stringify({ identifier, txHash: 'ef'.repeat(32), succeeded: true }),
      { flag: 'wx', mode: 0o600 },
    );
    await hold();
    return identifier;
  },
  lookup: async () => undefined,
  check: async () => true,
};
const host = createHostMutationExecutor(hostStore, driver);
const executor = {
  ...host,
  execute: async (
    /** @type {import('../../packages/service/dist/index.js').HostMutationIdentity} */ i,
    /** @type {import('../../packages/service/dist/index.js').HostJson} */ input,
  ) => {
    if (mode === 'before-execute') await hold();
    return host.execute(i, input);
  },
};
const jobs = createHostMutationJobs(jobsStore, executor, { pins: servicePins });
const a = await jobs.accept(descriptor());
await jobs.start(a.jobId);
await jobs.drain();
