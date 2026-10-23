// Full synthetic crash matrix; intentionally outside the fast PR lane. No live wallet or service.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
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
) {
  const child = spawnSync(process.execPath, [worker, root, arm, operation, mode, fault, outcomes], {
    encoding: 'utf8',
    timeout: 20000,
    maxBuffer: 1024 * 1024,
  });
  if (child.error) throw child.error;
  const line = child.stdout.trim().split('\n').at(-1);
  return {
    status: child.status,
    output: line?.startsWith('{') ? JSON.parse(line) : undefined,
    diagnostic: child.stderr.slice(-1600),
  };
}
/** @param {string} root */
export const mutationWorld = async (root) =>
  /** @type {any} */ (
    decodeMutationValue(JSON.parse(await readFile(join(root, 'world.json'), 'utf8')))
  );
/** @param {string} output */
export async function runMutationMatrix(output) {
  const identity = async () =>
    Object.fromEntries(
      await Promise.all(
        [
          'packages/account/src/durable-mutations.ts',
          'packages/account/src/mutation-types.ts',
          'packages/account/src/mutation-codec.ts',
          'packages/account/src/mutation-ledger.ts',
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
  try {
    for (const arm of ['p256', 'jubjub'])
      for (const operation of ['create', 'rotate', 'add-device', 'remove-device']) {
        const baselineRoot = join(scratch, `${arm}-${operation}-baseline`);
        const prep = invokeMutationWorker(baselineRoot, arm, operation, 'prepare');
        assert.equal(prep.status, 0, JSON.stringify({ arm, operation, prep }));
        const initial = await readFile(join(baselineRoot, 'world.json'));
        const baseline = invokeMutationWorker(baselineRoot, arm, operation);
        assert.equal(baseline.status, 0, JSON.stringify(baseline));
        const before = await mutationWorld(baselineRoot);
        const labels = /** @type {string[]} */ ([...new Set(before.events)]);
        for (const [i, label] of labels.entries()) {
          const root = join(scratch, `${arm}-${operation}-${i}`);
          await mkdir(root, { mode: 0o700 });
          await writeFile(join(root, 'world.json'), initial, { mode: 0o600 });
          const killed = invokeMutationWorker(root, arm, operation, 'run', label);
          assert.equal(
            killed.status,
            86,
            `${arm}/${operation}/${label}: ${JSON.stringify(killed)}`,
          );
          const atCrash = await mutationWorld(root);
          const resumed = invokeMutationWorker(root, arm, operation, 'resume');
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
          assert.ok(after.consents.every((/** @type {any} */ c) => c.intent.kind === operation));
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
        }
        console.log(JSON.stringify({ arm, operation, cases: labels.length, status: 'passed' }));
      }
    assert.deepEqual(await identity(), sources, 'Source/runtime changed during the matrix.');
    const report = {
      sources,
      schema: 1,
      scope: 'synthetic-fresh-process-durable-mutations',
      binding: 'acc-s3r1.1',
      noProofsOrFunds: true,
      hostOutcomeSource: 'atomic-local-synthetic-transport',
      caseCount: cases.length,
      cases,
    };
    await mkdir(resolve(output, '..'), { recursive: true, mode: 0o700 });
    await writeFile(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    return report;
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const output = process.argv[2];
  if (!output) throw new Error('Provide a fresh receipt path.');
  const report = await runMutationMatrix(output);
  console.log(JSON.stringify({ caseCount: report.caseCount, status: 'passed', output }));
}
