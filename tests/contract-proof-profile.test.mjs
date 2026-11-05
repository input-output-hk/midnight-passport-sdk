import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  ACC_CAPABILITIES,
  inspectAccProofProfile,
} from '../packages/contract/dist/capabilities.js';
const names = ACC_CAPABILITIES.circuits.filter((x) => x.kind === 'proof').map((x) => x.name);
const wanted = 'withdraw_unshielded_with_jubjub';
const profile = { name: 'any-name-is-not-authority', circuits: [wanted], verifierCircuits: names };
const manifest = {
  bindingId: ACC_CAPABILITIES.binding.id,
  compilerManifestSha256: ACC_CAPABILITIES.binding.compilerManifestSha256,
};

test('explicit requested coverage is immutable advertised metadata only, independent of a profile name', () => {
  const report = inspectAccProofProfile(profile, manifest, [wanted, wanted]);
  assert.equal(report.status, 'profile-covers-request');
  assert.equal(report.evidence, 'advertised-metadata-only');
  assert.deepEqual(report.requiredCircuits, [wanted]);
  assert.ok(
    Object.isFrozen(report) &&
      Object.isFrozen(report.issues) &&
      Object.isFrozen(report.requiredCircuits),
  );
  assert.ok(report.runtimeChecks.some((x) => x.includes('every consumed key byte/hash')));
});

test('ready health, all verifiers and a misleading profile name cannot replace a prover', () => {
  const report = inspectAccProofProfile(
    { name: 'all', ready: true, circuits: [], verifierCircuits: names },
    manifest,
    [wanted],
  );
  assert.equal(report.status, 'profile-incomplete');
  assert.deepEqual(
    report.issues.map((x) => x.code),
    ['MissingProver'],
  );
  assert.ok(Object.isFrozen(report.issues[0]));
});

test('wrong binding/manifest, missing verifier and malformed lists refuse independently', () => {
  for (const m of [
    { ...manifest, bindingId: 'acc-other' },
    { ...manifest, compilerManifestSha256: '0'.repeat(64) },
  ])
    assert.ok(
      inspectAccProofProfile(profile, m, [wanted]).issues.some(
        (x) => x.code === 'ManifestMismatch',
      ),
    );
  assert.ok(
    inspectAccProofProfile({ ...profile, verifierCircuits: [] }, manifest, [wanted]).issues.some(
      (x) => x.code === 'MissingVerifier',
    ),
  );
  for (const circuits of [
    null,
    {},
    [wanted, wanted],
    ['unknown'],
    ['derive_grant_id_with_jubjub'],
    Array(53).fill(wanted),
    Array(1),
  ])
    assert.ok(
      inspectAccProofProfile({ ...profile, circuits }, manifest, [wanted]).issues.some(
        (x) => x.code === 'InvalidProfile',
      ),
    );
  for (const required of [[], ['unknown'], ['derive_grant_id_with_jubjub'], Array(53).fill(wanted)])
    assert.ok(
      inspectAccProofProfile(profile, manifest, required).issues.some(
        (x) => x.code === 'InvalidRequirements',
      ),
    );
});

test('advertisement getters and sparse array accessors are never invoked or echoed', () => {
  let called = 0;
  const getter = () => {
    called++;
    throw Error('private endpoint diagnostic');
  };
  const advertisement = {
    get circuits() {
      return getter();
    },
    verifierCircuits: names,
  };
  const list = [wanted];
  Object.defineProperty(list, '0', { get: getter });
  for (const p of [advertisement, { circuits: list, verifierCircuits: names }]) {
    const report = inspectAccProofProfile(p, manifest, [wanted]);
    assert.equal(report.status, 'profile-incomplete');
    assert.equal(JSON.stringify(report).includes('private'), false);
  }
  assert.equal(called, 0);
});

test('coverage checks actual key-server HTTP metadata for the reduced and complete profiles', async () => {
  const { createKeyServer } = await import(
    new URL('../apps/passport-key-service/src/server.mjs', import.meta.url).href
  );
  const { selectKeyProfile } = await import('../apps/passport-key-service/src/profiles.mjs');
  const { readFileSync } = await import('node:fs');
  for (const name of ['all', 'jubjub-owner-v1']) {
    const provers = new Map(
      names.map((c) => [`${c}.prover`, { type: 'file', size: 1, hash: '0'.repeat(64) }]),
    );
    const selected = selectKeyProfile(name, provers);
    // Fixture bytes are never downloaded or proven; this case qualifies HTTP metadata only.
    const server = createKeyServer({
      bindingId: 'acc-s3r1.1',
      files: new Map(names.map((c) => [`keys/${c}.verifier`, Buffer.of(0)])),
      manifestBytes: Buffer.from('{}'),
      keyManifestBytes: readFileSync(
        new URL('../packages/contract/resources/acc-s3r1.1.key-manifest.json', import.meta.url),
      ),
      provers,
      keyDir: '/unused-metadata-fixture',
      profile: selected,
    });
    /** @type {(string|undefined)[]} */ const requests = [];
    server.on('request', (/** @type {import('node:http').IncomingMessage} */ req) =>
      requests.push(req.url),
    );
    await new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(undefined)));
    try {
      const address = server.address();
      assert.ok(address && typeof address === 'object');
      const base = `http://127.0.0.1:${address.port}`;
      const p = await (await fetch(base + '/v1/profile')).json();
      const m = await (await fetch(base + '/v1/manifest')).json();
      const health = await (await fetch(base + '/healthz')).json();
      assert.ok(health && typeof health === 'object' && 'ready' in health);
      assert.equal(health.ready, true);
      const report = inspectAccProofProfile(p, m, [wanted]);
      assert.equal(report.status, name === 'all' ? 'profile-covers-request' : 'profile-incomplete');
      assert.deepEqual(requests, ['/v1/profile', '/v1/manifest', '/healthz']);
    } finally {
      server.closeAllConnections();
      await new Promise((resolve, reject) =>
        server.close((/** @type {Error|undefined} */ error) =>
          error ? reject(error) : resolve(undefined),
        ),
      );
    }
  }
});
