import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import {
  checkHostArchive,
  checkPublicationBundle,
  auditHostConsumer,
} from '../scripts/consumer/host-inputs.mjs';
import { consumerSha256 } from '../scripts/consumer-inputs.mjs';
import { releasePackageDirectories } from '../scripts/release-package-list.mjs';
const sri = (/** @type {Uint8Array} */ b) =>
  'sha512-' + createHash('sha512').update(b).digest('base64');
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'host-consumer-inputs-')),
    bundle = join(root, 'bundle'),
    source = join(root, 'source/package');
  mkdirSync(bundle);
  mkdirSync(join(source, 'dist'), { recursive: true });
  const version = '0.1.0-rc.test',
    hostVersion = '0.1.2-canary.test';
  const exports = Object.fromEntries(
    ['experimental', 'midnight'].map((name) => [
      './' + name,
      {
        types: './dist/' + name + '.d.ts',
        import: './dist/' + name + '.js',
        require: './dist/' + name + '.cjs',
      },
    ]),
  );
  const pkg = { name: '@laceio/sdk', version: hostVersion, exports };
  writeFileSync(join(source, 'package.json'), JSON.stringify(pkg));
  for (const name of ['experimental', 'midnight'])
    for (const ext of ['js', 'd.ts', 'cjs'])
      writeFileSync(join(source, 'dist', name + '.' + ext), '// pinned test artifact\n');
  const host = join(bundle, 'host.tgz');
  const packHost = () => execFileSync('tar', ['-czf', host, '-C', join(root, 'source'), 'package']);
  packHost();
  const bytes = readFileSync(host);
  const pin = {
    name: pkg.name,
    version: hostVersion,
    sha256: consumerSha256(bytes),
    integrity: sri(bytes),
  };
  mkdirSync(join(root, 'node_modules/@laceio'), { recursive: true });
  cpSync(source, join(root, 'node_modules/@laceio/sdk'), { recursive: true });
  rmSync(source, { recursive: true });
  mkdirSync(join(source, 'dist'), { recursive: true });
  const files = releasePackageDirectories.map((dir) => {
    const name = '@input-output-hk/mn-passport-' + dir,
      file = dir + '.tgz';
    writeFileSync(join(source, 'package.json'), JSON.stringify({ name, version }));
    writeFileSync(join(source, 'dist/index.js'), 'export const testFixture=true;');
    const installed = join(root, 'node_modules', name);
    mkdirSync(installed, { recursive: true });
    cpSync(source, installed, { recursive: true });
    execFileSync('tar', ['-czf', join(bundle, file), '-C', join(root, 'source'), 'package']);
    return { name, file, sha256: consumerSha256(readFileSync(join(bundle, file))) };
  });
  writeFileSync(join(bundle, 'manifest.json'), JSON.stringify({ version, files }));
  const publication = {
    version,
    packages: files.map((f) => ({
      name: f.name,
      version,
      sha256: f.sha256,
      integrity: sri(readFileSync(join(bundle, f.file))),
    })),
  };
  const receipt = Buffer.from(JSON.stringify(publication));
  writeFileSync(join(bundle, 'publication-receipt.json'), receipt);
  return {
    root,
    bundle,
    version,
    pin,
    pkg,
    publication,
    receipt,
    receiptSha256: consumerSha256(receipt),
    close: () => rmSync(root, { recursive: true, force: true }),
  };
}

test('host and all SDK installed bytes authenticate against independently pinned inputs', () => {
  const f = fixture();
  try {
    assert.equal(
      checkHostArchive(readFileSync(join(f.bundle, 'host.tgz')), f.pin).entries.length,
      2,
    );
    assert.equal(
      checkPublicationBundle(f.bundle, f.version, f.receipt, f.receiptSha256).files.length,
      9,
    );
    const result = auditHostConsumer(f.root, f.bundle, f.version, f.pin);
    assert.equal(result.host.installed.files, 7);
    assert.equal(result.sdk.packages.length, 9);
    assert.ok(!JSON.stringify(result).includes(f.root));
  } finally {
    f.close();
  }
});

test('host SHA, SRI and exact identity cannot be substituted by a version label', () => {
  const f = fixture();
  try {
    const bytes = readFileSync(join(f.bundle, 'host.tgz'));
    assert.throws(() => checkHostArchive(bytes, { ...f.pin, sha256: '00'.repeat(32) }), /SHA-256/);
    assert.throws(() => checkHostArchive(bytes, { ...f.pin, integrity: 'sha512-wrong' }), /SRI/);
    assert.throws(
      () => checkHostArchive(bytes, { ...f.pin, version: 'canary' }),
      /exact package identity/,
    );
    assert.throws(
      () => checkHostArchive(bytes, { ...f.pin, version: '0.1.2-canary.other' }),
      /package identity differs/,
    );
    assert.throws(
      () => checkHostArchive(bytes, { ...f.pin, name: '@other/sdk' }),
      /exact package identity/,
    );
  } finally {
    f.close();
  }
});

