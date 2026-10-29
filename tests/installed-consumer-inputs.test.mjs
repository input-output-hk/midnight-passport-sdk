import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { gzipSync, gunzipSync } from 'node:zlib';
import { auditInstalledBundle, packageArchive } from '../scripts/consumer/installed-inputs.mjs';
import { consumerSha256 } from '../scripts/consumer-inputs.mjs';
import { releasePackageDirectories } from '../scripts/release-package-list.mjs';

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'installed-inputs-')),
    bundle = join(root, 'bundle'),
    consumer = join(root, 'consumer'),
    source = join(root, 'source');
  mkdirSync(bundle);
  mkdirSync(consumer);
  mkdirSync(join(source, 'package/dist'), { recursive: true });
  const version = '0.1.0-installed.test';
  const files = releasePackageDirectories.map((dir) => {
    const name = '@input-output-hk/mn-passport-' + dir,
      file = dir + '.tgz';
    writeFileSync(join(source, 'package/package.json'), JSON.stringify({ name, version }));
    writeFileSync(
      join(source, 'package/dist/index.js'),
      'export const name = ' + JSON.stringify(name) + ';\n',
    );
    const target = join(consumer, 'node_modules', name);
    mkdirSync(target, { recursive: true });
    cpSync(join(source, 'package'), target, { recursive: true });
    execFileSync('tar', ['-czf', join(bundle, file), '-C', source, 'package']);
    return { name, file, sha256: consumerSha256(readFileSync(join(bundle, file))) };
  });
  const [first, second] = files;
  assert.ok(first && second);
  writeFileSync(join(bundle, 'manifest.json'), JSON.stringify({ version, files }));
  return {
    root,
    bundle,
    consumer,
    version,
    files,
    first,
    second,
    audit: () => auditInstalledBundle(consumer, bundle, version),
    close: () => rmSync(root, { recursive: true, force: true }),
  };
}

test('installed SDK audit checks every file, package identity and supplied tarball without leaking paths', () => {
  const f = fixture();
  try {
    const audit = f.audit();
    assert.equal(audit.packages.length, 9);
    assert.ok(audit.packages.every((p) => p.files === 2 && p.version === f.version));
    assert.ok(!JSON.stringify(audit).includes(f.root));
    const file = join(f.consumer, 'node_modules', f.first.name, 'dist/index.js');
    const original = readFileSync(file);
    writeFileSync(file, 'export const corrupt = true;');
    assert.throws(f.audit, /bytes differ/);
    writeFileSync(file, original);
    writeFileSync(join(f.consumer, 'node_modules', f.first.name, 'unexpected.js'), 'overlay');
    assert.throws(f.audit, /file set differs/);
  } finally {
    f.close();
  }
});

test('missing files, installed symlinks and escaped package roots cannot count as installed acceptance', () => {
  const f = fixture();
  try {
    const folder = join(f.consumer, 'node_modules', f.first.name),
      file = join(folder, 'dist/index.js'),
      saved = readFileSync(file);
    rmSync(file);
    assert.throws(f.audit, /file set differs/);
    const external = join(f.root, 'external.js');
    writeFileSync(external, saved);
    symlinkSync(external, file);
    assert.throws(f.audit, /symlink/);
    rmSync(file);
    writeFileSync(file, saved);
    const outside = join(f.root, 'outside');
    cpSync(folder, outside, { recursive: true });
    rmSync(folder, { recursive: true });
    symlinkSync(outside, folder);
    assert.throws(f.audit, /escapes consumer/);
  } finally {
    f.close();
  }
});

test('manifest-consistent bytes still require the packed name and version to match', () => {
  const f = fixture();
  try {
    f.first.file = f.second.file;
    f.first.sha256 = f.second.sha256;
    // Duplicate archive names are rejected before package execution.
    writeFileSync(
      join(f.bundle, 'manifest.json'),
      JSON.stringify({ version: f.version, files: f.files }),
    );
    assert.throws(f.audit, /duplicated/);
    f.first.file = 'different.tgz';
    cpSync(join(f.bundle, f.second.file), join(f.bundle, 'different.tgz'));
    writeFileSync(
      join(f.bundle, 'manifest.json'),
      JSON.stringify({ version: f.version, files: f.files }),
    );
    assert.throws(f.audit, /package identity differs/);
  } finally {
    f.close();
  }
});

test('archive integrity refuses bad checksums, truncation, links and appended tar contents', () => {
  const f = fixture();
  try {
    const archive = readFileSync(join(f.bundle, f.first.file));
    assert.equal(packageArchive(archive).size, 2);
    const bad = gunzipSync(archive);
    bad[0] = (bad[0] ?? 0) ^ 1;
    assert.throws(() => packageArchive(gzipSync(bad)), /checksum/);
    const bytes = gunzipSync(archive);
    assert.throws(() => packageArchive(gzipSync(bytes.subarray(0, 700))), /truncated|incomplete/);
    assert.throws(
      () => packageArchive(gzipSync(Buffer.concat([bytes, Buffer.from('trailing')]))),
      /trailing/,
    );
    const source = join(f.root, 'link-source');
    mkdirSync(join(source, 'package'), { recursive: true });
    writeFileSync(join(source, 'package/package.json'), '{}');
    symlinkSync('/tmp/external', join(source, 'package/linked'));
    const linked = join(f.root, 'links.tgz');
    execFileSync('tar', ['-czf', linked, '-C', source, 'package']);
    assert.throws(() => packageArchive(readFileSync(linked)), /links|special/);
  } finally {
    f.close();
  }
});

test('long package filenames retain PAX/ustar path semantics without filesystem extraction', () => {
  const f = fixture();
  try {
    const source = join(f.root, 'long-source');
    mkdirSync(join(source, 'package'), { recursive: true });
    writeFileSync(join(source, 'package/package.json'), '{}');
    const name = 'x'.repeat(150) + '.js';
    writeFileSync(join(source, 'package', name), 'long');
    const path = join(f.root, 'long.tgz');
    execFileSync('tar', ['--format=pax', '-czf', path, '-C', source, 'package']);
    assert.equal(packageArchive(readFileSync(path)).get(name)?.toString(), 'long');
  } finally {
    f.close();
  }
});

test('archive traversal and duplicate regular file entries are refused before installation', () => {
  const f = fixture();
  try {
    const source = join(f.root, 'source'),
      unsafe = join(f.root, 'unsafe.tgz'),
      duplicate = join(f.root, 'duplicate.tgz');
    execFileSync('tar', [
      '-czf',
      unsafe,
      '--transform=s|package/dist|../outside|',
      '-C',
      source,
      'package',
    ]);
    assert.throws(() => packageArchive(readFileSync(unsafe)), /unsafe tar package path/);
    execFileSync('tar', [
      '--hard-dereference',
      '-czf',
      duplicate,
      '-C',
      source,
      'package/package.json',
      'package/package.json',
    ]);
    assert.throws(() => packageArchive(readFileSync(duplicate)), /duplicate tar file/);
  } finally {
    f.close();
  }
});
