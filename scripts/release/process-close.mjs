// Cooperative control plus independent observation; never kill an external PID.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { readProcessLaunch, admitControlSocket } from './process-launch.mjs';
import { processClaim, processRecord } from './process-record.mjs';
import { originalProcessAlive, groupQuiescent, processIdentityHash } from './process-identity.mjs';
import { processRequest } from './process-protocol.mjs';

/** @param {string} directory @param {string} expected @param {number} [budgetMs] */
export async function closeRecordedProcess(directory, expected, budgetMs = 8_000) {
  const { launch, key } = readProcessLaunch(directory, expected, false);
  const end = performance.now() + budgetMs;
  try {
    // A killed controller can precede the worker's first acknowledgement. Do not
    // infer absence from a missing file; wait boundedly, then retain uncertainty.
    while (!existsSync(join(directory, 'worker-claim.json')) && performance.now() < end)
      await delay(50);
    const identity = processClaim(directory, expected);
    let attempted = false;
    while (performance.now() < end) {
      const alive = originalProcessAlive(identity);
      if (!alive && groupQuiescent(identity))
        return { closed: true, identitySha256: processIdentityHash(identity), externalSignals: 0 };
      if (alive && !attempted && existsSync(join(directory, 'record.json'))) {
        const record = processRecord(directory, expected);
        if (record.socket && ['ready', 'admitted'].includes(record.phase)) {
          attempted = true;
          const path = admitControlSocket(launch, record.socket);
          try {
            await processRequest(
              path,
              key,
              expected,
              processIdentityHash(identity),
              'shutdown',
              Math.max(1, Math.min(3_000, end - performance.now())),
            );
          } catch {
            // A lost reply proves neither closure nor a failed self-exit. Observe
            // the original identity and group; never resend or signal a fallback.
          }
        }
      }
      await delay(50);
    }
    return { closed: false, identitySha256: processIdentityHash(identity), externalSignals: 0 };
  } finally {
    key.fill(0);
  }
}
