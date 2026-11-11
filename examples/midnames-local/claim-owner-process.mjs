import { fork } from 'node:child_process';

/** The local fixture passes public settings in and accepts one proved reply. */
export function proveInOwnerProcess(input, browser = false) {
  const entry = browser ? './claim-owner-browser-host.mjs' : './claim-owner-worker.mjs';
  const child = fork(new URL(entry, import.meta.url), [], {
    env: browser
      ? { PLAYWRIGHT_CHROMIUM_EXECUTABLE: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE }
      : {},
    serialization: 'advanced',
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    execArgv: ['--experimental-import-meta-resolve'],
    signal: AbortSignal.timeout(browser ? 150_000 : 120_000),
    killSignal: browser ? 'SIGINT' : 'SIGTERM',
  });
  return new Promise((resolve, reject) => {
    let result;
    let invalid = false;
    let failedAt;
    child.on('error', () => {
      invalid = true;
    });
    child.on('message', (reply) => {
      if (
        reply &&
        Object.keys(reply).length === 1 &&
        ['initialize', 'prepare', 'prove'].includes(reply.failedAt)
      ) {
        invalid = true;
        failedAt = reply.failedAt;
        return;
      }
      if (
        result ||
        !reply ||
        Object.keys(reply).length !== (browser ? 3 : 2) ||
        (browser && reply.restored !== true) ||
        typeof reply.ownerCommitment !== 'string' ||
        !/^[0-9a-f]{64}$/.test(reply.ownerCommitment) ||
        !(reply.bytes instanceof Uint8Array) ||
        !reply.bytes.length ||
        reply.bytes.length > 1024 * 1024
      ) {
        invalid = true;
        return;
      }
      result = {
        ownerCommitment: reply.ownerCommitment,
        bytes: reply.bytes,
        ...(browser && { restored: true }),
      };
    });
    child.once('close', (code, signal) => {
      if (!invalid && code === 0 && !signal && result) resolve(result);
      else
        reject(
          new Error(
            failedAt
              ? `Standalone owner process failed at ${failedAt}.`
              : 'Standalone owner proving process failed.',
          ),
        );
    });
    child.send(input, (error) => {
      if (error) {
        invalid = true;
        child.kill();
      }
    });
  });
}
