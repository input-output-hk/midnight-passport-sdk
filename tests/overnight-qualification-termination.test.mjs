import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { test } from 'node:test';
import { createOwnedProcessStopper } from '../scripts/qualification/process-stop.mjs';
import { planSuite, runCommand } from '../scripts/qualification/runner.mjs';

/** @param {string} code @param {number} timeoutMs @param {number} terminationGraceMs */
const scenario = (code, timeoutMs, terminationGraceMs) => ({
  tier: 'unit-port',
  command: [process.execPath, '-e', code],
  requires: [],
  timeoutMs,
  terminationGraceMs,
  establishes: 'Owned synthetic cleanup boundary only',
});

test('isolated lifecycle has an explicit opt-in and a three-hour combined outer deadline', () => {
  const [profile] = planSuite('host-job-lifecycle-isolated-native', {});
  assert.ok(profile);
  assert.ok(profile.missing.includes('PASSPORT_ISOLATED_LIFECYCLE_NATIVE'));
  assert.equal(profile.timeoutMs, 177 * 60_000);
  assert.equal(profile.terminationGraceMs, 180_000);
  assert.equal(profile.timeoutMs + profile.terminationGraceMs, 180 * 60_000);
  assert.match(profile.establishes, /No retained stack control/);
});

test('exact owned escalation is idempotent and cancelled after close', async () => {
  const child = Object.assign(new EventEmitter(), { pid: 14321 });
  /** @type {{pid:number,signal:string}[]} */ const signals = [];
  const stopper = createOwnedProcessStopper(child, 20, (pid, signal) =>
    signals.push({ pid, signal }),
  );
  stopper.stop();
  stopper.stop();
  child.emit('close');
  await delay(40);
  stopper.stop();
  stopper.dispose();
  assert.deepEqual(signals, [{ pid: -14321, signal: 'SIGTERM' }]);
  assert.equal(child.listenerCount('close'), 0);
});

test('a still-open owned group escalates once and disposal cancels any later timer', async () => {
  const child = Object.assign(new EventEmitter(), { pid: 14322 });
  /** @type {string[]} */ const signals = [];
  const stopper = createOwnedProcessStopper(child, 10, (_pid, signal) => signals.push(signal));
  stopper.stop();
  await delay(25);
  stopper.stop();
  stopper.dispose();
  assert.deepEqual(signals, ['SIGTERM', 'SIGKILL']);
});

test('invalid termination budgets refuse before any process starts', async () => {
  for (const invalid of [0, -1, 0.5, NaN, Infinity, 180_001])
    await assert.rejects(
      runCommand(scenario('throw Error("must not start")', 100, invalid)),
      /invalid scenario/,
    );
});

