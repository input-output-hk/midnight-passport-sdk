// Synthetic operation only. No SDK, wallet, proof, network or real account.
import { appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { spawn } from 'node:child_process';
const root = process.env.PASSPORT_PROCESS_FIXTURE_ROOT;
if (!root) throw Error('Synthetic fixture root missing');
appendFileSync(join(root, 'dispatch.log'), 'dispatch\n', { mode: 0o600 });
if (process.env.PASSPORT_PROCESS_FIXTURE_MODE === 'finish') await delay(50);
else {
  if (process.env.PASSPORT_PROCESS_FIXTURE_MODE === 'busy') {
    const end = performance.now() + 500;
    while (performance.now() < end) {
      /* Deliberately unavailable control event loop. */
    }
  }
  if (process.env.PASSPORT_PROCESS_FIXTURE_MODE === 'descendant')
    spawn(process.execPath, ['-e', 'setTimeout(()=>{},700)'], { stdio: 'ignore' });
  await delay(60_000);
}
