import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { inspectSource, qualityFailures } from '../scripts/code-quality.mjs';

/** @type {Array<[string,string,number]>} */
const annotations = [
  ['assertion', '/** @type {any} */ (value);', 1],
  ['wildcard assertion', '/** @type {*} */ (value);', 1],
  ['nested arrays', '/** @type {{items:[any,Array<{value:any}>]}} */ const x=[];', 2],
  ['parameter', '/** @param {any} input */ function use(input){return input;}', 1],
  ['return', '/** @returns {any} */ function get(){return 1;}', 1],
  ['typedef', '/** @typedef {{deep:{value:any}}} Box */ const x=1;', 1],
  ['template', '/** @template {any} T\n * @param {T} x */ function use(x){return x;}', 1],
  ['callback', '/** @callback Work\n * @param {any} x\n * @returns {any}\n */ const x=1;', 2],
  ['wildcard', '/** @type {{value:*}} */ const x={};', 1],
];
for (const [name, source, expected] of annotations) {
  test(`explicit JSDoc ${name} types count actual AST nodes`, () => {
    assert.equal(typeof source, 'string');
    assert.equal(inspectSource(source, 'types.mjs').metrics.explicitAny, expected);
  });
}

test('shared related tags count once, while distinct annotations count separately', () => {
  const text = '/** @param {any} input */ function use(input){return input;}';
  const source = ts.createSourceFile('shared.mjs', text, ts.ScriptTarget.Latest, true);
  /** @type {import('typescript').JSDocTag[]} */
  const exposed = [];
  /** @param {import('typescript').Node} node */
  function collect(node) {
    exposed.push(...ts.getJSDocTags(node));
    ts.forEachChild(node, collect);
  }
  collect(source);
  assert.ok(exposed.length > new Set(exposed).size, 'compiler exposes a shared related tag');
  assert.equal(inspectSource(text, 'shared.mjs').metrics.explicitAny, 1);
  assert.equal(inspectSource(text + '\n' + text, 'distinct.mjs').metrics.explicitAny, 2);
});

test('all adjacent parsed doc blocks count even when tag helpers expose only the final block', () => {
  for (const type of ['any', '*']) {
    const text = `/** @typedef {${type}} Escape */\n/** @type {Escape} */\nexport const value=1;\nvalue.deep.unsafe();`;
    assert.equal(inspectSource(text, 'adjacent.mjs').metrics.explicitAny, 1);
  }
  assert.equal(
    inspectSource(
      '/** @typedef {any} First */\n/** @typedef {any} Second */\nconst value=1;',
      'two.mjs',
    ).metrics.explicitAny,
    2,
  );
});

test('prose, string literals, type property names and unknown are not explicit any', () => {
  const text = [
    '// any and * in prose are not types',
    'const prose="@type {any}";',
    '/** Any words are prose, including @param in this sentence. */',
    'const value=/** @type {unknown} */ (prose);',
    '/** @typedef {{any:unknown,all:Uint8Array}} Bytes */',
    'const callback=/** @type {(input:unknown)=>unknown} */ (value);',
  ].join('\n');
  assert.equal(inspectSource(text, 'safe.mjs').metrics.explicitAny, 0);
});

test('doc function types do not create executable functions or alter ordinary TS metrics', () => {
  const runtime =
    'function read(x: any){if(x && x.ok) return (x as unknown as string)!.length; return 0;}';
  const base = inspectSource(runtime, 'ordinary.ts');
  const documented = inspectSource(
    '/** @callback Work\n * @param {any} value\n * @returns {any}\n */\n' + runtime,
    'documented.ts',
  );
  assert.equal(base.metrics.explicitAny, 1);
  assert.equal(documented.metrics.explicitAny, 3);
  /** @type {(keyof ReturnType<typeof inspectSource>['metrics'])[]} */
  const unchanged = ['functionLines', 'complexity', 'nonNull', 'unsafeCasts', 'suppressions'];
  for (const key of unchanged) assert.equal(documented.metrics[key], base.metrics[key], key);
  assert.equal(documented.functions.length, base.functions.length);
  const onlyDoc = inspectSource('/** @typedef {(x:any)=>any} Work */ const value=1;', 'doc.mjs');
  assert.equal(onlyDoc.metrics.explicitAny, 2);
  assert.equal(onlyDoc.metrics.functionLines, 0);
  assert.equal(onlyDoc.metrics.complexity, 0);
  assert.deepEqual(onlyDoc.functions, []);
});

test('actual inventory CLI refuses nested consumer JSDoc any and wildcard under default zero', () => {
  const root = mkdtempSync(join(tmpdir(), 'consumer-jsdoc-budget-'));
  /** @param {string} path @param {string} text */
  const write = (path, text) => {
    const target = join(root, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, text);
  };
  const cli = fileURLToPath(new URL('../scripts/code-quality.mjs', import.meta.url));
  const run = () =>
    spawnSync(process.execPath, [cli], {
      cwd: root,
      encoding: 'utf8',
      timeout: 10000,
      maxBuffer: 128 * 1024,
    });
  try {
    write('packages/example/src/index.ts', 'export const value=1;');
    write('apps/passport-dapp/src/app.ts', 'export const value=1;');
    write('apps/passport-dapp/e2e/demo-journeys.e2e.ts', 'export const value=1;');
    mkdirSync(join(root, 'apps/passport-dapp/e2e/journeys'), { recursive: true });
    write('scripts/code-quality-budgets.json', '{"files":{}}');
    const path = 'scripts/consumer/new/nested.mjs';
    for (const annotation of [
      '/** @type {any} */',
      '/** @type {*} */',
      '/** @typedef {any} Escape */\n/** @type {Escape} */',
      '/** @typedef {*} Escape */\n/** @type {Escape} */',
    ]) {
      write(path, `${annotation}\nconst value=1; throw Error('must not execute');`);
      const child = run();
      assert.ifError(child.error);
      assert.equal(child.status, 1);
      assert.match(child.stderr, /scripts\/consumer\/new\/nested\.mjs: explicitAny: 1 exceeds 0/);
      assert.equal(child.stderr.includes('must not execute'), false);
    }
    write(path, '/** @type {unknown} */ const value="any";');
    const accepted = run();
    assert.ifError(accepted.error);
    assert.equal(accepted.status, 0, accepted.stderr);
    assert.deepEqual(
      qualityFailures(inspectSource('/** @type {*} */ const v=1;', 'x.mjs').metrics),
      ['explicitAny: 1 exceeds 0'],
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
