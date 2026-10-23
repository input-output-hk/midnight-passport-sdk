// Full synthetic crash matrix; intentionally outside the fast PR lane. No live wallet or service.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync, spawn } from 'node:child_process';
import { mkdtemp, readFile, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodeMutationValue } from '../../packages/account/dist/index.js';
const worker = fileURLToPath(new URL('./mutation-worker.mjs', import.meta.url));
/** @param {string} root @param {string} arm @param {string} operation @param {string} mode @param {string} fault @param {string} outcomes */
export function invokeMutationWorker(
  root,
  arm,
  operation,
  mode = 'run',
  fault = 'none',
  outcomes = 'known',
  profile = 'empty',
) {
  const child = spawnSync(
    process.execPath,
    [worker, root, arm, operation, mode, fault, outcomes, profile],
    {
      encoding: 'utf8',
      timeout: 20000,
      maxBuffer: 1024 * 1024,
    },
  );
  if (child.error) throw child.error;
  const line = child.stdout.trim().split('\n').at(-1);
  return {
    status: child.status,
    output: line?.startsWith('{') ? JSON.parse(line) : undefined,
    diagnostic: child.stderr.slice(-1600),
  };
}
/** Same isolated synthetic worker, with bounded parallel scheduling for the opt-in matrix.
 * @param {string[]} args
 * @param {Set<import('node:child_process').ChildProcess>} active
 */
