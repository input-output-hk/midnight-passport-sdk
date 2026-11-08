import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';
import { installedCryptoFixture, cryptoPackage } from './fixtures/installed-crypto-fixture.mjs';
import {
  cryptoOutput,
  captureCryptoInputs,
  verifyCryptoResolutions,
  readCryptoResult,
} from '../scripts/consumer/installed-crypto-inputs.mjs';
import { runInstalledCrypto } from '../scripts/consumer/installed-crypto.mjs';
import { runCryptoChild } from '../scripts/consumer/installed-crypto-process.mjs';
import { resolveCryptoExport } from '../scripts/consumer/crypto/modules.mjs';
import { cryptoNodeGuard, installedCryptoGuard } from '../scripts/consumer/crypto/node-guard.mjs';
import {
  cryptoCaseNames,
  cryptoClaims,
  validateCryptoResult,
} from '../scripts/consumer/crypto/contracts.mjs';
import {
  qualityFile,
  assertQualityUnchanged,
} from '../scripts/consumer/installed-quality-inputs.mjs';

/** @param {import('node:test').TestContext} t */
function fixture(t) {
  const f = installedCryptoFixture();
  t.after(() => rmSync(f.root, { recursive: true, force: true }));
  return f;
}
const passedResult = () => ({
  schemaVersion: 1,
  kind: 'installed-software-crypto',
  outcome: 'passed',
  failure: null,
  cases: cryptoCaseNames.map((name) => ({ name, outcome: 'passed' })),
  resolutions: [{}],
  claims: cryptoClaims,
});

test('public crypto resolution follows the selected parent instead of a top-level decoy', (t) => {
  const f = fixture(t),
    selected = resolveCryptoExport('synthetic-dependency', f.parent, f.consumer);
  assert.equal(selected.path, f.selected);
  assert.equal(selected.version, '1.0.0');
  assert.notEqual(selected.path, f.decoy);
  assert.doesNotThrow(() => verifyCryptoResolutions(f.context, [selected]));
  writeFileSync(f.selected, 'export const changed=true;\n');
  assert.throws(() => verifyCryptoResolutions(f.context, [selected]), /changed/);
});

test('parent exports escaping the consumer or absent public subpaths refuse', (t) => {
  const f = fixture(t),
    target = join(f.repository, 'outside');
  cryptoPackage(f.repository, 'outside', '1.0.0');
  rmSync(dirname(f.selected), { recursive: true });
  symlinkSync(target, dirname(f.selected), 'dir');
  assert.throws(() => resolveCryptoExport('synthetic-dependency', f.parent, f.consumer), /escapes/);
  assert.throws(
    () => resolveCryptoExport('synthetic-parent/private.js', f.parent, f.consumer),
    /not defined/,
  );
  assert.throws(() => resolveCryptoExport('../private.js', f.parent, f.consumer), /Invalid/);
});

test('external pins and existing or escaped outputs refuse before creating a run', async (t) => {
  const f = fixture(t),
    output = join(f.consumer, 'crypto-new');
  await assert.rejects(
    runInstalledCrypto({ ...f.pins, lockSha256: '0'.repeat(64), output }),
    /pins/,
  );
  assert.throws(() => readFileSync(join(output, 'receipt.json')), /ENOENT/);
  assert.throws(() => cryptoOutput(f.consumer, join(f.repository, 'escape')), /direct/);
  mkdirSync(output);
  writeFileSync(join(output, 'preserved'), 'original');
  assert.throws(() => cryptoOutput(f.consumer, output), /fresh/);
  assert.equal(readFileSync(join(output, 'preserved'), 'utf8'), 'original');
});

test('crypto snapshot is independent of developer TypeScript/source/docs and detects dependency drift', (t) => {
  const f = fixture(t),
    before = captureCryptoInputs(f.context);
  rmSync(join(f.repository, 'packages'), { recursive: true });
  rmSync(join(f.repository, 'docs'), { recursive: true });
  assert.doesNotThrow(() => assertQualityUnchanged(before, captureCryptoInputs(f.context)));
  writeFileSync(f.decoy, 'export const changed=true;\n');
  assert.throws(() => assertQualityUnchanged(before, captureCryptoInputs(f.context)), /changed/);
});

test('missing reviewed guard profile yields failed receipt and after-audit, not synthetic crypto acceptance', async (t) => {
  const f = fixture(t),
    output = join(f.consumer, 'crypto-failed');
  await assert.rejects(runInstalledCrypto({ ...f.pins, output }));
  const receipt = JSON.parse(readFileSync(join(output, 'receipt.json'), 'utf8'));
  assert.equal(receipt.outcome, 'failed');
  assert.equal(receipt.failure.phase, 'setup');
  assert.equal(receipt.inputsUnchanged, true);
  assert.equal(receipt.child, undefined);
  assert.equal(receipt.result, undefined);
});

