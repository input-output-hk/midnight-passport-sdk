import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { browserOutput, browserDeadline } from '../scripts/qualify-public-signer-browser.mjs';

test('browser fixture refuses existing or escaping roots without replacing retained evidence', () => {
  const consumer = mkdtempSync(join(tmpdir(), 'passport-browser-guards-'));
  try {
    const output = join(consumer, 'signer-browser-new');
    assert.equal(browserOutput(output, consumer), output);
    mkdirSync(output);
    for (const path of [
      output,
      join(consumer, '../signer-browser-outside'),
      join(consumer, 'other'),
      'relative',
    ]) {
      assert.throws(() => browserOutput(path, consumer));
    }
  } finally {
    rmSync(consumer, { recursive: true, force: true });
  }
});
test('browser action deadline rejects stalled work and preserves original errors', async () => {
  assert.equal(await browserDeadline(async () => 7, 100), 7);
  const failure = Error('original');
  await assert.rejects(
    browserDeadline(async () => {
      throw failure;
    }, 100),
    failure,
  );
  await assert.rejects(
    browserDeadline(() => new Promise(() => {}), 5),
    /deadline exceeded/,
  );
});
