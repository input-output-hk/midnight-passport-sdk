// Retained, authenticated consumer inputs. These checks execute no installed package code.
import assert from 'node:assert/strict';
import { lstatSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { consumerSha256, isExactConsumerVersion } from '../consumer-inputs.mjs';
import { checkMidnightRuntimeIdentity } from '../check-midnight-runtime-identity.mjs';
import { auditHostConsumer, checkPublicationBundle } from './host-inputs.mjs';

const harnessFiles = [
  'scripts/qualify-host-consumer.mjs',
  'scripts/consumer/host-inputs.mjs',
  'scripts/consumer/host-retained.mjs',
  'scripts/consumer/installed-inputs.mjs',
  'scripts/consumer-inputs.mjs',
  'scripts/release-package-list.mjs',
  'scripts/smoke-lace-published-consumer.mjs',
  'scripts/check-midnight-runtime-identity.mjs',
  'tests/fixtures/lace-published-consumer.ts',
  'tests/fixtures/lace-published-runtime.js',
  'docs/examples/jubjub-grant-scope.ts',
];
/** @param {string} repository */
export function hostConsumerHarness(repository) {
  return Object.fromEntries(
    harnessFiles.map((file) => [file, consumerSha256(readFileSync(join(repository, file)))]),
  );
}

/** Bind the installed runtime tree as observed at preparation, including WASM and declarations.
 * This detects subsequent drift; the authenticated lock/registry supplies its initial provenance.
 * Exclude only dependencies at the package root (audited separately for physical identity).
 * @param {string} root
 */
export function runtimeTreeIdentity(root) {
  const hash = createHash('sha256');
  let files = 0;
  /** @param {string} relative */
  const walk = (relative) => {
    const path = join(root, relative),
      stat = lstatSync(path);
    if (stat.isSymbolicLink()) throw Error('runtime package contains a symlink');
    if (stat.isDirectory()) {
      for (const name of readdirSync(path).sort()) {
        if (!relative && name === 'node_modules') continue;
        walk(relative ? relative + '/' + name : name);
      }
    } else {
      if (!stat.isFile()) throw Error('runtime package contains a non-file');
      hash.update(relative + '\0' + consumerSha256(readFileSync(path)) + '\n');
      files++;
    }
  };
  walk('');
  if (!files) throw Error('runtime package is empty');
  return { path: root, files, treeSha256: hash.digest('hex') };
}
/** @param {string} root @param {string[]} entries */
export function retainedRuntimeIdentity(root, entries) {
  return Object.fromEntries(
    Object.entries(checkMidnightRuntimeIdentity(root, entries)).map(([name, path]) => [
      name,
      runtimeTreeIdentity(/** @type {string} */ (path)),
    ]),
  );
}
/** @param {string} root @param {string} expected @param {string} repository */
export function verifyRetainedHostConsumer(root, expected, repository) {
  const hash = (/** @type {string} */ file) => consumerSha256(readFileSync(join(root, file)));
  if (!/^[a-f0-9]{64}$/.test(expected) || hash('host-consumer-inputs.json') !== expected)
    throw Error('retained host consumer requires its external configuration SHA-256');
  const config = JSON.parse(readFileSync(join(root, 'host-consumer-inputs.json'), 'utf8'));
  if (
    config.schemaVersion !== 2 ||
    config.nodeVersion !== process.version ||
    !isExactConsumerVersion(config.version)
  )
    throw Error('host consumer schema, Node or version changed; prepare a fresh consumer');
  assert.deepEqual(
    hostConsumerHarness(repository),
    config.prepareHarness,
    'prepare/run harness differs; prepare a fresh consumer',
  );
  if (
    hash('package.json') !== config.packageJsonSha256 ||
    hash('pnpm-lock.yaml') !== config.lockSha256
  )
    throw Error('host consumer manifest or lock changed');
  const bundle = join(root, 'bundle');
  const inputs = checkPublicationBundle(
    bundle,
    config.version,
    readFileSync(join(bundle, 'publication-receipt.json')),
    config.receiptSha256,
  );
  if (
    inputs.manifestSha256 !== config.manifestSha256 ||
    JSON.stringify(auditHostConsumer(root, bundle, config.version, config.pin)) !==
      JSON.stringify(config.installed)
  )
    throw Error('host consumer installed bytes or archive changed');
  assert.deepEqual(
    retainedRuntimeIdentity(root, [config.pin.name, ...inputs.files.map((f) => f.name)]),
    config.runtimeIdentity,
    'host consumer physical runtime tree changed',
  );
  return config;
}
/** Inner evidence must name exactly the entries authenticated from the host archive.
 * @param {any} entry @param {any} config
 */
export function verifyHostEntryReceipt(entry, config) {
  assert.equal(entry.kind, 'installed-published-host');
  assert.equal(entry.sdkVersion, config.version);
  assert.equal(entry.host.name, config.pin.name);
  assert.equal(entry.host.version, config.pin.version);
  assert.equal(entry.lockSha256, config.lockSha256);
  assert.deepEqual(
    entry.entryChecks,
    config.installed.host.entries.map(
      (/** @type {{entry:string,hashes:Record<string,string>}} */ e) => ({
        ...e,
        esm: 'passed',
        cjs: 'passed',
      }),
    ),
  );
  assert.deepEqual(entry.runtimeIdentity.sort(), Object.keys(config.runtimeIdentity).sort());
  assert.equal(entry.protocol.kind, 'published-host-public-protocol');
  assert.equal(entry.protocol.testsPassed, 13);
  assert.equal(entry.protocol.cases.length, 13);
  assert.equal(new Set(entry.protocol.cases).size, 13);
  assert.ok(
    entry.protocol.cases.every((/** @type {unknown} */ c) => typeof c === 'string' && c.length),
  );
  for (const field of ['fullCompatibility', 'realProvider', 'localnet']) {
    assert.equal(entry[field], false);
    if (field !== 'localnet') assert.equal(entry.protocol[field], false);
  }
}
