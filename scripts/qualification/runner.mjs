import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { access, mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { SCENARIOS, SUITES } from './catalog.mjs';
import {
  sha256,
  tapSummary,
  validateReceipt,
  workspaceIdentity,
  verifyQualificationBinding,
  writeReceipt,
} from './receipt.mjs';

const ROOT = resolve(import.meta.dirname, '../..');
/** @typedef {{tier: string, command: string[], requires: string[], timeoutMs: number, establishes: string}} Scenario */
/** @param {string} suite @param {NodeJS.ProcessEnv} env */
export function planSuite(suite, env = process.env) {
  const ids = /** @type {Record<string,string[]>} */ (SUITES)[suite];
  if (!ids) throw new Error('unknown qualification suite');
  return ids.map((id) => {
    const scenario = /** @type {Record<string,Scenario>} */ (SCENARIOS)[id];
    if (!scenario) throw new Error('unknown scenario in suite');
    return {
      id,
      ...scenario,
      missing: scenario.requires.filter((name) => !env[name]),
      status: scenario.command.length ? 'implemented' : 'not-implemented',
    };
  });
}

/** Terminate only the process group created for this exact scenario.
 * @param {import('node:child_process').ChildProcess} child
 */
function stop(child) {
  const pid = child.pid;
  if (!pid) return;
  try {
    process.kill(-pid, 'SIGTERM');
  } catch {
    /* already exited */
  }
  const killer = setTimeout(() => {
    try {
      process.kill(-pid, 'SIGKILL');
    } catch {
      /* exited */
    }
  }, 1000);
  killer.unref();
}

/** @param {Scenario} scenario @param {{root?: string, env?: NodeJS.ProcessEnv, maxOutputBytes?: number}} options */
export async function runCommand(
  scenario,
  { root = ROOT, env = process.env, maxOutputBytes = 512 * 1024 } = {},
) {
  if (
    !scenario.command.length ||
    !scenario.command[0] ||
    !Number.isSafeInteger(scenario.timeoutMs) ||
    scenario.timeoutMs < 1
  )
    throw new Error('invalid scenario command');
  const started = performance.now();
  /** @type {Buffer[]} */ const output = [];
  /** @type {Buffer[]} */ const errors = [];
  let total = 0,
    exceeded = false,
    expired = false;
  const child = spawn(scenario.command[0], scenario.command.slice(1), {
    cwd: root,
    env,
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const timer = setTimeout(() => {
    expired = true;
    stop(child);
  }, scenario.timeoutMs);
  const collect = (/** @type {Buffer[]} */ target, /** @type {Buffer} */ chunk) => {
    total += chunk.length;
    if (total <= maxOutputBytes) target.push(chunk);
    else if (!exceeded) {
      exceeded = true;
      stop(child);
    }
  };
  child.stdout?.on('data', (chunk) => collect(output, chunk));
  child.stderr?.on('data', (chunk) => collect(errors, chunk));
  let spawnFailed = false;
  const exit = await new Promise((resolveExit) => {
    child.once('error', () => {
      spawnFailed = true;
      resolveExit({ code: null, signal: null });
    });
    child.once('close', (code, signal) => resolveExit({ code, signal }));
  });
  clearTimeout(timer);
  const stdout = Buffer.concat(output),
    stderr = Buffer.concat(errors);
  const tests = tapSummary(stdout.toString('utf8'));
  // A declared Node test command cannot qualify an empty or missing TAP run.
  const emptyTests = scenario.command.includes('--test') && !(tests.passed && tests.passed > 0);
  const outcome = exceeded
    ? 'output-limit'
    : expired
      ? 'timed-out'
      : spawnFailed || exit.code !== 0 || tests.failed || tests.cancelled || emptyTests
        ? 'failed'
        : tests.skipped
          ? 'passed-with-skips'
          : 'passed';
  const failureCode = exceeded
    ? 'OUTPUT_LIMIT'
    : expired
      ? 'TIME_LIMIT'
      : spawnFailed
        ? 'SPAWN_FAILED'
        : exit.code !== 0
          ? 'PROCESS_EXIT'
          : tests.failed || tests.cancelled
            ? 'TEST_FAILURE'
            : emptyTests
              ? 'NO_TESTS'
              : tests.skipped
                ? 'TEST_SKIP'
                : undefined;
  return {
    outcome,
    elapsedMs: Math.round(performance.now() - started),
    ...(failureCode && { failureCode }),
    exitCode: exit.code,
    signal: exit.signal,
    stdoutSha256: sha256(stdout),
    stderrSha256: sha256(stderr),
    outputBytes: total,
    ...(Object.keys(tests).length && { tests }),
  };
}

/** @param {string} suite @param {string} output @param {{root?: string, env?: NodeJS.ProcessEnv}} options */
export async function runSuite(suite, output, { root = ROOT, env = process.env } = {}) {
  const plan = planSuite(suite, env);
  const verifiedBinding = await verifyQualificationBinding(root);
  const outputFile = resolve(output),
    lock = `${outputFile}.lock`;
  try {
    await access(outputFile);
    throw new Error('receipt already exists; choose a new evidence path');
  } catch (error) {
    if (/** @type {NodeJS.ErrnoException} */ (error).code !== 'ENOENT') throw error;
  }
  await mkdir(dirname(outputFile), { recursive: true, mode: 0o700 });
  // Refuse invalid source/runtime before reserving an evidence path.
  const source = await workspaceIdentity(root);
  const runId = randomUUID();
  await writeFile(lock, JSON.stringify({ runId, suite, startedAt: new Date().toISOString() }), {
    flag: 'wx',
    mode: 0o600,
  });
  // A crash leaves the lock for reconciliation; a second run cannot overwrite uncertain evidence.
  const startedAt = new Date().toISOString();
  const results = [];
  for (const scenario of plan) {
    let result;
    if (scenario.status === 'not-implemented')
      result = { outcome: 'not-implemented', elapsedMs: 0, failureCode: 'NOT_IMPLEMENTED' };
    else if (scenario.missing.length)
      result = { outcome: 'not-configured', elapsedMs: 0, failureCode: 'MISSING_INPUT' };
    else if (
      scenario.tier === 'proof-localnet' &&
      (env.MN_NETWORK_ID !== 'undeployed' || env.PASSPORT_RC_LOCALNET !== '1')
    )
      result = { outcome: 'not-configured', elapsedMs: 0, failureCode: 'UNSUPPORTED_NETWORK' };
    else
      result = await runCommand(scenario, {
        root,
        env: {
          ...env,
          ...(scenario.id === 'localnet-night' && {
            PASSPORT_RC_EVIDENCE: resolve(dirname(outputFile), `${runId}-localnet-evidence.json`),
          }),
        },
      });
    results.push({ id: scenario.id, tier: scenario.tier, ...result });
  }
  const after = await workspaceIdentity(root);
  if (after.workspaceSha256 !== source.workspaceSha256 || after.commit !== source.commit)
    results.push({
      id: 'source-changed',
      tier: 'source-comparison',
      outcome: 'failed',
      elapsedMs: 0,
      failureCode: 'SOURCE_CHANGED',
    });
  const receipt = {
    schemaVersion: 1,
    runId,
    suite,
    startedAt,
    source,
    binding: verifiedBinding,
    results,
    allRequiredPassed: results.every((r) => r.outcome === 'passed'),
    releaseQualified: false,
  };
  validateReceipt(receipt);
  await writeReceipt(outputFile, receipt);
  await unlink(lock);
  return receipt;
}
