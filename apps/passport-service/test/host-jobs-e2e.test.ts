import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, readFile, rm, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  remoteHostJobs,
  remoteHostJobPorts,
  type RemoteHostJobIdentity,
  type RemoteHostJobInput,
} from '../../../packages/adapter-service/dist/index.js';
import { encryptedHostMutationStore } from '@input-output-hk/mn-passport-service';
const token = '44'.repeat(32),
  pins = {
    networkId: 'undeployed',
    bindingId: 'acc-s3r1.1',
    manifestSha256: '77fb9c17b0d59047456c43115d9a58f5cb99a226ee73b6b974fd724930c3153f',
  };
async function start(t: TestContext, root: string, mode: string, arm: string) {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  delete env.NODE_OPTIONS;
  delete env.NODE_PATH;
  const child = spawn(
    process.execPath,
    [
      '--import',
      'tsx',
      new URL('./fixtures/host-job-service.ts', import.meta.url).pathname,
      root,
      mode,
      arm,
    ],
    { cwd: new URL('..', import.meta.url), env, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  let diagnostic = '',
    output = '';
  const messages: Record<string, unknown>[] = [];
  const waiters = new Set<() => void>();
  child.stderr.on('data', (s) => {
    diagnostic = (diagnostic + s).slice(-8000);
  });
  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
    (resolve, reject) => {
      child.once('error', reject);
      child.once('close', (code, signal) => {
        resolve({ code, signal });
        for (const w of waiters) w();
      });
    },
  );
  child.stdout.on('data', (chunk) => {
    output += String(chunk);
    while (output.includes('\n')) {
      const n = output.indexOf('\n'),
        line = output.slice(0, n);
      output = output.slice(n + 1);
      try {
        messages.push(JSON.parse(line) as Record<string, unknown>);
      } catch {
        diagnostic = (diagnostic + line).slice(-8000);
      }
      for (const w of waiters) w();
    }
  });
  const until = (predicate: (v: Record<string, unknown>) => boolean) =>
    new Promise<Record<string, unknown>>((resolve, reject) => {
      const check = () => {
        const found = messages.find(predicate);
        if (found) {
          waiters.delete(check);
          resolve(found);
        } else if (child.exitCode !== null || child.signalCode !== null) {
          waiters.delete(check);
          reject(new Error('Fixture exited before boundary: ' + diagnostic));
        }
      };
      waiters.add(check);
      check();
    });
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    await exited;
  });
  const ready = await until((v) => v.ready === true);
  assert.equal(typeof ready.port, 'number');
  const base = `http://127.0.0.1:${ready.port}`;
  return {
    child,
    exited,
    until,
    base,
    async kill() {
      child.kill('SIGKILL');
      assert.deepEqual(await exited, { code: null, signal: 'SIGKILL' });
    },
    async stop() {
      child.kill('SIGTERM');
      assert.deepEqual(await exited, { code: 0, signal: null });
    },
  };
}
for (const arm of ['p256', 'jubjub'])
  for (const kind of ['call', 'deploy'] as const)
    for (const boundary of ['before-host', 'after-send'])
      test(
        `${arm} ${kind}: client continues the original job after killed configured service at ${boundary}`,
        { timeout: 15000 },
        async (t) => {
          const root = await mkdtemp(join(tmpdir(), 'passport-jobs-http-e2e-'));
          // Register cleanup first: TestContext cleanup order is registration order, so stop children explicitly below.
          for (const [name, value] of Object.entries({
            'host-key': '11',
            'host-token': '22',
            'job-key': '33',
            'job-token': '44',
          }))
            await writeFile(join(root, name), value.repeat(32), { mode: 0o600 });
          const identity: RemoteHostJobIdentity = {
            pins: { ...pins, scheme: arm === 'p256' ? 'p256-webauthn' : 'jubjub-schnorr' },
            kind,
            requestId: '01'.repeat(16) + ':0',
            intentSha256: 'aa'.repeat(32),
          };
          const input: RemoteHostJobInput =
            kind === 'call'
              ? { address: 'ab'.repeat(32), circuit: `append_inbox_with_${arm}`, tx: '01' }
              : {
                  boot: 'ab'.repeat(32),
                  encKey: 'cd'.repeat(32),
                  retireAuthority: true,
                  firstArm: arm as 'p256' | 'jubjub',
                };
          let first: Awaited<ReturnType<typeof start>> | undefined,
            second: Awaited<ReturnType<typeof start>> | undefined;
          try {
            first = await start(t, root, boundary, arm);
            const client = remoteHostJobs(first.base, {
              pins: identity.pins,
              token,
              timeoutMs: 5000,
              pollIntervalMs: 1,
            });
            const accepted = await client.accept(identity, input);
            await client.start(identity);
            await first.until((v) => v.boundary === boundary);
            await first.kill();
            const before =
              boundary === 'after-send'
                ? (JSON.parse(
                    await readFile(join(root, 'synthetic-ledger.json'), 'utf8'),
                  ) as Record<string, unknown>)
                : {};
            assert.equal(Object.keys(before).length, boundary === 'after-send' ? 1 : 0);
            second = await start(t, root, 'normal', arm);
            const next = remoteHostJobs(second.base, {
              pins: identity.pins,
              token,
              timeoutMs: 5000,
              pollIntervalMs: 1,
            });
            assert.equal((await next.get(identity))?.state, 'running');
            const health = (await (await fetch(second.base + '/healthz')).json()) as {
              hostJobs: boolean;
            };
            assert.equal(health.hostJobs, true);
            // Observing and duplicate-start must never schedule another execute after a restart.
            await next.get(identity);
            await next.start(identity);
            const outcome = await next.resume(identity);
            if (boundary === 'before-host') {
              assert.equal(outcome?.state, 'unknown');
              assert.equal(outcome?.outcome, undefined);
              const store = encryptedHostMutationStore(
                join(root, 'host'),
                Buffer.from('11'.repeat(32), 'hex'),
              );
              try {
                assert.equal(
                  await store.read({
                    ...identity,
                    pins: {
                      ...identity.pins,
                      scheme: arm === 'p256' ? 'p256-webauthn' : 'jubjub-schnorr',
                    },
                  }),
                  undefined,
                );
              } finally {
                store.close();
              }
              await next.resume(identity);
              assert.equal((await next.get(identity))?.state, 'unknown');
              await assert.rejects(() => readFile(join(root, 'synthetic-ledger.json')), {
                code: 'ENOENT',
              });
            } else {
              assert.equal(outcome?.state, 'done');
              assert.equal(outcome.outcome?.digest, identity.intentSha256);
              const after = JSON.parse(
                await readFile(join(root, 'synthetic-ledger.json'), 'utf8'),
              ) as Record<string, unknown>;
              assert.equal(Object.keys(after).length, kind === 'deploy' ? 3 : 1);
              for (const [id, receipt] of Object.entries(before))
                assert.deepEqual(after[id], receipt);
              const ports = remoteHostJobPorts(second.base, {
                pins: identity.pins,
                token,
                timeoutMs: 5000,
                pollIntervalMs: 1,
              });
              const reconciled = await ports.outcomes.reconcile(identity.pins, {
                key: identity.requestId,
                digest: identity.intentSha256,
                kind,
                input: {},
              });
              assert.equal(reconciled.kind, 'confirmed');
              const previous = await readFile(join(root, 'synthetic-ledger.json'), 'utf8');
              await next.resume(identity);
              await next.start(identity);
              assert.equal(await readFile(join(root, 'synthetic-ledger.json'), 'utf8'), previous);
            }
            const changed = { ...identity, intentSha256: 'ff'.repeat(32) };
            await assert.rejects(() => next.resume(changed), { code: 'MutationUnsettled' });
            assert.equal((await next.get(identity))?.jobId, accepted.jobId);
            await second.stop();
            const encoded = await Promise.all(
              (await readdir(join(root, 'jobs')))
                .filter((n) => !n.startsWith('.'))
                .map((n) => readFile(join(root, 'jobs', n), 'utf8')),
            );
            assert.ok(
              encoded.every(
                (s) => !s.includes(identity.intentSha256) && !s.includes('append_inbox'),
              ),
            );
          } finally {
            for (const c of [first, second])
              if (c) {
                if (c.child.exitCode === null && c.child.signalCode === null)
                  c.child.kill('SIGKILL');
                await c.exited;
              }
            await rm(root, { recursive: true, force: true });
          }
        },
      );

