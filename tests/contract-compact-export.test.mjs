import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { gzipSync, gunzipSync } from 'node:zlib';

const root = resolve(import.meta.dirname, '..');
const contract = join(root, 'packages/contract');
const cli = 'bin/export-acc-compact.mjs';
const manifestPin = '77fb9c17b0d59047456c43115d9a58f5cb99a226ee73b6b974fd724930c3153f';
const hash = (/** @type {Uint8Array} */ bytes) => createHash('sha256').update(bytes).digest('hex');

function fixture(/** @type {import('node:test').TestContext} */ t, copy = false) {
  const dir = mkdtempSync(join(tmpdir(), 'passport-compact-export-test-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const packageRoot = copy ? join(dir, 'package') : contract;
  if (copy) {
    for (const part of ['bin', 'generated', 'resources'])
      cpSync(join(contract, part), join(packageRoot, part), { recursive: true });
  }
  const output = join(dir, 'dependencies');
  return {
    dir,
    output,
    packageRoot,
    run: (/** @type {string[]} */ ...extra) =>
      spawnSync(process.execPath, [join(packageRoot, cli), '--output', output, ...extra], {
        encoding: 'utf8',
      }),
  };
}

/** @param {string} packageRoot @param {(bundle: any) => unknown} change */
function mutateBundle(packageRoot, change) {
  const file = join(packageRoot, 'resources/acc-s3r1.1.zkir.json.gz');
  const bundle = JSON.parse(gunzipSync(readFileSync(file)).toString('utf8'));
  change(bundle);
  writeFileSync(file, gzipSync(JSON.stringify(bundle)));
}

test('installed contract CLI exports the pinned compiler layout without prover keys', (t) => {
  const f = fixture(t);
  const result = f.run('--manifest-sha256', manifestPin);
  assert.equal(result.status, 0, result.stderr);
  const receipt = JSON.parse(readFileSync(join(f.output, 'export-receipt.json'), 'utf8'));
  assert.equal(receipt.compilerManifestSha256, manifestPin);
  assert.equal(receipt.proverKeysIncluded, false);
  assert.equal(receipt.proofCircuits.length, 52);
  assert.equal(Object.keys(receipt.files).length, 161);
  assert.deepEqual(readdirSync(f.output).sort(), ['account', 'export-receipt.json']);
  assert.deepEqual(readdirSync(join(f.output, 'account')).sort(), [
    'compiler',
    'contract',
    'keys',
    'zkir',
  ]);
  for (const [name, pin] of Object.entries(receipt.files)) {
    assert.ok(!name.endsWith('.prover'));
    const bytes = readFileSync(join(f.output, 'account', name));
    assert.equal(bytes.length, pin.bytes);
    assert.equal(hash(bytes), pin.sha256);
  }
  assert.equal(
    hash(readFileSync(join(f.output, 'account/compiler/contract-manifest.json'))),
    manifestPin,
  );
});

for (const part of ['index.js', 'index.d.ts', 'index.js.map', 'contract-info.json']) {
  test(`substituted ${part} refuses before a compiler dependency is created`, (t) => {
    const f = fixture(t, true);
    const path = join(f.packageRoot, 'generated/acc-s3r1.1', part);
    const bytes = readFileSync(path);
    bytes[0] = (bytes[0] ?? 0) ^ 1;
    writeFileSync(path, bytes);
    const result = f.run();
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /differs from the pinned compiler manifest/);
    assert.equal(existsSync(f.output), false);
  });
}

/** @type {Array<[string, (bundle: any) => unknown, RegExp]>} */
const mutations = [
  ['manifest', (b) => (b.manifest += '\n'), /compiler manifest differs/],
  ['binding', (b) => (b.bindingId = 'foreign'), /unsupported key bundle/],
  [
    'missing file',
    (b) => delete b.files[Object.keys(b.files)[0] ?? 'absent'],
    /unexpected bundled file set/,
  ],
  ['extra file', (b) => (b.files['../escape'] = ''), /unexpected bundled file set/],
  [
    'unused verifier',
    (b) => {
      const key = Object.keys(b.files).find((name) => name.endsWith('.verifier'));
      assert.ok(key);
      const bytes = Buffer.from(b.files[key], 'base64');
      bytes[0] = (bytes[0] ?? 0) ^ 1;
      b.files[key] = bytes.toString('base64');
    },
    /differs from the pinned compiler manifest/,
  ],
  [
    'invalid base64',
    (b) => (b.files[Object.keys(b.files)[0] ?? 'absent'] = '*bad*'),
    /invalid bundled bytes/,
  ],
];
for (const [name, mutate, expected] of mutations) {
  test(`${name} tampering is refused before writing output`, (t) => {
    const f = fixture(t, true);
    mutateBundle(f.packageRoot, mutate);
    const result = f.run();
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, expected);
    assert.equal(existsSync(f.output), false);
  });
}

test('existing directories and symlink destinations are never reused or changed', (t) => {
  const f = fixture(t);
  const real = join(f.dir, 'retained');
  mkdirSync(real);
  writeFileSync(join(real, 'sentinel'), 'retain');
  symlinkSync(real, f.output);
  assert.match(f.run().stderr, /output already exists/);
  assert.deepEqual(readdirSync(real), ['sentinel']);
  rmSync(f.output);
  mkdirSync(f.output);
  assert.match(f.run().stderr, /output already exists/);
  assert.deepEqual(readdirSync(f.output), []);
});

test('unsupported binding, wrong independent pin and duplicate options write nothing', (t) => {
  const f = fixture(t);
  for (const args of [
    ['--binding', 'unknown'],
    ['--manifest-sha256', '00'.repeat(32)],
    ['--output', join(f.dir, 'another')],
    ['--unexpected', 'value'],
    ['--binding'],
  ]) {
    assert.notEqual(f.run(...args).status, 0);
    assert.equal(existsSync(f.output), false);
  }
});
