#!/usr/bin/env node
// Durably identify this process before GO. No source-client import before admission.
import assert from 'node:assert/strict';
import { join, resolve } from 'node:path';
import { realpathSync } from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { put, syncDirectory, object, exact } from './files.mjs';
import { saveProcessRecord, readPrivate } from './process-files.mjs';
import { readProcessLaunch } from './process-launch.mjs';
import { observeProcess, processIdentityHash, originalProcessAlive } from './process-identity.mjs';
import { processServer } from './process-server.mjs';

/** Internal barriers are for deterministic startup tests; the CLI supplies none.
 * @param {string} directory @param {string} expected
 * @param {{beforeClaim?:()=>Promise<void>,afterClaim?:()=>Promise<void>}} [barriers] */
export async function runProcessWorker(directory, expected, barriers = {}) {
  const { launch, key, launchSha256 } = readProcessLaunch(directory, expected);
  const identity = observeProcess(process.pid);
  assert.ok(identity && identity.pgid === process.pid);
  assert.equal(realpathSync(process.execPath), launch.executable);
  const base = { schema: 1, launchSha256, identity };
  await barriers.beforeClaim?.();
  put(join(directory, 'worker-claim.json'), JSON.stringify(base, null, 2) + '\n');
  syncDirectory(directory);
  await barriers.afterClaim?.();
  let phase = 'starting',
    running = false,
    closing = false;
  /** @type {{dev:number,ino:number}|null} */ let socket = null;
  const save = (/** @type {Record<string,unknown>} */ extra = {}) =>
    saveProcessRecord(directory, { ...base, phase, socket, ...extra });
  save();
  /** @type {Awaited<ReturnType<typeof processServer>>|undefined} */ let control;
  const finish = async (/** @type {number} */ code) => {
    if (closing) return;
    closing = true;
    phase = code === 0 ? 'finished' : 'closing';
    save({ requestedExitCode: code });
    clearTimeout(readyDeadline);
    await control?.close();
    key.fill(0);
    process.exit(code); // This process only. Never an external PID or group.
  };
  const readyDeadline = setTimeout(() => {
    if (!running) void finish(1);
  }, 30_000);
  const run = () => {
    assert.equal(running, false);
    running = true;
    clearTimeout(readyDeadline);
    void import(pathToFileURL(launch.program).href).then(
      () => finish(Number(process.exitCode ?? 0)),
      () => finish(1),
    );
  };
  control = await processServer({
    key,
    launchSha256,
    identitySha256: processIdentityHash(identity),
    controlDirectory: launch.controlDirectory,
    phase: () => phase,
    admitGo: () => {
      assert.equal(phase, 'ready');
      assert.equal(originalProcessAlive(launch.controller), true, 'Controller no longer owns GO');
      const intent = object(
        JSON.parse(readPrivate(join(directory, 'go-intent.json')).bytes.toString('utf8')),
      );
      exact(intent, ['launchSha256', 'identitySha256']);
      assert.equal(intent.launchSha256, launchSha256);
      assert.equal(intent.identitySha256, processIdentityHash(identity));
      phase = 'admitted';
      save();
    },
    run,
    close: () => {
      void finish(143);
    },
  });
  socket = control.pin;
  phase = 'ready';
  save();
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [, , flag, directory, hashFlag, expected] = process.argv;
  try {
    assert.equal(process.argv.length, 6);
    assert.equal(flag, '--intent');
    assert.equal(hashFlag, '--sha256');
    assert.ok(directory && expected);
    await runProcessWorker(directory, expected);
  } catch {
    console.error('Source client control refused; preserve original evidence.');
    process.exitCode = 1;
  }
}
