import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { qualityInventory, qualityFailures } from '../scripts/code-quality.mjs';

const cli = fileURLToPath(new URL('../scripts/code-quality.mjs', import.meta.url));
const complex = 'function branches(){\n' + 'if (true) {}\n'.repeat(26) + '}\n';

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'consumer-ast-inventory-'));
  const write = (/** @type {string} */ path, /** @type {string} */ text) => {
    const target = join(root, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, text);
  };
  write('packages/example/src/index.ts', 'export const value: number = 1;');
  write('apps/passport-dapp/src/app.ts', 'export const app = 1;');
  write('scripts/consumer/index.mjs', 'export const entry = 1;');
  mkdirSync(join(root, 'scripts/release'));
  mkdirSync(join(root, 'scripts/ci'));
  write('scripts/architecture-source.mjs', 'export const parser = 1;');
  write('scripts/lint-boundaries.mjs', 'export const boundary = 1;');
  write('apps/passport-dapp/e2e/demo-journeys.e2e.ts', 'export const run = 1;');
  mkdirSync(join(root, 'apps/passport-dapp/e2e/journeys'), { recursive: true });
  write('scripts/code-quality-budgets.json', JSON.stringify({ files: {} }));
  return { root, write, close: () => rmSync(root, { recursive: true, force: true }) };
}

test('consumer inventory discovers nested mjs while preserving existing TS scope and named exclusions', () => {
  const f = fixture();
  try {
    f.write('scripts/consumer/crypto/nested/check.mjs', 'export const check = 1;');
    f.write('scripts/consumer/ignored.ts', complex);
    f.write('scripts/unrelated.mjs', complex);
    f.write('packages/example/src/ignored.mjs', complex);
    f.write('packages/example/src/hand.generated.ts', 'export const authored = 1;');
    f.write('packages/contract/src/capabilities.generated.ts', complex);
    const inventory = qualityInventory(f.root);
    assert.deepEqual(Object.keys(inventory).sort(), [
      'apps/passport-dapp/e2e/demo-journeys.e2e.ts',
      'apps/passport-dapp/src/app.ts',
      'packages/example/src/hand.generated.ts',
      'packages/example/src/index.ts',
      'scripts/architecture-source.mjs',
      'scripts/consumer/crypto/nested/check.mjs',
      'scripts/consumer/index.mjs',
      'scripts/lint-boundaries.mjs',
    ]);
  } finally {
    f.close();
  }
});

test('new release acceptance modules use default AST ceilings without executing operator code', () => {
  const f = fixture();
  try {
    f.write('scripts/release/new/check.mjs', "throw Error('must not execute');\n" + complex);
    const child = spawnSync(process.execPath, [cli], {
      cwd: f.root,
      encoding: 'utf8',
      timeout: 10000,
    });
    assert.ifError(child.error);
    assert.equal(child.status, 1);
    assert.match(child.stderr, /scripts\/release\/new\/check\.mjs: complexity: 27 exceeds 25/);
    assert.equal(child.stderr.includes('must not execute'), false);
  } finally {
    f.close();
  }
});

test('a new nested consumer module is rejected by the actual CLI default budget without execution', () => {
  const f = fixture();
  try {
    const path = 'scripts/consumer/new/nested.mjs';
    f.write(path, "throw Error('fixture must never execute');\n" + complex);
    const report = qualityInventory(f.root)[path];
    assert.ok(report);
    assert.deepEqual(qualityFailures(report.metrics), ['complexity: 27 exceeds 25']);
    const child = spawnSync(process.execPath, [cli], {
      cwd: f.root,
      encoding: 'utf8',
      timeout: 10000,
      maxBuffer: 128 * 1024,
    });
    assert.ifError(child.error);
    assert.equal(child.status, 1);
    assert.match(child.stderr, /scripts\/consumer\/new\/nested\.mjs: complexity: 27 exceeds 25/);
    assert.equal(child.stderr.includes('fixture must never execute'), false);
    f.write(path, 'export const safe = 1;');
    const accepted = spawnSync(process.execPath, [cli], {
      cwd: f.root,
      encoding: 'utf8',
      timeout: 10000,
      maxBuffer: 128 * 1024,
    });
    assert.ifError(accepted.error);
    assert.equal(accepted.status, 0, accepted.stderr);
    assert.match(accepted.stdout, /AST quality budgets respected in 7 authored files/);
  } finally {
    f.close();
  }
});

test('existing package and demo TS modules retain default unsafe-escape checks', () => {
  const f = fixture();
  try {
    f.write('packages/example/src/index.ts', 'export function x(value: any) {return value;}');
    f.write(
      'apps/passport-dapp/src/app.ts',
      'export const app = (undefined as string | undefined)!;',
    );
    const inventory = qualityInventory(f.root);
    assert.equal(inventory['packages/example/src/index.ts']?.metrics.explicitAny, 1);
    assert.equal(inventory['apps/passport-dapp/src/app.ts']?.metrics.nonNull, 1);
    assert.ok(qualityFailures(inventory['packages/example/src/index.ts']?.metrics ?? {}).length);
  } finally {
    f.close();
  }
});

test('journey phases and catalogs keep default budgets through the permanent CLI', () => {
  const f = fixture();
  try {
    const paths = [
      'apps/passport-dapp/e2e/journeys/nested/phase.ts',
      'apps/passport-dapp/e2e/journeys/nested/catalog.mjs',
    ];
    for (const path of paths) f.write(path, "throw Error('must not execute');\n" + complex);
    const inventory = qualityInventory(f.root);
    for (const path of paths)
      assert.deepEqual(qualityFailures(inventory[path]?.metrics ?? {}), [
        'complexity: 27 exceeds 25',
      ]);
    const child = spawnSync(process.execPath, [cli], {
      cwd: f.root,
      encoding: 'utf8',
      timeout: 10000,
      maxBuffer: 128 * 1024,
    });
    assert.ifError(child.error);
    assert.equal(child.status, 1);
    for (const path of paths)
      assert.ok(child.stderr.includes(path + ': complexity: 27 exceeds 25'));
    assert.equal(child.stderr.includes('must not execute'), false);
  } finally {
    f.close();
  }
});

test('backend application TypeScript and key-service JavaScript enter default budgets without execution', () => {
  const f = fixture();
  try {
    const paths = [
      'apps/passport-service/src/nested/route.ts',
      'apps/passport-funding-service/src/nested/wallet.ts',
      'apps/passport-key-service/src/nested/server.mjs',
      'apps/passport-service/src/nested/bridge.mts',
      'apps/passport-service/src/nested/bridge.cts',
      'apps/passport-key-service/src/nested/entry.js',
      'apps/passport-key-service/src/nested/entry.cjs',
    ];
    for (const path of paths) f.write(path, "throw Error('must never execute');\n" + complex);
    const inventory = qualityInventory(f.root);
    for (const path of paths)
      assert.deepEqual(qualityFailures(inventory[path]?.metrics ?? {}), [
        'complexity: 27 exceeds 25',
      ]);
    const child = spawnSync(process.execPath, [cli], {
      cwd: f.root,
      encoding: 'utf8',
      timeout: 10000,
    });
    assert.ifError(child.error);
    assert.equal(child.status, 1);
    for (const path of paths)
      assert.ok(child.stderr.includes(path + ': complexity: 27 exceeds 25'));
    assert.equal(child.stderr.includes('must never execute'), false);
  } finally {
    f.close();
  }
});
