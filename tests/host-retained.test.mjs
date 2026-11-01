import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  cpSync,
  symlinkSync,
  readFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  runtimeTreeIdentity,
  verifyHostEntryReceipt,
  hostConsumerHarness,
  verifyRetainedHostConsumer,
} from '../scripts/consumer/host-retained.mjs';
import { consumerSha256 } from '../scripts/consumer-inputs.mjs';
const repository = new URL('..', import.meta.url).pathname;

test('runtime identity binds physical paths, every runtime byte and file set, including WASM', () => {
  const root = mkdtempSync(join(tmpdir(), 'retained-runtime-'));
  try {
    const first = join(root, 'first'),
      second = join(root, 'second');
    mkdirSync(first);
    writeFileSync(join(first, 'package.json'), '{"version":"0.20.0"}');
    writeFileSync(join(first, 'runtime.wasm'), new Uint8Array([0, 1]));
    const original = runtimeTreeIdentity(first);
    cpSync(first, second, { recursive: true });
    assert.equal(runtimeTreeIdentity(second).treeSha256, original.treeSha256);
    assert.notDeepEqual(runtimeTreeIdentity(second), original);
    writeFileSync(join(first, 'runtime.wasm'), new Uint8Array([0, 2]));
    assert.notEqual(runtimeTreeIdentity(first).treeSha256, original.treeSha256);
    writeFileSync(join(first, 'runtime.wasm'), new Uint8Array([0, 1]));
    assert.deepEqual(runtimeTreeIdentity(first), original);
    writeFileSync(join(first, 'overlay.js'), 'overlay');
    assert.notEqual(runtimeTreeIdentity(first).treeSha256, original.treeSha256);
    rmSync(join(first, 'overlay.js'));
    symlinkSync(join(second, 'runtime.wasm'), join(first, 'overlay.wasm'));
    assert.throws(() => runtimeTreeIdentity(first), /symlink/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

function receipt() {
  const entries = ['experimental', 'midnight'].map((name) => ({
    entry: './' + name,
    hashes: { types: 'aa', import: 'bb', require: 'cc' },
  }));
  const config = {
    version: '0.1.0-rc6',
    pin: { name: '@laceio/sdk', version: '0.1.2-canary.2' },
    lockSha256: 'dd',
    installed: { host: { entries } },
    runtimeIdentity: { runtime: {} },
  };
  const entry = {
    kind: 'installed-published-host',
    sdkVersion: config.version,
    host: config.pin,
    lockSha256: 'dd',
    entryChecks: entries.map((e) => ({ ...e, esm: 'passed', cjs: 'passed' })),
    runtimeIdentity: ['runtime'],
    protocol: {
      kind: 'published-host-public-protocol',
      testsPassed: 13,
      cases: Array.from({ length: 13 }, (_, i) => 'case ' + i),
      fullCompatibility: false,
      realProvider: false,
    },
    fullCompatibility: false,
    realProvider: false,
    localnet: false,
  };
  return { config, entry };
}
test('inner receipt cannot substitute entry targets, hashes, runtimes or duplicate protocol cases', () => {
  const { config, entry } = receipt();
  verifyHostEntryReceipt(entry, config);
  /** @type {Array<(e: ReturnType<typeof receipt>['entry']) => void>} */
  const changes = [
    (e) => {
      assert.ok(e.entryChecks[0]);
      e.entryChecks[0].hashes.import = 'changed';
    },
    (e) => {
      assert.ok(e.entryChecks[0]);
      e.entryChecks[0].entry = './other';
    },
    (e) => {
      e.entryChecks.pop();
    },
    (e) => {
      e.runtimeIdentity = ['other'];
    },
    (e) => {
      assert.ok(e.protocol.cases[0]);
      e.protocol.cases[12] = e.protocol.cases[0];
    },
    (e) => {
      e.protocol.realProvider = true;
    },
    (e) => {
      e.localnet = true;
    },
  ];
  for (const alter of changes) {
    const changed = structuredClone(entry);
    alter(changed);
    assert.throws(() => verifyHostEntryReceipt(changed, config));
  }
});

test('retained inputs reject a different preparation harness before loading installed code', () => {
  const root = mkdtempSync(join(tmpdir(), 'host-prepare-provenance-'));
  try {
    const harness = hostConsumerHarness(repository);
    harness['scripts/consumer/installed-inputs.mjs'] = '00'.repeat(32);
    const config = {
      schemaVersion: 2,
      nodeVersion: process.version,
      version: '0.1.0-rc6',
      prepareHarness: harness,
    };
    writeFileSync(join(root, 'host-consumer-inputs.json'), JSON.stringify(config));
    const pin = consumerSha256(readFileSync(join(root, 'host-consumer-inputs.json')));
    assert.throws(
      () => verifyRetainedHostConsumer(root, pin, repository),
      /prepare\/run harness differs/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
