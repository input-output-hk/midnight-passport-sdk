import assert from 'node:assert/strict';
import { test } from 'node:test';
import { inspectSource, qualityFailures } from '../scripts/code-quality.mjs';

test('AST analysis detects unsafe escapes and branch complexity without matching strings', () => {
  const text =
    "const note='@ts-ignore and any!';\n// @ts-ignore unsafe suppression\nfunction parse(x: any) { if(x && x.ok) return (x as unknown as string)!.length; else return 0; }";
  const report = inspectSource(text);
  assert.equal(report.metrics.explicitAny, 1);
  assert.equal(report.metrics.nonNull, 1);
  assert.equal(report.metrics.unsafeCasts, 1);
  assert.equal(report.metrics.suppressions, 1);
  assert.equal(report.metrics.complexity, 3);
  assert.equal(qualityFailures(report.metrics).length, 4);
});
test('large and complex new modules fail while explicit legacy ceilings cannot silently grow', () => {
  const report = inspectSource(
    'function x(){\n' + Array(601).fill('if (true) {}').join('\n') + '\n}',
  );
  assert.ok(qualityFailures(report.metrics).some((message) => message.startsWith('lines:')));
  assert.ok(qualityFailures(report.metrics).some((message) => message.startsWith('complexity:')));
  assert.deepEqual(qualityFailures(report.metrics, report.metrics), []);
  assert.ok(
    qualityFailures({ ...report.metrics, nonNull: 1 }, report.metrics).some((message) =>
      message.startsWith('nonNull:'),
    ),
  );
});
test('complexity excludes nested functions rather than charging their callers twice', () => {
  const report = inspectSource(
    'function factory(){ return ()=> { if(true) return 1; return 0; }; }',
  );
  assert.equal(report.functions[0]?.complexity, 1);
  assert.equal(report.functions[1]?.complexity, 2);
});
