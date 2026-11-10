// Test-only startup barriers; the production worker CLI has no barrier flags.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { runProcessWorker } from '../../scripts/release/process-worker.mjs';
const [, , , directory, , expected] = process.argv;
const root = process.env.PASSPORT_PROCESS_FIXTURE_ROOT;
if (!directory || !expected || !root) throw Error('Fixture arguments missing');
const barrier = async () => {
  const deadline = performance.now() + 5_000;
  while (!existsSync(join(root, 'release-startup')) && performance.now() < deadline)
    await delay(10);
  if (!existsSync(join(root, 'release-startup'))) throw Error('Synthetic barrier expired');
};
await runProcessWorker(
  directory,
  expected,
  process.env.PASSPORT_PROCESS_PARENT_MODE === 'before-claim'
    ? { beforeClaim: barrier }
    : { afterClaim: barrier },
);
