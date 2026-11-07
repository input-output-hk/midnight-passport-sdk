import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { publishedSources } from '../scripts/package-inventory.mjs';
import { coverageInventoryFailures } from '../scripts/coverage-policy.mjs';

test('coverage inventories unimported executable files and classifies emitted type-only stubs', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'passport-coverage-inventory-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const pkg = join(root, 'packages/public');
  mkdirSync(join(pkg, 'src/testing'), { recursive: true });
  mkdirSync(join(pkg, 'dist'), { recursive: true });
  writeFileSync(join(pkg, 'package.json'), JSON.stringify({ private: false }));
  writeFileSync(join(pkg, 'src/unimported.ts'), 'export const untested=1;');
  writeFileSync(join(pkg, 'dist/unimported.js'), 'export const untested=1;');
  writeFileSync(join(pkg, 'src/types.ts'), 'export interface OnlyTypes {}');
  writeFileSync(join(pkg, 'dist/types.js'), '// compiler stub\nexport {};');
  writeFileSync(join(pkg, 'src/ambient.d.ts'), 'declare const example:string;');
  writeFileSync(join(pkg, 'src/catalog.generated.ts'), 'export const authored=1;');
  writeFileSync(join(pkg, 'dist/catalog.generated.js'), 'export const authored=1;');
  writeFileSync(join(pkg, 'src/testing/helpers.ts'), 'export const helper=1;');
  mkdirSync(join(pkg, 'dist/testing'));
  writeFileSync(join(pkg, 'dist/testing/helpers.js'), 'export const helper=1;');
  mkdirSync(join(root, 'packages/private'), { recursive: true });
  writeFileSync(join(root, 'packages/private/package.json'), JSON.stringify({ private: true }));
  const files = publishedSources(root);
  assert.deepEqual(
    files.map((f) => [f.source, f.executable]),
    [
      ['packages/public/src/ambient.d.ts', false],
      ['packages/public/src/catalog.generated.ts', true],
      ['packages/public/src/testing/helpers.ts', true],
      ['packages/public/src/types.ts', false],
      ['packages/public/src/unimported.ts', true],
    ],
  );
  assert.deepEqual(
    coverageInventoryFailures(
      files,
      new Set([
        'packages/public/src/catalog.generated.ts',
        'packages/public/src/testing/helpers.ts',
      ]),
      ['public'],
    ),
    ['Missing source coverage: packages/public/src/unimported.ts'],
  );
  assert.deepEqual(
    coverageInventoryFailures(
      files,
      new Set([
        'packages/public/src/unimported.ts',
        'packages/public/src/catalog.generated.ts',
        'packages/public/src/testing/helpers.ts',
      ]),
      ['public'],
    ),
    [],
  );
  assert.match(
    coverageInventoryFailures(
      files,
      new Set([
        'packages/public/src/unimported.ts',
        'packages/public/src/catalog.generated.ts',
        'packages/public/src/testing/helpers.ts',
      ]),
      ['public', 'missing'],
    ).join(' '),
    /package inventory/,
  );
});
