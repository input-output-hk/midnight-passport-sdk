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
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import {
  runtimeTreeIdentity,
  verifyHostEntryReceipt,
  hostConsumerHarness,
  verifyRetainedHostConsumer,
  installedTreeIdentity,
  requireFreshHostOutputs,
  HOST_ENTRY_OUTPUTS,
  HOST_ENTRY_CHECKS,
} from '../scripts/consumer/host-retained.mjs';
import { consumerSha256 } from '../scripts/consumer-inputs.mjs';
const repository = fileURLToPath(new URL('..', import.meta.url));

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
    checks: [...HOST_ENTRY_CHECKS],
    protocol: {
      kind: 'published-host-public-protocol',
      testsPassed: 13,
      cases: Array.from({ length: 13 }, (_, i) => 'case ' + i),
      fullCompatibility: false,
      realProvider: false,
      syntheticTransport: true,
      hostSignerHandlers: false,
      signerPage: false,
      nativeProof: false,
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
      e.checks.pop();
    },
    (e) => {
      e.protocol.nativeProof = true;
    },
    (e) => {
      e.protocol.syntheticTransport = false;
    },
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

test('all installed tooling bytes and dependency links are retained', () => {
  const root = mkdtempSync(join(tmpdir(), 'host-installed-tree-'));
  try {
    const mods = join(root, 'node_modules');
    mkdirSync(mods);
    const tool = join(mods, 'compiler');
    mkdirSync(tool);
    writeFileSync(join(tool, 'index.js'), 'tool');
    symlinkSync('compiler', join(mods, 'tool'));
    const before = installedTreeIdentity(root);
    assert.equal(before.links, 1);
    writeFileSync(join(tool, 'index.js'), 'tampered');
    assert.notDeepEqual(installedTreeIdentity(root), before);
    writeFileSync(join(tool, 'index.js'), 'tool');
    assert.deepEqual(installedTreeIdentity(root), before);
    symlinkSync(root, join(mods, 'escape'));
    assert.throws(() => installedTreeIdentity(root), /escapes consumer/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('an interrupted output refuses the next host import without rerunning the failed fixture', () => {
  const root = mkdtempSync(join(tmpdir(), 'host-interrupted-'));
  try {
    requireFreshHostOutputs(root);
    for (const name of HOST_ENTRY_OUTPUTS) {
      writeFileSync(join(root, name), 'retained failed output');
      assert.throws(() => requireFreshHostOutputs(root), /preserve the earlier run/);
      rmSync(join(root, name));
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('every relative harness import remains bound, including copied example paths', () => {
  const hashes = hostConsumerHarness(repository);
  /** @type {Record<string, string>} */
  const mapped = {
    'tests/fixtures/lace-published-consumer.ts:./jubjub-grant-scope':
      'docs/examples/jubjub-grant-scope.ts',
    'tests/fixtures/lace-published-runtime.js:./host-example/jubjub-grant-scope.js':
      'docs/examples/jubjub-grant-scope.ts',
  };
  for (const file of Object.keys(hashes)) {
    const bytes = readFileSync(join(repository, file), 'utf8');
    for (const [, specifier] of bytes.matchAll(/(?:from|import)\s*['"](\.[^'"]+)['"]/g)) {
      assert.ok(specifier);
      const target = Object.hasOwn(mapped, file + ':' + specifier)
        ? mapped[file + ':' + specifier]
        : relative(
            repository,
            fileURLToPath(new URL(specifier, new URL(file, new URL('../', import.meta.url)))),
          );
      assert.ok(target && Object.hasOwn(hashes, target), file + ' imports unbound ' + target);
    }
  }
});
