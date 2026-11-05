import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarizeLcov } from '../scripts/test-coverage.mjs';

test('coverage totals aggregate counts rather than averaging file percentages', () => {
  const result = summarizeLcov(
    'SF:packages/a/dist/index.js\nLF:10\nLH:5\nFNF:2\nFNH:1\nBRF:0\nBRH:0\nend_of_record\nSF:packages/b/dist/index.js\nLF:90\nLH:90\nFNF:8\nFNH:8\nBRF:2\nBRH:1\nend_of_record\n',
  );
  assert.equal(result.percent.lines, 95);
  assert.equal(result.percent.functions, 90);
  assert.equal(result.percent.branches, 50);
  assert.equal(result.files.length, 2);
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
