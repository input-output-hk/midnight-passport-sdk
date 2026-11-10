import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { installedFixture } from './fixtures/installed-quality-fixture.mjs';
import { runInstalledRelease } from '../scripts/consumer/installed-release.mjs';

/** @param {import('node:test').TestContext} t */
function fixture(t) {
  const f = installedFixture();
  t.after(() => rmSync(f.root, { recursive: true, force: true }));
  return f;
}

test('an occupied later check destination refuses before starting earlier checks', async (t) => {
  const f = fixture(t),
    output = join(f.consumer, 'release');
  mkdirSync(output + '-crypto');
  writeFileSync(join(output + '-crypto', 'original'), 'retain');
  await assert.rejects(runInstalledRelease({ ...f.pins, output }), /already exists/);
  assert.equal(existsSync(output), false);
  assert.equal(existsSync(output + '-quality'), false);
  assert.equal(readFileSync(join(output + '-crypto', 'original'), 'utf8'), 'retain');
});

test('quality refusal retains a failed aggregate and never starts crypto or rewrites the lock', async (t) => {
  const f = fixture(t),
    output = join(f.consumer, 'release');
  const lock = readFileSync(join(f.consumer, 'pnpm-lock.yaml'));
  // Synthetic minimal declarations intentionally cannot satisfy real public consumer fixtures.
  await assert.rejects(runInstalledRelease({ ...f.pins, output }));
  const result = JSON.parse(readFileSync(join(output, 'receipt.json'), 'utf8'));
  assert.equal(result.outcome, 'failed');
  assert.equal(result.failure.phase, 'quality');
  assert.equal(result.inputsUnchanged, true);
  assert.deepEqual(result.checks, {});
  assert.equal(existsSync(output + '-crypto'), false);
  assert.deepEqual(readFileSync(join(f.consumer, 'pnpm-lock.yaml')), lock);
  assert.equal(result.claims.registryProvenance, false);
  assert.equal(result.claims.nativeProof, false);
});
