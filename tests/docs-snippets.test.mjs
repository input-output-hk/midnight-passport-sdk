import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import {
  typeScriptFences,
  documentationExamples,
  checkDocumentationTypes,
  sourceExportPaths,
  assertDocumentationInventory,
} from '../scripts/docs/snippets.mjs';

test('documentation extraction preserves exact TypeScript bodies and original line positions', () => {
  const source = [
    '# Guide',
    '```text',
    '```ts',
    'not code',
    '```',
    '',
    '~~~~typescript',
    'export const answer = 42;',
    '~~~~',
    '```ts',
    'export const other = 7;',
    '```',
  ].join('\r\n');
  assert.deepEqual(typeScriptFences(source), [
    { index: 1, code: 'export const answer = 42;', line: 8 },
    { index: 2, code: 'export const other = 7;', line: 11 },
  ]);
  assert.throws(() => typeScriptFences('```ts\nexport const incomplete = 1;'), /Unclosed/);
});

test('a shorter embedded fence does not close a longer TypeScript fence', () => {
  assert.deepEqual(typeScriptFences('````ts\nconst text = `\n```\n`;\n````'), [
    { index: 1, code: 'const text = `\n```\n`;', line: 2 },
  ]);
});

test('fence metadata does not silently hide a TypeScript example', () => {
  assert.deepEqual(typeScriptFences('```ts title="example.ts"\nexport const value = 1;\n```'), [
    { index: 1, code: 'export const value = 1;', line: 2 },
  ]);
});