test(
  'forced shutdown deadline preserves an unknown accepted job for explicit restart inspection',
  { timeout: 15000 },
  async (t) => {
    const root = await mkdtemp(join(tmpdir(), 'passport-jobs-shutdown-e2e-'));
    for (const [name, value] of Object.entries({
      'host-key': '11',
      'host-token': '22',
      'job-key': '33',
      'job-token': '44',
    }))
      await writeFile(join(root, name), value.repeat(32), { mode: 0o600 });
    const identity: RemoteHostJobIdentity = {
      pins: { ...pins, scheme: 'jubjub-schnorr' },
      kind: 'call',
      requestId: '02'.repeat(16) + ':0',
      intentSha256: 'aa'.repeat(32),
    };
    let first: Awaited<ReturnType<typeof start>> | undefined,
      second: Awaited<ReturnType<typeof start>> | undefined;
    try {
      first = await start(t, root, 'before-host', 'jubjub');
      const c = remoteHostJobs(first.base, {
        pins: identity.pins,
        token,
        timeoutMs: 1000,
        pollIntervalMs: 1,
      });
      await c.accept(identity, {
        address: 'ab'.repeat(32),
        circuit: 'append_inbox_with_jubjub',
        tx: '01',
      });
      await c.start(identity);
      await first.until((m) => m.boundary === 'before-host');
      first.child.kill('SIGTERM');
      assert.deepEqual(await first.exited, { code: 1, signal: null });
      second = await start(t, root, 'normal', 'jubjub');
      const next = remoteHostJobs(second.base, {
        pins: identity.pins,
        token,
        timeoutMs: 1000,
        pollIntervalMs: 1,
      });
      assert.equal((await next.get(identity))?.state, 'running');
      assert.equal((await next.resume(identity))?.state, 'unknown');
      await assert.rejects(() => readFile(join(root, 'synthetic-ledger.json')), { code: 'ENOENT' });
      await second.stop();
    } finally {
      for (const c of [first, second])
        if (c) {
          if (c.child.exitCode === null && c.child.signalCode === null) c.child.kill('SIGKILL');
          await c.exited;
        }
      await rm(root, { recursive: true, force: true });
    }
  },
);