test('a timed-out scenario receives its declared cleanup grace beyond the legacy one-second limit', async () => {
  const root = await mkdtemp(join(tmpdir(), 'passport-cleanup-grace-'));
  try {
    const marker = join(root, 'cleaned.json');
    const code = `const fs=require('node:fs');let stopped=false;const keep=setInterval(()=>{},1000);process.on('SIGTERM',()=>{if(stopped)return;stopped=true;setTimeout(()=>{fs.writeFileSync(${JSON.stringify(marker)},'cleaned');clearInterval(keep);},1200);});`;
    const result = await runCommand(scenario(code, 500, 1800));
    assert.equal(result.outcome, 'timed-out', 'Cleanup does not turn an expired run into a pass');
    assert.equal(result.failureCode, 'TIME_LIMIT');
    assert.equal(result.exitCode, 0);
    assert.equal(await readFile(marker, 'utf8'), 'cleaned');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('output-limit interruption also permits bounded owned cleanup', async () => {
  const root = await mkdtemp(join(tmpdir(), 'passport-output-grace-'));
  try {
    const marker = join(root, 'cleaned.json');
    const code = `const fs=require('node:fs');const keep=setInterval(()=>{},1000);process.on('SIGTERM',()=>{setTimeout(()=>{fs.writeFileSync(${JSON.stringify(marker)},'cleaned');clearInterval(keep);},50);});process.stdout.write('x'.repeat(4096));`;
    const result = await runCommand(scenario(code, 5000, 500), { maxOutputBytes: 100 });
    assert.equal(result.outcome, 'output-limit');
    assert.equal(result.exitCode, 0);
    assert.equal(await readFile(marker, 'utf8'), 'cleaned');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('parent interruption reaches the detached scenario and repeated signals preserve cleanup', async () => {
  const root = await mkdtemp(join(tmpdir(), 'passport-parent-interrupt-'));
  const started = join(root, 'started.json'),
    cleaned = join(root, 'cleaned.json'),
    result = join(root, 'result.json');
  const code = `const fs=require('node:fs');let stopping=false;const keep=setInterval(()=>{},1000);process.on('SIGTERM',()=>{if(stopping)return;stopping=true;setTimeout(()=>{fs.writeFileSync(${JSON.stringify(cleaned)},'cleaned');clearInterval(keep);},80);});fs.writeFileSync(${JSON.stringify(started)},JSON.stringify({pid:process.pid}));`;
  const entry = join(root, 'outer.mjs');
  const runner = new URL('../scripts/qualification/runner.mjs', import.meta.url).href;
  const catalog = new URL('../scripts/qualification/catalog.mjs', import.meta.url).href;
  await writeFile(
    entry,
    `import {runSuite} from ${JSON.stringify(runner)};import{SCENARIOS}from ${JSON.stringify(catalog)};Object.assign(SCENARIOS['binding-source'],${JSON.stringify(scenario(code, 5000, 1000))},{tier:SCENARIOS['binding-source'].tier});const receipt=await runSuite('foundation',${JSON.stringify(result)});if(receipt.allRequiredPassed)throw Error('Interrupted suite cannot pass');`,
  );
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  delete env.NODE_OPTIONS;
  delete env.NODE_PATH;
  const child = spawn(process.execPath, [entry], {
    cwd: root,
    env,
    detached: true,
    stdio: 'ignore',
  });
  const closed = new Promise((resolve) => child.once('close', resolve));
  /** @type {number | undefined} */ let innerPid;
  let quiescent = false;
  try {
    const deadline = performance.now() + 4000;
    while (performance.now() < deadline) {
      try {
        innerPid = JSON.parse(await readFile(started, 'utf8')).pid;
        break;
      } catch {
        await delay(10);
      }
    }
    assert.ok(
      innerPid && child.pid,
      'Owned scenario must install its signal handler before interruption',
    );
    process.kill(-child.pid, 'SIGTERM');
    await delay(10);
    if (child.exitCode === null && child.signalCode === null) process.kill(-child.pid, 'SIGINT');
    const exit = await closed;
    assert.equal(exit, 0);
    const observed = JSON.parse(await readFile(result, 'utf8'));
    assert.equal(observed.allRequiredPassed, false);
    const first = observed.results[0];
    assert.equal(first.outcome, 'failed');
    assert.equal(first.failureCode, 'INTERRUPTED');
    assert.equal(first.exitCode, 0);
    for (const deferred of observed.results
      .slice(1)
      .filter((/** @type {{id:string}} */ item) => item.id !== 'source-changed')) {
      assert.equal(deferred.outcome, 'failed');
      assert.equal(deferred.failureCode, 'INTERRUPTED');
      assert.equal(deferred.elapsedMs, 0, 'No later scenario may start after cancellation');
    }
    await assert.rejects(access(result + '.lock'), { code: 'ENOENT' });
    assert.equal(await readFile(cleaned, 'utf8'), 'cleaned');
    quiescent = true;
  } finally {
    if (!quiescent) {
      for (const pid of [innerPid, child.pid])
        if (pid)
          try {
            process.kill(-pid, 'SIGKILL');
          } catch {
            /* Owned group exited. */
          }
    }
    await closed;
    await rm(root, { recursive: true, force: true });
  }
});
