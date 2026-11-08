import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  realpathSync,
  symlinkSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  previewOutputRoot,
  verifyPreviewExports,
  assertPreviewSdkResolution,
  assertExternalPackage,
  previewBrowserGuard,
} from '../scripts/consumer/preview-quality.mjs';

const sdk = '@input-output-hk/mn-passport-account';
/** @param {import('node:test').TestContext} t */
function fixture(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'passport-preview-inputs-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const repo = join(root, 'repository'),
    preview = join(root, 'preview'),
    outside = join(root, 'external');
  for (const path of [repo, preview, outside]) mkdirSync(path);
  return { root, repo, preview, outside };
}

test('preview outputs require an absolute fresh root outside the repository and preserve failures', (t) => {
  const f = fixture(t);
  mkdirSync(join(f.repo, 'review'));
  assert.throws(() => previewOutputRoot(f.repo, join(f.repo, 'review', 'fresh')), /overlaps/);
  assert.throws(() => previewOutputRoot(f.repo, 'relative-preview'), /absolute/);
  const failed = join(f.root, 'failed');
  mkdirSync(failed);
  writeFileSync(join(failed, 'receipt.json'), 'original');
  assert.throws(() => previewOutputRoot(f.repo, failed), /already exists/);
  assert.equal(readFileSync(join(failed, 'receipt.json'), 'utf8'), 'original');
  const dangling = join(f.root, 'dangling');
  symlinkSync(join(f.root, 'absent'), dangling);
  assert.throws(() => previewOutputRoot(f.repo, dangling), /already exists/);
  const alias = join(f.root, 'repo-alias');
  symlinkSync(f.repo, alias, 'dir');
  assert.throws(() => previewOutputRoot(f.repo, join(alias, 'fresh')), /overlaps/);
  assert.equal(previewOutputRoot(f.repo, join(f.root, 'new')), join(f.root, 'new'));
});

test('preview exports validate every condition and reject missing targets or source/symlink escapes', (t) => {
  const f = fixture(t),
    pkg = join(f.preview, 'node_modules', sdk);
  mkdirSync(join(pkg, 'dist'), { recursive: true });
  writeFileSync(join(pkg, 'dist', 'index.js'), 'export {};');
  writeFileSync(join(pkg, 'dist', 'index.d.ts'), 'export {};');
  const exports = { '.': { types: './dist/index.d.ts', default: './dist/index.js' } };
  assert.equal(verifyPreviewExports(pkg, exports), 2);
  assert.throws(
    () =>
      verifyPreviewExports(pkg, {
        '.': { types: './dist/absent.d.ts', default: './dist/index.js' },
      }),
    /missing/,
  );
  assert.throws(() => verifyPreviewExports(pkg, { '.': '../external/file.js' }), /unsafe/);
  assert.throws(() => verifyPreviewExports(pkg, { '.': './src/index.ts' }), /unsafe/);
  writeFileSync(join(f.outside, 'outside.js'), 'export {};');
  symlinkSync(join(f.outside, 'outside.js'), join(pkg, 'dist', 'linked.js'));
  assert.throws(() => verifyPreviewExports(pkg, { '.': './dist/linked.js' }), /escaping/);
});

test('SDK resolution stays in the actual matching copied package; lexical and physical escapes refuse', (t) => {
  const f = fixture(t),
    pkg = join(f.preview, 'node_modules', sdk);
  mkdirSync(join(pkg, 'dist'), { recursive: true });
  const file = join(pkg, 'dist', 'index.d.ts');
  writeFileSync(file, 'export {};');
  assert.doesNotThrow(() => assertPreviewSdkResolution(f.preview, sdk, file));
  const escaped = join(f.outside, 'index.d.ts');
  writeFileSync(escaped, 'export {};');
  assert.throws(() => assertPreviewSdkResolution(f.preview, sdk, escaped), /escapes/);
  const link = join(pkg, 'dist', 'linked.d.ts');
  symlinkSync(escaped, link);
  assert.throws(() => assertPreviewSdkResolution(f.preview, sdk, link), /escapes/);
  const alias = '@input-output-hk/mn-passport-protocol',
    aliasRoot = join(f.preview, 'node_modules', alias);
  symlinkSync(pkg, aliasRoot, 'dir');
  assert.throws(() => assertPreviewSdkResolution(f.preview, alias, file), /escapes/);
});

test('external dependency reuse refuses SDK packages even behind non-SDK aliases', (t) => {
  const f = fixture(t);
  writeFileSync(join(f.outside, 'package.json'), JSON.stringify({ name: sdk, version: '0.0.0' }));
  assert.throws(() => assertExternalPackage(f.outside), /SDK package/);
  writeFileSync(
    join(f.outside, 'package.json'),
    JSON.stringify({ name: 'third-party', version: '1.2.3' }),
  );
  assert.deepEqual(assertExternalPackage(f.outside), { name: 'third-party', version: '1.2.3' });
});

test('Node guard permits only the recorded external absent-navigator probe and rejects SDK browser reads', (t) => {
  const f = fixture(t),
    guard = join(f.root, 'guard.mjs'),
    probe = join(f.outside, 'probe.mjs'),
    sdkRead = join(f.preview, 'sdk.mjs');
  writeFileSync(probe, `if(typeof navigator!=='undefined')throw Error('Browser state exposed');`);
  writeFileSync(sdkRead, 'void navigator;');
  writeFileSync(guard, previewBrowserGuard([probe]));
  const allowed = spawnSync(process.execPath, ['--import', guard, probe], { encoding: 'utf8' });
  assert.equal(allowed.status, 0, allowed.stderr);
  assert.match(allowed.stderr, /^EXTERNAL_BROWSER_PROBE /m);
  const refused = spawnSync(process.execPath, ['--import', guard, sdkRead], { encoding: 'utf8' });
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /Unexpected ambient browser access: navigator/);
  assert.doesNotMatch(refused.stderr, /^EXTERNAL_BROWSER_PROBE /m);
});
