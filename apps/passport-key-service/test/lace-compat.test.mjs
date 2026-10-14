import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { JUBJUB_OWNER_CIRCUITS, selectKeyProfile } from '../src/profiles.mjs';

const root = new URL('../../../', import.meta.url);
const binding = JSON.parse(
  readFileSync(new URL('packages/contract/acc-binding-v2.generated.json', root)),
);
const rows = readFileSync(new URL('./lace-pr2845-artifacts.tsv', import.meta.url), 'utf8')
  .trim()
  .split('\n')
  .filter((line) => !line.startsWith('#'))
  .slice(1)
  .map((line) => line.split('\t'));

test('the packaged binding matches every artifact pin in Lace PR #2845', () => {
  assert.equal(binding.id, 'acc-s3r1.1');
  assert.equal(binding.toolchain.compiler, '0.35.0');
  assert.equal(binding.toolchain.language, '0.27.0');
  assert.equal(binding.toolchain.runtime, '0.20.0');
  assert.equal(binding.source.revision, '6458ed5fe6a4843912328bbf11112b97e33abf45');
  const byName = new Map(binding.roster.map((entry) => [entry.name, entry]));
  assert.equal(rows.length, 52);
  assert.equal(byName.size, rows.length);
  for (const [name, bzkir, prover, verifier] of rows) {
    const pinned = byName.get(name);
    assert.ok(pinned, `${name} is in the SDK binding`);
    assert.equal(pinned.bzkir.sha256, bzkir, `${name} bzkir`);
    assert.equal(pinned.prover.sha256, prover, `${name} prover`);
    assert.equal(pinned.verifier.sha256, verifier, `${name} verifier`);
  }
  const module = readFileSync(new URL('packages/contract/generated/acc-s3r1.1/index.js', root));
  const blob = createHash('sha1').update(`blob ${module.length}\0`).update(module).digest('hex');
  assert.equal(blob, '40b9d0fdb4a9c7b9f8009c714181b577ecfd58cc');
});

test('the JubJub owner profile covers the ten circuits consumed by Lace', () => {
  const provers = new Map(binding.roster.map((entry) => [`${entry.name}.prover`, entry.prover]));
  const profile = selectKeyProfile('jubjub-owner-v1', provers);
  assert.deepEqual(profile.circuits, JUBJUB_OWNER_CIRCUITS);
  assert.equal(profile.circuits.length, 10);
  for (const name of profile.circuits) assert.ok(rows.some(([circuit]) => circuit === name));
});
