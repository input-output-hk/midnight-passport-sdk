import assert from 'node:assert/strict';
import { cpSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { installedFixture } from './fixtures/installed-quality-fixture.mjs';
import {
  assertInstalledSdkResolution,
  assertQualityUnchanged,
  captureInstalledQuality,
  installedQualityContext,
  installedRuntimeExports,
  qualityTree,
} from '../scripts/consumer/installed-quality-inputs.mjs';
import {
  compileInstalledDocumentation,
  compileInstalledProgram,
  verifyCompilerInputs,
} from '../scripts/consumer/installed-quality-types.mjs';
import { importInstalledExports } from '../scripts/consumer/installed-quality-runtime.mjs';
import {
  installedQualityOutput,
  runInstalledQuality,
} from '../scripts/consumer/installed-quality.mjs';

/** @param {import('node:test').TestContext} t */
function fixture(t) {
  const f = installedFixture();
  t.after(() => rmSync(f.root, { recursive: true, force: true }));
  return f;
}

test('prepared consumer requires the exact external manifest/lock pins and installed package bytes', (t) => {
  const f = fixture(t);
  assert.equal(f.context.roots.length, 9);
  assert.throws(() => installedQualityContext({ ...f.pins, lockSha256: '0'.repeat(64) }), /pins/);
  writeFileSync(join(f.account, 'dist/index.js'), 'export const value=8;\n');
  assert.throws(() => installedQualityContext(f.pins), /bytes differ/);
});

test('pnpm-owned in-consumer SDK root links are accepted, workspace package roots are refused', (t) => {
  const f = fixture(t),
    owned = join(
      f.consumer,
      'node_modules/.pnpm/account/node_modules/@input-output-hk/mn-passport-account',
    );
  mkdirSync(join(owned, '..'), { recursive: true });
  cpSync(f.account, owned, { recursive: true });
  rmSync(f.account, { recursive: true });
  symlinkSync(owned, f.account, 'dir');
  const context = installedQualityContext(f.pins);
  assert.doesNotThrow(() =>
    assertInstalledSdkResolution(
      context.roots,
      context.roots[0]?.name ?? '',
      join(owned, 'dist/index.d.ts'),
    ),
  );
  const escaped = join(f.repository, 'packages/account');
  mkdirSync(join(escaped, '..'), { recursive: true });
  cpSync(owned, escaped, { recursive: true });
  rmSync(f.account);
  symlinkSync(escaped, f.account, 'dir');
  assert.throws(() => installedQualityContext(f.pins), /escapes consumer/);
});

test('matching another audited SDK root cannot satisfy a requested package resolution', (t) => {
  const f = fixture(t),
    other = f.context.roots.find((root) => root.name.endsWith('-protocol'));
  assert.ok(other);
  assert.throws(
    () =>
      assertInstalledSdkResolution(
        f.context.roots,
        '@input-output-hk/mn-passport-account',
        join(other.root, 'dist/index.d.ts'),
      ),
    /escapes audited/,
  );
});

test('dependency byte/link drift and hidden duplicate SDK copies prevent unchanged-input acceptance', (t) => {
  const f = fixture(t),
    before = captureInstalledQuality(f.context);
  const external = join(f.consumer, 'node_modules/@midnight-ntwrk/compact-runtime/index.js');
  writeFileSync(external, 'export const synthetic=false;\n');
  assert.throws(
    () => assertQualityUnchanged(before, captureInstalledQuality(f.context)),
    /changed/,
  );
  const duplicate = join(f.consumer, 'node_modules/hidden-copy');
  cpSync(f.account, duplicate, { recursive: true });
  assert.throws(
    () => qualityTree(join(f.consumer, 'node_modules'), f.context.roots),
    /unaudited SDK/,
  );
});

test('strict Node/DOM/Worker compilation uses installed declarations and records actual compiler inputs', (t) => {
  const f = fixture(t);
  for (const target of /** @type {const} */ (['node', 'web', 'worker'])) {
    const result = compileInstalledProgram(f.context, join(f.consumer, 'compile-' + target), {
      target,
      documentation: false,
      sources: [
        {
          path: 'check.mts',
          code: "import {value} from '@input-output-hk/mn-passport-account'; export const checked:number=value;",
        },
      ],
    });
    assert.equal(result.sdkResolutions, 1);
    assert.ok(result.inputs.some((input) => input.path === join(f.account, 'dist/index.d.ts')));
    verifyCompilerInputs(result.inputs);
  }
});

test('broken Worker code prevents successful compilation and retains its diagnostics', (t) => {
  const f = fixture(t),
    output = join(f.consumer, 'bad-worker');
  assert.throws(
    () =>
      compileInstalledProgram(f.context, output, {
        target: 'worker',
        documentation: false,
        sources: [
          { path: 'worker.mts', code: 'export const worker:DedicatedWorkerGlobalScope=42;' },
        ],
      }),
    /worker compile failed/,
  );
  assert.match(readFileSync(join(output, 'diagnostics.log'), 'utf8'), /not assignable/);
});

test('admitted documentation compiles verbatim with relative public modules in all four target lanes', (t) => {
  const f = fixture(t);
  mkdirSync(join(f.repository, 'node_modules/@types'), { recursive: true });
  symlinkSync(
    resolve('node_modules/@types/node'),
    join(f.repository, 'node_modules/@types/node'),
    'dir',
  );
  writeFileSync(
    join(f.repository, 'docs/examples/public.ts'),
    "export {value} from '@input-output-hk/mn-passport-account';\n",
  );
  writeFileSync(
    join(f.repository, 'docs/site/index.md'),
    "```ts\nexport {value} from '../examples/public.js';\n```\n",
  );
  writeFileSync(
    join(f.repository, 'docs/examples/checked-snippets.json'),
    JSON.stringify({
      version: 1,
      pages: [
        { path: 'docs/site/index.md', fences: [{ targets: ['neutral', 'node', 'web', 'worker'] }] },
      ],
      files: [{ path: 'docs/examples/public.ts', targets: ['neutral', 'node', 'web', 'worker'] }],
    }),
  );
  const result = compileInstalledDocumentation(f.context, join(f.consumer, 'docs-compile'));
  assert.equal(result.examples.length, 8);
  assert.deepEqual(
    result.docs.map((lane) => lane.target),
    ['neutral', 'node', 'web', 'worker'],
  );
  assert.ok(
    result.docs.every(
      (lane) => lane.entries === 2 && lane.sdkResolutions === 1 && lane.skipLibCheck,
    ),
  );
  assert.ok(
    result.docs.every((lane) =>
      lane.inputs.some((input) => input.path === join(f.account, 'dist/index.d.ts')),
    ),
  );
});

test('a correct workspace alias cannot hide a broken installed declaration', (t) => {
  const f = fixture(t),
    workspace = join(f.repository, 'packages/account');
  mkdirSync(workspace, { recursive: true });
  writeFileSync(join(workspace, 'index.ts'), 'export const value:number=7;');
  writeFileSync(join(f.account, 'dist/index.d.ts'), 'export declare const value:string;');
  const output = join(f.consumer, 'no-alias');
  assert.throws(
    () =>
      compileInstalledProgram(f.context, output, {
        target: 'node',
        documentation: false,
        sources: [
          {
            path: 'check.mts',
            code: "import {value} from '@input-output-hk/mn-passport-account'; export const checked:number=value;",
          },
        ],
      }),
    /compile failed/,
  );
  assert.match(readFileSync(join(output, 'diagnostics.log'), 'utf8'), /string.*number/);
  assert.throws(
    () =>
      compileInstalledProgram(f.context, join(f.consumer, 'direct-alias'), {
        target: 'node',
        documentation: false,
        sources: [
          {
            path: 'check.mts',
            code: `import {value} from '${join(workspace, 'index.ts')}';export {value};`,
          },
        ],
      }),
    /compiler reached SDK workspace source or output/,
  );
});

test('compiler dependency changes after compilation are detected', (t) => {
  const f = fixture(t);
  const result = compileInstalledProgram(f.context, join(f.consumer, 'compile'), {
    target: 'node',
    documentation: false,
    sources: [
      { path: 'check.mts', code: "export {value} from '@input-output-hk/mn-passport-account';" },
    ],
  });
  writeFileSync(join(f.account, 'dist/index.d.ts'), 'export declare const value:never;');
  assert.throws(() => verifyCompilerInputs(result.inputs), /changed/);
});

test('runtime actually imports each JavaScript and JSON export through the installed graph', (t) => {
  const f = fixture(t);
  const result = importInstalledExports(f.context, join(f.consumer, 'runtime'), {
    custodySmoke: false,
  });
  assert.equal(result.imported, 18);
  assert.equal(result.exports.filter((entry) => entry.json).length, 9);
});

test('a throwing export cannot be counted as an imported package or a successful run', (t) => {
  const f = fixture(t);
  writeFileSync(join(f.account, 'dist/index.js'), "throw Error('synthetic export failure');\n");
  const output = join(f.consumer, 'bad-runtime');
  assert.throws(
    () => importInstalledExports(f.context, output, { custodySmoke: false }),
    /export import failed/,
  );
  assert.match(readFileSync(join(output, 'stderr.log'), 'utf8'), /synthetic export failure/);
  assert.doesNotMatch(readFileSync(join(output, 'stdout.log'), 'utf8'), /IMPORTED_EXPORT/);
});

test('missing export targets refuse before launching import execution', (t) => {
  const f = fixture(t);
  rmSync(join(f.account, 'dist/index.js'));
  assert.throws(() => installedRuntimeExports(f.context.roots), /ENOENT/);
});

test('an installed module importing a workspace file is refused by the runtime resolver', (t) => {
  const f = fixture(t),
    external = join(f.repository, 'outside.mjs');
  writeFileSync(external, 'export const fake=1;\n');
  writeFileSync(join(f.account, 'dist/index.js'), `import '${external}';\n`);
  const output = join(f.consumer, 'runtime-alias');
  assert.throws(
    () => importInstalledExports(f.context, output, { custodySmoke: false }),
    /export import failed/,
  );
  assert.match(readFileSync(join(output, 'stderr.log'), 'utf8'), /escapes installed consumer/);
});

test('runner failure retains a failed receipt; existing output cannot be overwritten', (t) => {
  const f = fixture(t),
    output = join(f.consumer, 'quality');
  assert.throws(() => runInstalledQuality({ ...f.pins, output }), /compile failed/);
  const receipt = JSON.parse(readFileSync(join(output, 'receipt.json'), 'utf8'));
  assert.equal(receipt.outcome, 'failed');
  assert.equal(receipt.claims.registryProvenance, false);
  assert.equal(receipt.claims.runnerInstallsPackages, false);
  assert.throws(() => installedQualityOutput(f.consumer, output), /already exists/);
  assert.throws(
    () => installedQualityOutput(f.consumer, join(f.repository, 'fresh')),
    /direct child/,
  );
  assert.equal(JSON.parse(readFileSync(join(output, 'receipt.json'), 'utf8')).outcome, 'failed');
});