test('manifest refuses unaccounted examples, unsafe paths and ambiguous target policies', () => {
  const root = mkdtempSync(join(tmpdir(), 'passport-doc-example-'));
  try {
    mkdirSync(join(root, 'docs/site'), { recursive: true });
    writeFileSync(join(root, 'docs/site/example.md'), '```ts\nexport const x = 1;\n```');
    const page = { path: 'docs/site/example.md', fences: [{ targets: ['neutral', 'web'] }] };
    assert.deepEqual(
      documentationExamples(root, { version: 1, pages: [page] }).examples.map(
        (example) => example.target,
      ),
      ['neutral', 'web'],
    );
    for (const fences of [
      [],
      [{ targets: [] }],
      [{ targets: ['unknown'] }],
      [{ targets: ['web', 'web'] }],
      [{ fragment: 'short' }],
      [{ targets: ['web'], fragment: 'A deliberately incomplete public fragment.' }],
    ])
      assert.throws(() =>
        documentationExamples(root, { version: 1, pages: [{ ...page, fences }] }),
      );
    assert.throws(
      () => documentationExamples(root, { version: 1, pages: [page, page] }),
      /duplicate/,
    );
    assert.throws(
      () =>
        documentationExamples(root, { version: 1, pages: [{ ...page, path: '../outside.md' }] }),
      /Unsafe/,
    );
    const fragments = documentationExamples(root, {
      version: 1,
      pages: [
        {
          ...page,
          fences: [{ fragment: 'Historical fragment requires a separately supplied host.' }],
        },
      ],
    });
    assert.equal(fragments.examples.length, 0);
    assert.equal(fragments.fragments[0]?.fence, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('source aliases derive from public declarations and do not expose private scaffolds', () => {
  const root = resolve(import.meta.dirname, '..');
  const paths = sourceExportPaths(root);
  assert.deepEqual(
    paths['@input-output-hk/mn-passport-account/authorisation'],
    paths['@input-output-hk/mn-passport-account/authorization'],
  );
  assert.deepEqual(paths['@input-output-hk/mn-passport-account/authorization'], [
    join(root, 'packages/account/src/authorization.ts'),
  ]);
  assert.equal(paths['@input-output-hk/mn-passport-core'], undefined);
  assert.deepEqual(paths['@input-output-hk/mn-passport-contract/bindings/acc-s3r1.1'], [
    join(root, 'packages/contract/generated/acc-s3r1.1/index.d.ts'),
  ]);
});

test('new TypeScript pages and modules cannot silently escape documentation checks', () => {
  const root = mkdtempSync(join(tmpdir(), 'passport-doc-inventory-'));
  try {
    mkdirSync(join(root, 'docs/site'), { recursive: true });
    mkdirSync(join(root, 'docs/examples'), { recursive: true });
    writeFileSync(join(root, 'docs/site/new.md'), '```ts\nexport const x = 1;\n```');
    assert.throws(
      () => assertDocumentationInventory(root, { examples: [], fragments: [] }),
      /page is not checked/,
    );
    const admitted = documentationExamples(root, {
      version: 1,
      pages: [{ path: 'docs/site/new.md', fences: [{ targets: ['neutral'] }] }],
    });
    assertDocumentationInventory(root, admitted);
    writeFileSync(join(root, 'docs/examples/new.ts'), 'export const y = 2;');
    assert.throws(() => assertDocumentationInventory(root, admitted), /module is not checked/);
    const complete = documentationExamples(root, {
      version: 1,
      pages: [{ path: 'docs/site/new.md', fences: [{ targets: ['neutral'] }] }],
      files: [{ path: 'docs/examples/new.ts', targets: ['neutral'] }],
    });
    assertDocumentationInventory(root, complete);
    mkdirSync(join(root, 'docs/site/nested'));
    writeFileSync(
      join(root, 'docs/site/nested/hidden.md'),
      '```ts\nexport const wrong: number = "bad";\n```',
    );
    assert.throws(() => assertDocumentationInventory(root, complete), /nested\/hidden/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('missing public source fails instead of falling back to an installed declaration', () => {
  const root = mkdtempSync(join(tmpdir(), 'passport-doc-source-'));
  try {
    mkdirSync(join(root, 'packages/example'), { recursive: true });
    writeFileSync(
      join(root, 'packages/example/package.json'),
      JSON.stringify({
        name: '@input-output-hk/mn-passport-example',
        private: false,
        exports: { '.': { types: './dist/index.d.ts' } },
      }),
    );
    mkdirSync(join(root, 'node_modules/@input-output-hk/mn-passport-example'), { recursive: true });
    writeFileSync(
      join(root, 'node_modules/@input-output-hk/mn-passport-example/index.d.ts'),
      'export const stale: number;',
    );
    assert.throws(() => sourceExportPaths(root), /ENOENT|Missing public source/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('private source imports, ambient host declarations and suppression cannot pass as complete examples', () => {
  const root = resolve(import.meta.dirname, '..');
  const result = checkDocumentationTypes(root, [
    {
      path: 'docs/site/private.example-1.mts',
      line: 1,
      target: 'neutral',
      code: "import '../../packages/account/src/codec.js';",
    },
    {
      path: 'docs/site/injection.example-1.mts',
      line: 1,
      target: 'neutral',
      code: 'declare global { const hostInjected: number; } export {};',
    },
    {
      path: 'docs/site/consumer.example-1.mts',
      line: 1,
      target: 'neutral',
      code: 'export const missing = hostInjected;',
    },
    {
      path: 'docs/site/hidden.example-1.mts',
      line: 1,
      target: 'neutral',
      code: '// @ts-ignore\nexport const hidden = missingHost;',
    },
  ]);
  const diagnostics = result.flatMap((lane) => lane.diagnostics);
  assert.ok(diagnostics.some((message) => message.includes('not package internals')));
  assert.ok(diagnostics.some((message) => message.includes('ambient declarations')));
  assert.ok(diagnostics.some((message) => message.includes('suppression')));
});

test('authored reference directives cannot supply hidden ambient capabilities to another example', () => {
  const root = resolve(import.meta.dirname, '..');
  const result = checkDocumentationTypes(root, [
    {
      path: 'docs/site/reference.example-1.mts',
      line: 1,
      target: 'neutral',
      code: '/// <reference types="node" />\nexport const marker = 1;',
    },
    {
      path: 'docs/site/ambient.example-1.mts',
      line: 1,
      target: 'neutral',
      code: 'export const version = process.version;',
    },
  ]);
  assert.ok(
    result
      .flatMap((lane) => lane.diagnostics)
      .some((message) => message.includes('Reference directives')),
  );
});

test('CommonJS private imports cannot bypass the public ESM documentation boundary', () => {
  const root = resolve(import.meta.dirname, '..');
  const result = checkDocumentationTypes(root, [
    {
      path: 'docs/site/require.example-1.mts',
      line: 1,
      target: 'node',
      code: "const codec = require('../../packages/account/src/codec.js'); export const encoded = codec.toHex(new Uint8Array());",
    },
  ]);
  assert.ok(
    result
      .flatMap((lane) => lane.diagnostics)
      .some((message) => message.includes('Use ESM public imports')),
  );
});

test('strict compiler refuses undeclared names, wrong brands and browser globals in neutral examples', () => {
  const root = resolve(import.meta.dirname, '..');
  const result = checkDocumentationTypes(root, [
    {
      path: 'docs/site/synthetic.example-1.mts',
      line: 40,
      target: 'neutral',
      code: "import {AccountAddressSchema, type AssetId} from '@input-output-hk/mn-passport-account/validation';\nexport const asset: AssetId = AccountAddressSchema.parse('ab'.repeat(32));\nexport const bad = missingHost + window.location.href;",
    },
  ]);
  const diagnostics = result.flatMap((lane) => lane.diagnostics);
  assert.equal(diagnostics.length, 3);
  assert.ok(
    diagnostics.some((line) => line.includes('synthetic.md:41:') && line.includes('TS2322')),
  );
  assert.ok(diagnostics.some((line) => line.includes('missingHost')));
  assert.ok(diagnostics.some((line) => line.includes('window')));
});