test('a consistent local bundle cannot silently replace externally pinned publication hashes or package set', () => {
  const f = fixture();
  try {
    assert.throws(
      () => checkPublicationBundle(f.bundle, f.version, f.receipt, '00'.repeat(32)),
      /external hash/,
    );
    const bad = structuredClone(f.publication);
    const p = bad.packages[0];
    assert.ok(p);
    p.integrity = 'sha512-wrong';
    let bytes = Buffer.from(JSON.stringify(bad));
    assert.throws(
      () => checkPublicationBundle(f.bundle, f.version, bytes, consumerSha256(bytes)),
      /SRI/,
    );
    const second = bad.packages[1];
    assert.ok(second);
    bad.packages[0] = second;
    bytes = Buffer.from(JSON.stringify(bad));
    assert.throws(
      () => checkPublicationBundle(f.bundle, f.version, bytes, consumerSha256(bytes)),
      /identity\/hash/,
    );
  } finally {
    f.close();
  }
});

test('host installed edits, overlays and symlinks are refused independently of its matching package version', () => {
  const f = fixture();
  try {
    const target = join(f.root, 'node_modules/@laceio/sdk/dist/experimental.js'),
      bytes = readFileSync(target);
    writeFileSync(target, 'throw Error("untrusted overlay executed")');
    assert.throws(() => auditHostConsumer(f.root, f.bundle, f.version, f.pin), /bytes differ/);
    writeFileSync(target, bytes);
    const extra = join(f.root, 'node_modules/@laceio/sdk/overlay.js');
    writeFileSync(extra, 'overlay');
    assert.throws(() => auditHostConsumer(f.root, f.bundle, f.version, f.pin), /file set differs/);
    rmSync(extra);
    rmSync(target);
    symlinkSync(join(f.root, 'node_modules/@laceio/sdk/dist/midnight.js'), target);
    assert.throws(() => auditHostConsumer(f.root, f.bundle, f.version, f.pin), /symlink/);
  } finally {
    f.close();
  }
});

test('unsafe or absent export targets are rejected before a public entry can be imported', () => {
  const f = fixture();
  try {
    const source = join(f.root, 'host-source/package');
    mkdirSync(source, { recursive: true });
    for (const target of ['../outside.js', './dist/../outside.js', './dist/missing.js']) {
      const pkg = structuredClone(f.pkg);
      const entry = pkg.exports['./experimental'];
      assert.ok(entry);
      entry.import = target;
      writeFileSync(join(source, 'package.json'), JSON.stringify(pkg));
      const path = join(f.root, 'unsafe-host.tgz');
      execFileSync('tar', ['-czf', path, '-C', join(f.root, 'host-source'), 'package']);
      const bytes = readFileSync(path);
      assert.throws(
        () =>
          checkHostArchive(bytes, {
            ...f.pin,
            sha256: consumerSha256(bytes),
            integrity: sri(bytes),
          }),
        /unsafe|absent/,
      );
    }
  } finally {
    f.close();
  }
});

test('retained run detects modified host code before spawning any host entry', () => {
  const f = fixture();
  try {
    writeFileSync(join(f.root, 'package.json'), '{}');
    writeFileSync(join(f.root, 'pnpm-lock.yaml'), 'test lock');
    const config = {
      schemaVersion: 1,
      version: f.version,
      pin: f.pin,
      receiptSha256: f.receiptSha256,
      manifestSha256: consumerSha256(readFileSync(join(f.bundle, 'manifest.json'))),
      packageJsonSha256: consumerSha256('{}'),
      lockSha256: consumerSha256('test lock'),
      installed: auditHostConsumer(f.root, f.bundle, f.version, f.pin),
      runtimeIdentity: [],
      nodeVersion: process.version,
    };
    const bytes = Buffer.from(JSON.stringify(config));
    writeFileSync(join(f.root, 'host-consumer-inputs.json'), bytes);
    const target = join(f.root, 'node_modules/@laceio/sdk/dist/experimental.js');
    writeFileSync(
      target,
      'import {writeFileSync} from "node:fs";writeFileSync("UNTRUSTED-HOST-RAN","bad");',
    );
    /** @type {NodeJS.ProcessEnv} */
    const env = {
      ...process.env,
      CONSUMER_ROOT: f.root,
      CONSUMER_CONFIG_SHA256: consumerSha256(bytes),
    };
    delete env.NODE_OPTIONS;
    delete env.NODE_PATH;
    const result = spawnSync(
      process.execPath,
      [resolve('scripts/qualify-host-consumer.mjs'), 'run'],
      { env, encoding: 'utf8', timeout: 15000 },
    );
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /bytes differ/);
    assert.equal(existsSync(join(f.root, 'sdk-published-consumer.ts')), false);
    assert.equal(existsSync(join(f.root, 'UNTRUSTED-HOST-RAN')), false);
    writeFileSync(
      join(f.root, 'host-consumer-inputs.json'),
      Buffer.concat([bytes, Buffer.from(' ')]),
    );
    const changed = spawnSync(
      process.execPath,
      [resolve('scripts/qualify-host-consumer.mjs'), 'run'],
      { env, encoding: 'utf8', timeout: 15000 },
    );
    assert.match(changed.stderr, /external configuration SHA/);
  } finally {
    f.close();
  }
});
