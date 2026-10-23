import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
const worker = fileURLToPath(new URL('./host-mutation-worker.mjs', import.meta.url));
/** @param {string} root @param {string} arm @param {string} retire @param {string} fault @param {string} mode */
export function hostWorker(root, arm, retire, fault = 'none', mode = 'execute') {
  const r = spawnSync(process.execPath, [worker, root, arm, retire, fault, mode], {
    encoding: 'utf8',
    timeout: 10000,
    maxBuffer: 1024 * 1024,
  });
  if (r.error) throw r.error;
  const line = r.stdout.trim().split('\n').at(-1);
  return {
    status: r.status,
    output: line?.startsWith('{') ? JSON.parse(line) : undefined,
    error: r.stderr.slice(-1500),
  };
}
/** @param {string} output */
export async function runHostMatrix(output) {
  const paths = [
    'packages/service/src/host-mutations.ts',
    'packages/service/dist/host-mutations.js',
    'packages/service/src/host-mutation-store.ts',
    'packages/service/dist/host-mutation-store.js',
    'apps/passport-service/src/host-driver.ts',
    'scripts/qualification/host-mutation-worker.mjs',
    'scripts/qualification/host-mutation-matrix.mjs',
  ];
  const identity = async () =>
    Object.fromEntries(
      await Promise.all(
        paths.map(async (p) => [
          p,
          createHash('sha256')
            .update(await readFile(new URL('../../' + p, import.meta.url)))
            .digest('hex'),
        ]),
      ),
    );
  const sources = await identity(),
    root = await mkdtemp(join(tmpdir(), 'passport-host-matrix-'));
  /** @type {Record<string,unknown>[]} */ const cases = [];
  try {
    for (const arm of ['p256', 'jubjub'])
      for (const retire of ['true', 'false']) {
        const baseline = join(root, `${arm}-${retire}-baseline`),
          result = hostWorker(baseline, arm, retire);
        assert.equal(result.status, 0, JSON.stringify(result));
        assert.equal(result.output.result.kind, 'confirmed');
        const state = JSON.parse(await readFile(join(baseline, 'transport.json'), 'utf8'));
        const labels = /** @type {string[]} */ ([...new Set(state.events)]);
        for (const [index, label] of labels.entries()) {
          const dir = join(root, `${arm}-${retire}-${index}`),
            killed = hostWorker(dir, arm, retire, label);
          assert.equal(killed.status, 86, JSON.stringify(killed));
          const atCrash = hostWorker(dir, arm, retire, 'none', 'inspect');
          assert.equal(atCrash.status, 0);
          const before = JSON.parse(await readFile(join(dir, 'transport.json'), 'utf8')),
            resumed = hostWorker(dir, arm, retire, 'none', 'resume');
          assert.equal(resumed.status, 0, JSON.stringify(resumed));
          const uncertain =
            label.startsWith('constructor:') ||
            label === 'plan-reservation:after' ||
            label === 'plan-reservation:before' ||
            label === 'plan-committed:before' ||
            /^step-\d+-dispatching:after$/.test(label) ||
            /^submit-\d+:before$/.test(label);
          assert.equal(
            resumed.output.result.kind,
            uncertain ? 'unknown' : 'confirmed',
            `${arm}/${retire}/${label}`,
          );
          const after = JSON.parse(await readFile(join(dir, 'transport.json'), 'utf8'));
          assert.equal(after.plans, before.plans, 'original constructor was not recreated');
          if (atCrash.output.planHash) {
            assert.equal(resumed.output.planHash, atCrash.output.planHash);
            assert.equal(resumed.output.retireChoice, retire === 'true');
          }
          assert.deepEqual(
            resumed.output.bytes?.slice(0, atCrash.output.bytes?.length ?? 0) ?? [],
            atCrash.output.bytes ?? [],
            'committed transaction bytes changed',
          );
          assert.equal(
            after.sent.length,
            uncertain ? before.sent.length : 3,
            'duplicate or missing send',
          );
          assert.equal(
            new Set(after.sent.map((/** @type {any} */ r) => r.id)).size,
            after.sent.length,
          );
          cases.push({
            arm,
            retireAuthority: retire === 'true',
            boundary: label,
            outcome: uncertain ? 'safely-unknown' : 'resumed',
            status: 'passed',
          });
        }
        console.log(
          JSON.stringify({
            arm,
            retireAuthority: retire === 'true',
            cases: labels.length,
            status: 'passed',
          }),
        );
      }
    assert.deepEqual(await identity(), sources, 'Source/runtime changed during qualification.');
    const report = {
      schema: 1,
      scope: 'synthetic-host-transport-fresh-process',
      liveNode: false,
      proofsOrFunds: false,
      sources,
      cases,
      count: cases.length,
    };
    await writeFile(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    return report;
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (!process.argv[2]) throw new Error('Provide a fresh output path.');
  const result = await runHostMatrix(process.argv[2]);
  console.log(JSON.stringify({ cases: result.count, status: 'passed' }));
}
