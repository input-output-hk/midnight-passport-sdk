import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarizeLcov } from '../scripts/test-coverage.mjs';
import { coverageFailures } from '../scripts/coverage-policy.mjs';

test('coverage totals aggregate counts rather than averaging file percentages', () => {
  const result = summarizeLcov(
    'SF:packages/a/dist/index.js\nLF:10\nLH:5\nFNF:2\nFNH:1\nBRF:0\nBRH:0\nend_of_record\nSF:packages/b/dist/index.js\nLF:90\nLH:90\nFNF:8\nFNH:8\nBRF:2\nBRH:1\nend_of_record\n',
  );
  assert.equal(result.percent.lines, 95);
  assert.equal(result.percent.functions, 90);
  assert.equal(result.percent.branches, 50);
  assert.equal(result.files.length, 2);
});

test('coverage floors use raw counters and reject absent/invalid evidence', () => {
  const count = { covered: 80, total: 100 };
  const counters = { lines: count, functions: count, branches: count };
  assert.deepEqual(coverageFailures(counters), []);
  assert.equal(
    coverageFailures({ ...counters, lines: { covered: 79999, total: 100000 } }).length,
    1,
  );
  assert.equal(coverageFailures({ ...counters, functions: { covered: 2, total: 1 } }).length, 1);
  assert.equal(coverageFailures({}).length, 3);
});
test('missing coverage and impossible/truncated counters refuse', () => {
  for (const text of [
    '',
    'SF:a\nLF:1',
    'LF:3\nend_of_record',
    'SF:a\nLF:1\nLH:2\nend_of_record',
    'SF:a\nLF:no\nend_of_record',
  ])
    assert.throws(() => summarizeLcov(text));
});
