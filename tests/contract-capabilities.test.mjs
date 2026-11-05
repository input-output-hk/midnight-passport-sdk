import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  ACC_CAPABILITIES,
  getAccCircuitCapability,
} from '../packages/contract/dist/capabilities.js';
/** @param {string} file */
const json = (file) => JSON.parse(readFileSync(new URL(file, import.meta.url), 'utf8'));

test('machine-readable inventory matches packaged pins and every generated proof/pure signature', () => {
  const info = json('../packages/contract/acc-binding-v2.generated.json');
  const keys = json('../packages/contract/resources/acc-s3r1.1.key-manifest.json');
  const resource = json('../packages/contract/resources/acc-s3r1.1.capabilities.json');
  const site = json('../docs/site/assets/acc-s3r1.1.capabilities.json');
  assert.deepEqual(ACC_CAPABILITIES, resource);
  assert.deepEqual(resource, site);
  assert.equal(ACC_CAPABILITIES.binding.compilerManifestSha256, info.manifestSha256);
  assert.equal(ACC_CAPABILITIES.binding.moduleSha256, info.module.js.sha256);
  assert.equal(ACC_CAPABILITIES.binding.sourceRevision, info.source.revision);
  assert.deepEqual(
    ACC_CAPABILITIES.circuits
      .filter((x) => x.kind === 'proof')
      .map((x) => x.name)
      .sort(),
    Object.keys(keys.circuits).sort(),
  );
  assert.equal(ACC_CAPABILITIES.circuits.filter((x) => x.kind === 'pure').length, 66);
  assert.equal(new Set(ACC_CAPABILITIES.circuits.map((x) => `${x.kind}:${x.name}`)).size, 118);
  for (const circuit of ACC_CAPABILITIES.circuits) {
    assert.ok(
      Object.isFrozen(circuit) &&
        Object.isFrozen(circuit.inputs) &&
        Object.isFrozen(circuit.keyProfiles),
    );
    for (const file of circuit.testEvidence)
      assert.ok(readFileSync(new URL(`../${file}`, import.meta.url)).length);
    if (circuit.scheme === 'k256') assert.equal(circuit.maturity, 'experimental');
  }
});

test('capability lookup has no prototype/unknown fallback and cannot be mutated', () => {
  const circuit = getAccCircuitCapability('withdraw_unshielded_with_grant_jubjub', 'proof');
  assert.equal(circuit?.support, 'holder flow');
  assert.ok(circuit?.inputs.length);
  assert.equal(getAccCircuitCapability('withdraw_unshielded_with_grant_jubjub', 'pure'), undefined);
  assert.equal(getAccCircuitCapability('__proto__', 'proof'), undefined);
  assert.equal(getAccCircuitCapability('unknown', 'proof'), undefined);
  assert.equal(Reflect.set(ACC_CAPABILITIES.binding, 'id', 'other'), false);
  assert.ok(Object.isFrozen(ACC_CAPABILITIES) && Object.isFrozen(ACC_CAPABILITIES.circuits));
  assert.equal(
    ACC_CAPABILITIES.circuits.filter((x) => x.keyProfiles.includes('jubjub-owner-v1')).length,
    10,
  );
});