test('unreviewed wasm or Zod feature-probe bytes cannot obtain a Node guard', (t) => {
  const f = fixture(t);
  const runtime = join(f.modules, '@midnight-ntwrk/compact-runtime');
  writeFileSync(
    join(runtime, 'package.json'),
    JSON.stringify({
      name: '@midnight-ntwrk/compact-runtime',
      version: '0.20.0',
      exports: './index.js',
    }),
  );
  const wasm = cryptoPackage(f.modules, '@midnightntwrk/onchain-runtime-v4', '4.0.0-rc.4');
  writeFileSync(
    join(dirname(wasm), 'midnight_onchain_runtime_wasm_bg.js'),
    'export const unreviewed=true;',
  );
  const zod = cryptoPackage(f.modules, 'zod', '4.1.12');
  writeFileSync(
    join(dirname(zod), 'package.json'),
    JSON.stringify({ name: 'zod', version: '4.1.12' }),
  );
  mkdirSync(join(dirname(zod), 'v4/core'), { recursive: true });
  writeFileSync(join(dirname(zod), 'v4/core/util.js'), 'export const unreviewed=true;');
  assert.throws(() => installedCryptoGuard(f.context), /Unreviewed/);
});

test('closed case inventory rejects omissions, duplicates, failed cases and overclaims', () => {
  assert.doesNotThrow(() => validateCryptoResult(passedResult()));
  for (const result of [
    { ...passedResult(), cases: passedResult().cases.slice(1) },
    {
      ...passedResult(),
      cases: cryptoCaseNames.map(() => ({ name: cryptoCaseNames[0], outcome: 'passed' })),
    },
    { ...passedResult(), cases: cryptoCaseNames.map((name) => ({ name, outcome: 'failed' })) },
    { ...passedResult(), claims: { ...cryptoClaims, nativeProof: true } },
    { ...passedResult(), failure: 'partial' },
    { ...passedResult(), resolutions: [] },
  ])
    assert.throws(() => validateCryptoResult(result), /crypto/);
});

test('result read refuses oversized files and symlink substitutes', (t) => {
  const f = fixture(t),
    file = join(f.consumer, 'result.json');
  writeFileSync(file, ' '.repeat(256 * 1024 + 1));
  assert.throws(() => readCryptoResult(file), /Invalid/);
  rmSync(file);
  symlinkSync(join(f.consumer, 'package.json'), file);
  assert.throws(() => readCryptoResult(file), /Invalid/);
});

test('owned child timeout escalates through ignored SIGTERM and leaves no live process', async (t) => {
  const f = fixture(t);
  const result = await runCryptoChild(
    ['-e', "process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"],
    { cwd: f.consumer, timeoutMs: 500 },
  );
  assert.equal(result.outcome, 'timeout');
  assert.equal(result.signal, 'SIGKILL');
  assert.ok(result.elapsedMs < 5000);
});

test('owned early failure and excessive output settle as failures without an unhandled promise', async (t) => {
  const f = fixture(t);
  const failed = await runCryptoChild(['-e', "throw Error('owned failure')"], { cwd: f.consumer });
  assert.equal(failed.outcome, 'failed');
  assert.equal(failed.exitCode, 1);
  assert.match(failed.stderr.toString(), /owned failure/);
  const noisy = await runCryptoChild(
    ['-e', "setInterval(()=>process.stdout.write('x'.repeat(4096)),1)"],
    { cwd: f.consumer, maxOutputBytes: 64 },
  );
  assert.equal(noisy.outcome, 'output-limit');
  assert.ok(noisy.outputBytes > 64);
  assert.ok(noisy.stdout.length <= 64);
});

test('browser guard permits only its exact reviewed caller and denies nearby or direct access', async (t) => {
  const f = fixture(t),
    directory = join(f.consumer, 'guard-test');
  mkdirSync(directory);
  const feature = join(directory, 'feature.mjs');
  writeFileSync(
    feature,
    'export function reviewed(){return typeof window;}\nexport function nearby(){return typeof window;}\n',
  );
  const guard = join(directory, 'guard.mjs');
  writeFileSync(
    guard,
    cryptoNodeGuard([
      {
        name: 'window',
        prefix: 'at reviewed (' + pathToFileURL(feature).href + ':',
        file: qualityFile(feature),
      },
    ]),
  );
  const entry = join(directory, 'entry.mjs');
  writeFileSync(
    entry,
    "import assert from 'node:assert/strict';import{reviewed,nearby}from'./feature.mjs';assert.equal(reviewed(),'undefined');assert.throws(()=>nearby(),/ambient/);assert.throws(()=>globalThis.document,/ambient/);assert.throws(()=>globalThis.window,/ambient/);",
  );
  const result = await runCryptoChild(['--import', guard, entry], { cwd: directory });
  assert.equal(result.outcome, 'passed', result.stderr.toString());
  assert.match(result.stderr.toString(), /CRYPTO_NODE_FEATURE_PROBE/);
});
