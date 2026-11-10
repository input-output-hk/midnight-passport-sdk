// Durable launch + ready/GO barrier. Only the worker writes its process record.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { closeSync, openSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { put, syncDirectory } from './files.mjs';
import { prepareProcessLaunch, readProcessLaunch, admitControlSocket } from './process-launch.mjs';
import { processRecord, processClaim } from './process-record.mjs';
import { originalProcessAlive } from './process-identity.mjs';
import { processRequest } from './process-protocol.mjs';
import { closeRecordedProcess } from './process-close.mjs';

/** @typedef {{directory:string,launchSha256:string}} ProcessReference */
/** @param {{root:string,runId:string,program:string,controller:import('./process-identity.mjs').ProcessIdentity,env:NodeJS.ProcessEnv,check:()=>void,onLaunch:(value:ProcessReference)=>void|Promise<void>,controlParent?:string,cwd?:string}} options */
export function sourceProcess(options) {
  /** @type {ProcessReference|null} */ let reference = null;
  let closed = false,
    exit = -1;
  let dispatched = false;
  /** @type {number|undefined} */ let pid;
  return {
    get closed() {
      return closed;
    },
    get exit() {
      return exit;
    },
    get reference() {
      return reference;
    },
    async start() {
      assert.equal(reference, null, 'Source process may be dispatched only once');
      const prepared = prepareProcessLaunch(
        options.root,
        options.runId,
        options.program,
        options.controller,
        options.controlParent,
      );
      reference = { directory: prepared.directory, launchSha256: prepared.launchSha256 };
      await options.onLaunch(reference); // Must be durable in the controller before dispatch.
      const { directory, launchSha256 } = reference;
      put(join(directory, 'dispatch-pending.json'), JSON.stringify({ launchSha256 }) + '\n');
      syncDirectory(directory);
      const log = openSync(join(options.root, 'source-client.private.log'), 'wx', 0o600);
      try {
        const env = { ...options.env };
        for (const name of [
          'GITHUB_TOKEN',
          'GH_TOKEN',
          'NODE_OPTIONS',
          'NODE_PATH',
          'LD_PRELOAD',
          'LD_DYLD_PATH',
          'DYLD_LIBRARY_PATH',
          'DYLD_INSERT_LIBRARIES',
        ])
          delete env[name];
        dispatched = true;
        const child = spawn(
          prepared.launch.executable,
          [prepared.launch.worker, '--intent', directory, '--sha256', launchSha256],
          { cwd: options.cwd, env, detached: true, stdio: ['ignore', log, log] },
        );
        pid = child.pid;
        child.once('error', () => {});
        child.once('close', (code) => {
          closed = true;
          exit = code ?? -1;
          try {
            put(
              join(directory, 'parent-observed-close.json'),
              JSON.stringify({ launchSha256, pid: pid ?? null, exitCode: exit }) + '\n',
            );
            syncDirectory(directory);
          } catch {
            exit = -1;
          }
        });
        put(
          join(directory, 'parent-dispatch.json'),
          JSON.stringify({ launchSha256, pid: pid ?? null }) + '\n',
        );
        syncDirectory(directory);
      } finally {
        closeSync(log);
      }
      const end = performance.now() + 30_000;
      while (performance.now() < end) {
        options.check();
        assert.equal(closed, false, 'Worker exited before ready');
        if (
          existsSync(join(directory, 'record.json')) &&
          processRecord(directory, launchSha256).phase === 'ready'
        )
          break;
        await delay(50);
      }
      const { launch, key } = readProcessLaunch(directory, launchSha256);
      try {
        const record = processRecord(directory, launchSha256);
        assert.equal(record.phase, 'ready');
        assert.equal(record.identity.pid, pid);
        processClaim(directory, launchSha256);
        assert.equal(originalProcessAlive(record.identity), true);
        assert.ok(record.socket);
        const path = admitControlSocket(launch, record.socket);
        const status = await processRequest(
          path,
          key,
          launchSha256,
          record.identitySha256,
          'status',
        );
        assert.equal(status.phase, 'ready');
        options.check();
        put(
          join(directory, 'go-intent.json'),
          JSON.stringify({ launchSha256, identitySha256: record.identitySha256 }) + '\n',
        );
        syncDirectory(directory);
        const ack = await processRequest(path, key, launchSha256, record.identitySha256, 'go');
        assert.equal(ack.phase, 'admitted');
        put(
          join(directory, 'go-ack.json'),
          JSON.stringify({
            launchSha256,
            identitySha256: record.identitySha256,
            phase: 'admitted',
          }) + '\n',
        );
        syncDirectory(directory);
      } finally {
        key.fill(0);
      }
    },
    async stop() {
      if (!reference || !dispatched) return true;
      return (await closeRecordedProcess(reference.directory, reference.launchSha256)).closed;
    },
  };
}
