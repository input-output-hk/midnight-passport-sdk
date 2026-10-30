import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  createHostMutationExecutor,
  createHostMutationJobs,
  encryptedHostJobStore,
  encryptedHostMutationStore,
  hostJobId,
} from '../packages/service/dist/index.js';
import { descriptor, servicePins } from './fixtures/host-jobs.mjs';
for (const mode of ['before-execute', 'after-send'])
  test(
    `killed process at ${mode} only reconciles original durable host state`,
    { timeout: 10000 },
    async (t) => {
      const root = await mkdtemp(join(tmpdir(), 'passport-host-job-process-'));
      const env = { ...process.env };
      delete env.NODE_TEST_CONTEXT;
      delete env.NODE_OPTIONS;
      delete env.NODE_PATH;
      const child = spawn(
        process.execPath,
        [new URL('./fixtures/host-job-process.mjs', import.meta.url).pathname, mode, root],
        { env, stdio: ['ignore', 'pipe', 'pipe'] },
      );
      const exited = new Promise((resolve, reject) => {
        child.once('error', reject);
        child.once('close', (code, signal) => resolve({ code, signal }));
      });
      const ready = new Promise((resolve, reject) => {
        let output = '';
        child.stdout.on('data', (chunk) => {
          output += chunk.toString();
          if (output.includes('claimed\n')) resolve(undefined);
        });
        child.once('exit', () => reject(new Error('Test worker exited before durable boundary.')));
      });
      child.stderr.resume();
      t.after(async () => {
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
        await exited;
        await rm(root, { recursive: true, force: true });
      });
      await ready;
      child.kill('SIGKILL');
      assert.deepEqual(await exited, { code: null, signal: 'SIGKILL' });
      const jobStore = encryptedHostJobStore(join(root, 'jobs'), new Uint8Array(32).fill(7)),
        hostStore = encryptedHostMutationStore(join(root, 'host'), new Uint8Array(32).fill(8));
      t.after(() => {
        jobStore.close();
        hostStore.close();
      });
      let forbidden = 0;
      const refuse = async () => {
        forbidden++;
        throw new Error('Cannot execute/reprepare/resend in this recovery.');
      };
      const host = createHostMutationExecutor(hostStore, {
        prepare: refuse,
        prepareStep: refuse,
        submit: refuse,
        check: async () => true,
        lookup: async () => JSON.parse(await readFile(join(root, 'ledger.json'), 'utf8')),
      });
      const jobs = createHostMutationJobs(
        jobStore,
        { execute: refuse, resume: host.resume, inspect: host.inspect },
        { pins: servicePins },
      );
      const id = hostJobId(descriptor());
      assert.equal((await jobs.get(id))?.state, 'running');
      await jobs.start(id);
      await jobs.reconcile(id);
      await jobs.drain();
      assert.equal(forbidden, 0);
      assert.equal((await jobs.get(id))?.state, mode === 'before-execute' ? 'unknown' : 'done');
      if (mode === 'after-send') {
        const ledger = await readFile(join(root, 'ledger.json'), 'utf8');
        await jobs.reconcile(id);
        await jobs.drain();
        assert.equal(await readFile(join(root, 'ledger.json'), 'utf8'), ledger);
        assert.equal((await hostStore.read(descriptor().identity))?.steps[0]?.phase, 'confirmed');
      } else {
        assert.equal(await hostStore.read(descriptor().identity), undefined);
        await jobs.reconcile(id);
        await jobs.drain();
        assert.equal(forbidden, 0);
      }
    },
  );
