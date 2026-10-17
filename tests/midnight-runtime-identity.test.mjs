import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { test } from 'node:test';
import { checkMidnightRuntimeIdentity } from '../scripts/check-midnight-runtime-identity.mjs';

const compact = '@midnight-ntwrk/compact-js';
const runtime = '@midnight-ntwrk/compact-runtime';
const ledger = '@midnightntwrk/ledger-v9';
const protocol = '@midnight-ntwrk/midnight-js-protocol';
const versions = { [compact]: '3.0.0-rc.3', [runtime]: '0.20.0', [ledger]: '1.0.0-rc.5' };

/** @param {import('node:test').TestContext} t */
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'mn-runtime-identity-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  /** @param {string} at @param {string} name @param {string} version @param {Record<string, string>} [dependencies] */
  const put = (at, name, version, dependencies = {}) => {
    const dir = join(at, 'node_modules', name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name, version, dependencies }));
    return dir;
  };
  for (const [name, version] of Object.entries(versions)) put(root, name, version);
  // A dependency can carry the old runtime under its intentional alias without participating
  // in Ledger 9 class identity. Its package.json name differs from the dependency alias.
  put(root, compact, versions[compact], {
    [runtime]: versions[runtime],
    'compact-runtime-ledger8': 'npm:@midnight-ntwrk/compact-runtime@0.16.0',
  });
  const parent = put(root, protocol, '5.0.0-rc.2', {
    [ledger]: versions[ledger],
    [compact]: versions[compact],
  });
  return { root, parent, put };
}

test('consumer runtime check accepts one physical copy and the explicit Ledger 8 alias', (t) => {
  const { root } = fixture(t);
  const found = checkMidnightRuntimeIdentity(root, [protocol]);
  assert.deepEqual(Object.keys(found).sort(), Object.keys(versions).sort());
});

test('consumer runtime check rejects same-version ledger class copies', (t) => {
  const { root, parent, put } = fixture(t);
  put(parent, ledger, versions[ledger]);
  assert.throws(
    () => checkMidnightRuntimeIdentity(root, [protocol, ledger]),
    /expected one physical runtime copy, found 2/,
  );
});

test('consumer runtime check canonicalises symlinks to the same package', (t) => {
  const { root, parent } = fixture(t);
  mkdirSync(join(parent, 'node_modules', '@midnightntwrk'), { recursive: true });
  symlinkSync(join(root, 'node_modules', ledger), join(parent, 'node_modules', ledger), 'dir');
  assert.doesNotThrow(() => checkMidnightRuntimeIdentity(root, [protocol, ledger]));
});

test('consumer runtime check rejects an unexpected current runtime version', (t) => {
  const { root, put } = fixture(t);
  put(root, runtime, '0.16.0');
  assert.throws(
    () => checkMidnightRuntimeIdentity(root, [protocol]),
    /expected 0.20.0, found 0.16.0/,
  );
});

test('consumer runtime check refuses missing declared dependencies', (t) => {
  const { root } = fixture(t);
  rmSync(join(root, 'node_modules', ledger), { recursive: true });
  assert.throws(() => checkMidnightRuntimeIdentity(root, [protocol]), /cannot resolve installed/);
});