async function invokeAsync(args, active) {
  return new Promise((resolveResult, reject) => {
    const child = spawn(process.execPath, [worker, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    active.add(child);
    let stdout = '',
      stderr = '',
      expired = false,
      exceeded = false;
    const timer = setTimeout(() => {
      expired = true;
      child.kill('SIGKILL');
    }, 20000);
    const collect = (/** @type {Buffer} */ chunk, /** @type {boolean} */ error) => {
      if (stdout.length + stderr.length + chunk.length > 1024 * 1024) {
        exceeded = true;
        child.kill('SIGKILL');
        return;
      }
      if (error) stderr += chunk.toString();
      else stdout += chunk.toString();
    };
    child.stdout.on('data', (chunk) => collect(chunk, false));
    child.stderr.on('data', (chunk) => collect(chunk, true));
    child.once('error', (error) => {
      clearTimeout(timer);
      active.delete(child);
      reject(error);
    });
    child.once('close', (status) => {
      clearTimeout(timer);
      active.delete(child);
      if (expired || exceeded)
        return reject(new Error('Synthetic worker exceeded its deadline/output bound.'));
      try {
        const line = stdout.trim().split('\n').at(-1);
        resolveResult({
          status,
          output: line?.startsWith('{') ? JSON.parse(line) : undefined,
          diagnostic: stderr.slice(-1600),
        });
      } catch (error) {
        reject(error);
      }
    });
  });
}
/** @param {string} root */
export const mutationWorld = async (root) =>
  /** @type {any} */ (
    decodeMutationValue(JSON.parse(await readFile(join(root, 'world.json'), 'utf8')))
  );
/** @param {string} output */
export async function runMutationMatrix(output, profile = 'empty') {
  assert.ok(['empty', 'populated'].includes(profile));
  /** @type {Set<import('node:child_process').ChildProcess>} */ const active = new Set();
  let interrupted = false;
  const stop = () => {
    interrupted = true;
    for (const child of active) child.kill('SIGKILL');
  };
  /** @param {string} root @param {string} arm @param {string} op */
  const invoke = (root, arm, op, mode = 'run', crash = 'none', outcomes = 'known') => {
    if (interrupted) throw new Error('Synthetic matrix interrupted.');
    return invokeAsync([root, arm, op, mode, crash, outcomes, profile], active);
  };
  const identity = async () =>
    Object.fromEntries(
      await Promise.all(
        [
          'packages/account/src/durable-mutations.ts',
          'packages/account/src/mutation-types.ts',
          'packages/account/src/mutation-codec.ts',
          'packages/account/src/mutation-ledger.ts',
          'packages/account/src/removal-reader.ts',
          'packages/account/dist/removal-reader.js',
          'packages/account/src/connector.ts',
          'packages/account/src/jubjub-connector.ts',
          'packages/account/src/read-grant-deliveries.ts',
          'packages/account/dist/connector.js',
          'packages/account/dist/jubjub-connector.js',
          'packages/account/dist/read-grant-deliveries.js',
          'packages/adapter-midnight-js/src/holdings.ts',
          'packages/adapter-midnight-js/src/grants.ts',
          'packages/adapter-midnight-js/dist/holdings.js',
          'packages/adapter-midnight-js/dist/grants.js',
          'packages/keys/src/device-keyring.ts',
          'packages/keys/dist/device-keyring.js',
          'packages/account/dist/durable-mutations.js',
          'packages/keys/src/mutation-journal.ts',
          'packages/keys/dist/mutation-journal.js',
          'packages/service/src/mutation-store.ts',
          'packages/service/dist/mutation-store.js',
          'packages/contract/generated/acc-s3r1.1/index.js',
          'scripts/qualification/mutation-worker.mjs',
          'scripts/qualification/mutation-matrix.mjs',
        ].map(async (path) => [
          path,
          createHash('sha256')
            .update(await readFile(new URL('../../' + path, import.meta.url)))
            .digest('hex'),
        ]),
      ),
    );
  const sources = await identity();
  assert.equal(
    sources['packages/contract/generated/acc-s3r1.1/index.js'],
    '0ee002d3ac6eae8c048fbd9017ed2f1215e3961629f998221dd9b3e77d74bccf',
  );
  const scratch = await mkdtemp(join(tmpdir(), 'passport-mutation-matrix-'));
  /** @type {Array<Record<string,unknown>>} */ const cases = [];
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  try {
    for (const arm of ['p256', 'jubjub'])
      for (const operation of profile === 'populated'
        ? ['rotate', 'add-device', 'remove-device']
        : ['create', 'rotate', 'add-device', 'remove-device']) {
        const baselineRoot = join(scratch, `${arm}-${operation}-baseline`);
        const prep = await invoke(baselineRoot, arm, operation, 'prepare');
        assert.equal(prep.status, 0, JSON.stringify({ arm, operation, prep }));
        const initial = await readFile(join(baselineRoot, 'world.json'));
        const baseline = await invoke(baselineRoot, arm, operation);
        assert.equal(baseline.status, 0, JSON.stringify(baseline));
        const before = await mutationWorld(baselineRoot);
        const labels = /** @type {string[]} */ ([...new Set(before.events)]);
        for (let offset = 0; offset < labels.length; offset += 4) {
          const batch = await Promise.allSettled(
            labels.slice(offset, offset + 4).map(async (label, local) => {
              const i = offset + local;
              const root = join(scratch, `${arm}-${operation}-${i}`);
              await mkdir(root, { mode: 0o700 });
              await writeFile(join(root, 'world.json'), initial, { mode: 0o600 });
              const killed = await invoke(root, arm, operation, 'run', label);
              assert.equal(
                killed.status,
                86,
                `${arm}/${operation}/${label}: ${JSON.stringify(killed)}`,
              );
              const atCrash = await mutationWorld(root);
              const resumed = await invoke(root, arm, operation, 'resume');
              const blocked =
                label === 'material:before' ||
                label === 'material:after' ||
                label === 'material:committed:before' ||
                label.startsWith('credential:') ||
                (label.startsWith('material:') && !label.includes(':committed')) ||
                (label.startsWith('output:') && label.endsWith(':before'));
              assert.equal(
                resumed.status,
                blocked ? 2 : 0,
                `${arm}/${operation}/${label}: ${JSON.stringify(resumed)}`,
              );
              if (blocked) {
                // Grant delivery wraps an unavailable original sealed output with its
                // fail-closed grant-specific code; other key-origin windows stay generic.
                const grantDelivery =
                  profile === 'populated' &&
                  [
                    'material:sealView:before',
                    'material:sealView:after',
                    'output:viewing.sealView:committed:before',
                  ].includes(label);
                assert.equal(
                  resumed.output?.code,
                  grantDelivery ? 'GrantRosterUnsettled' : 'MutationUnsettled',
                  `${arm}/${operation}/${label}: unexpected refusal`,
                );
              }
              const after = await mutationWorld(root);
              assert.equal(
                after.created,
                blocked ? atCrash.created : before.created,
                'replacement key generation',
              );
              assert.equal(
                after.enrolled,
                blocked ? atCrash.enrolled : before.enrolled,
                'replacement credential',
              );
              assert.equal(
                after.effects.length,
                blocked ? atCrash.effects.length : before.effects.length,
                'duplicate/lost effect',
              );
              if (profile === 'populated' && !blocked)
                assert.deepEqual(after.populatedVerified, {
                  held: 1,
                  activeReadGrants: 1,
                  currentGrantOpened: true,
                });
              assert.ok(
                after.consents.every((/** @type {any} */ c) => c.intent.kind === operation),
              );
              if (operation === 'create')
                assert.equal(
                  after.effects.find((/** @type {any} */ e) => e.kind === 'deploy')?.request
                    .retireAuthority ?? true,
                  true,
                );
              cases.push({
                arm,
                operation,
                boundary: label.replaceAll('91'.repeat(16), 'synthetic'),
                expected: blocked ? 'refused-key-origin-window' : 'resumed',
                status: 'passed',
              });
            }),
          );
          const failure = batch.find((result) => result.status === 'rejected');
          if (failure?.status === 'rejected') throw failure.reason;
        }
        console.log(JSON.stringify({ arm, operation, cases: labels.length, status: 'passed' }));
      }
    assert.deepEqual(await identity(), sources, 'Source/runtime changed during the matrix.');
    const report = {
      sources,
      concurrency: 4,
      schema: 1,
      scope:
        profile === 'populated'
          ? 'synthetic-populated-grants-holdings-fresh-process'
          : 'synthetic-fresh-process-durable-mutations',
      profile,
      binding: 'acc-s3r1.1',
      noProofsOrFunds: true,
      hostOutcomeSource: 'atomic-local-synthetic-transport',
      caseCount: cases.length,
      cases: cases.sort((a, b) =>
        JSON.stringify([a.arm, a.operation, a.boundary]).localeCompare(
          JSON.stringify([b.arm, b.operation, b.boundary]),
        ),
      ),
    };
    await mkdir(resolve(output, '..'), { recursive: true, mode: 0o700 });
    await writeFile(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    return report;
  } finally {
    for (const child of active) child.kill('SIGKILL');
    process.removeListener('SIGINT', stop);
    process.removeListener('SIGTERM', stop);
    await rm(scratch, { recursive: true, force: true });
  }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const output = process.argv[2];
  if (!output) throw new Error('Provide a fresh receipt path.');
  const report = await runMutationMatrix(output, process.argv[3] ?? 'empty');
  console.log(JSON.stringify({ caseCount: report.caseCount, status: 'passed', output }));
}
