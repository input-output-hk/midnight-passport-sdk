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

/** @param {string} root @param {string} code */
async function parentFixture(root, code) {
  const result = join(root, 'result.json');
  const entry = join(root, 'outer.mjs');
  const runner = new URL('../scripts/qualification/runner.mjs', import.meta.url).href;
  const catalog = new URL('../scripts/qualification/catalog.mjs', import.meta.url).href;
  await writeFile(
    entry,
    `import {runSuite} from ${JSON.stringify(runner)};import{SCENARIOS}from ${JSON.stringify(catalog)};Object.assign(SCENARIOS['binding-source'],${JSON.stringify(scenario(code, 30_000, 1000))},{tier:SCENARIOS['binding-source'].tier});const receipt=await runSuite('foundation',${JSON.stringify(result)});if(receipt.allRequiredPassed)throw Error('Interrupted suite cannot pass');`,
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
  let didClose = false;
  child.once('error', () => {}); // The close/ready assertions diagnose failed fixture startup.
  /** @type {Promise<number|null>} */
  const closed = new Promise((resolve) =>
    child.once('close', (code) => {
      didClose = true;
      resolve(code);
    }),
  );
  return {
    child,
    closed,
    isClosed: () => didClose || child.exitCode !== null || child.signalCode !== null,
  };
}

/** @param {Awaited<ReturnType<typeof parentFixture>>} owned */
async function outerExit(owned) {
  /** @type {ReturnType<typeof setTimeout>|undefined} */ let timer;
  try {
    return await Promise.race([
      owned.closed,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('Owned outer runner did not close.')), 30_000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** Read only this fixture's private fresh marker; never infer a PID from process matching.
 * @param {string} path */
async function markerPid(path) {
  try {
    const pid = JSON.parse(await readFile(path, 'utf8')).pid;
    return Number.isSafeInteger(pid) && pid > 1 ? Number(pid) : undefined;
  } catch {
    return undefined;
  }
}

/** @param {number} pid */
function groupGone(pid) {
  try {
    process.kill(-pid, 0);
    return false;
  } catch (error) {
    return error instanceof Error && 'code' in error && error.code === 'ESRCH';
  }
}
/** @param {number|undefined} pid @param {'SIGTERM'|'SIGKILL'} signal */
function signalOwned(pid, signal) {
  if (pid)
    try {
      process.kill(-pid, signal);
    } catch {
      /* Exact owned group already ended. */
    }
}

/** Give the outer runner time to forward cleanup, then bound exact owned escalation/reaping.
 * An unavailable PID remains unknown; retain failed evidence rather than guessing another group.
 * @param {Awaited<ReturnType<typeof parentFixture>>} owned @param {string} started
 * @param {number|undefined} innerPid */
async function cleanupFixture(owned, started, innerPid) {
  const end = performance.now() + 2000,
    forceAt = end - 250;
  if (!owned.isClosed()) signalOwned(owned.child.pid, 'SIGTERM');
  while (performance.now() < forceAt) {
    innerPid ??= await markerPid(started);
    if (owned.isClosed() && innerPid && groupGone(innerPid))
      return { outerClosed: true, innerPid, innerGone: true };
    await delay(Math.min(10, Math.max(0, forceAt - performance.now())));
  }
  if (!owned.isClosed()) signalOwned(owned.child.pid, 'SIGKILL');
  if (innerPid && !groupGone(innerPid)) signalOwned(innerPid, 'SIGKILL');
  while (performance.now() < end) {
    const recovered = await markerPid(started);
    if (!innerPid && recovered) {
      innerPid = recovered;
      signalOwned(innerPid, 'SIGKILL');
    }
    if (owned.isClosed() && innerPid && groupGone(innerPid)) break;
    await delay(Math.min(10, Math.max(0, end - performance.now())));
  }
  return {
    outerClosed: owned.isClosed(),
    innerPid: innerPid ?? null,
    innerGone: innerPid ? groupGone(innerPid) : null,
  };
}

test('parent interruption reaches the detached scenario and repeated signals preserve cleanup', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'passport-parent-interrupt-'));
  const started = join(root, 'started.json'),
    cleaned = join(root, 'cleaned.json'),
    result = join(root, 'result.json');
  const code = `const fs=require('node:fs');let stopping=false;const keep=setInterval(()=>{},1000);process.on('SIGTERM',()=>{if(stopping)return;stopping=true;setTimeout(()=>{fs.writeFileSync(${JSON.stringify(cleaned)},'cleaned');clearInterval(keep);},80);});fs.writeFileSync(${JSON.stringify(started)},JSON.stringify({pid:process.pid}));`;
  const owned = await parentFixture(root, code),
    { child } = owned;
  /** @type {number | undefined} */ let innerPid;
  let quiescent = false;
  try {
    // runSuite fingerprints the workspace before spawning this scenario. Its startup
    // competes with other package-test processes; interruption assertions begin only
    // after the child acknowledges its handler, not after a startup-speed assumption.
    const deadline = performance.now() + 30_000;
    while (performance.now() < deadline) {
      try {
        innerPid = JSON.parse(await readFile(started, 'utf8')).pid;
        break;
      } catch {
        assert.equal(owned.isClosed(), false, 'Outer runner closed before the ready handshake');
        assert.equal(child.exitCode, null, 'Outer runner exited before the ready handshake');
        assert.equal(child.signalCode, null, 'Outer runner stopped before the ready handshake');
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
    const exit = await outerExit(owned);
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
      const cleanup = await cleanupFixture(owned, started, innerPid);
      await writeFile(join(root, 'cleanup.json'), JSON.stringify(cleanup), {
        mode: 0o600,
        flag: 'wx',
      });
      t.diagnostic(`Preserved failed synthetic termination fixture: ${root}`);
    } else await rm(root, { recursive: true, force: true });
  }
});

for (const readiness of ['missing', 'late']) {
  test(`failed fixture cleanup forwards through the exact outer group with ${readiness} readiness`, async (t) => {
    const root = await mkdtemp(join(tmpdir(), 'passport-unready-cleanup-'));
    const started = join(root, 'started.json'),
      handler = join(root, 'handler.json'),
      cleaned = join(root, 'cleaned.json');
    const later =
      readiness === 'late'
        ? `setTimeout(()=>fs.writeFileSync(${JSON.stringify(started)},JSON.stringify({pid:process.pid})),120);`
        : '';
    const code = `const fs=require('node:fs');let stopping=false;const keep=setInterval(()=>{},1000);process.on('SIGTERM',()=>{if(stopping)return;stopping=true;setTimeout(()=>{fs.writeFileSync(${JSON.stringify(cleaned)},'cleaned');clearInterval(keep);},80);});fs.writeFileSync(${JSON.stringify(handler)},JSON.stringify({pid:process.pid}));${later}`;
    const owned = await parentFixture(root, code);
    let oraclePid,
      quiescent = false;
    try {
      const end = performance.now() + 30_000;
      while (!(oraclePid = await markerPid(handler)) && performance.now() < end) {
        assert.equal(owned.isClosed(), false, 'Fixture must acknowledge its real handler');
        await delay(10);
      }
      assert.ok(oraclePid);
      const before = performance.now(),
        cleanup = await cleanupFixture(owned, started, undefined);
      assert.ok(performance.now() - before < 3000, 'Fixture cleanup must remain bounded');
      assert.equal(cleanup.outerClosed, true);
      assert.equal(groupGone(oraclePid), true, 'Actual owned inner group must be gone');
      assert.equal(await readFile(cleaned, 'utf8'), 'cleaned');
      if (readiness === 'late') assert.equal(cleanup.innerPid, oraclePid);
      else assert.equal(cleanup.innerPid, null);
      quiescent = true;
    } finally {
      if (quiescent) await rm(root, { recursive: true, force: true });
      else {
        const cleanup = await cleanupFixture(owned, started, oraclePid);
        await writeFile(join(root, 'cleanup.json'), JSON.stringify(cleanup), {
          mode: 0o600,
          flag: 'wx',
        });
        t.diagnostic(`Preserved failed synthetic cleanup control: ${root}`);
      }
    }
  });
}
