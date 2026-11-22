// The page's build-time pins (manifest hash and network id), with no network needed:
//   nix develop -c bash -c 'cd apps/passport-dapp && node --import tsx e2e/network-pin.e2e.ts'
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readDemoBinding, readPins } from '../build-pins.ts';

const HASH = 'AB'.repeat(32);

// Default network: the localnet; the manifest pin is lower-cased.
assert.deepEqual(readPins({ PASSPORT_MANIFEST_SHA256: HASH }), {
  manifestSha256: HASH.toLowerCase(),
  networkId: 'undeployed',
});
// PASSPORT_NETWORK_ID is the build-time override.
assert.equal(
  readPins({ PASSPORT_MANIFEST_SHA256: HASH, PASSPORT_NETWORK_ID: 'preview' }).networkId,
  'preview',
);

for (const bad of ['', 'Preview', 'a/b', 'a b', '-x', 'a_b']) {
  assert.throws(
    () => readPins({ PASSPORT_MANIFEST_SHA256: HASH, PASSPORT_NETWORK_ID: bad }),
    /PASSPORT_NETWORK_ID/,
    JSON.stringify(bad),
  );
}
for (const bad of [undefined, '', 'ab', 'z'.repeat(64)]) {
  assert.throws(() => readPins({ PASSPORT_MANIFEST_SHA256: bad }), /PASSPORT_MANIFEST_SHA256/);
}

const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const assets = realpathSync(mkdtempSync(join(tmpdir(), 'passport-dapp-candidate-pin-')));
try {
  mkdirSync(join(assets, 'compiler'));
  mkdirSync(join(assets, 'contract'));
  writeFileSync(join(assets, 'compiler/contract-manifest.json'), 'candidate manifest');
  writeFileSync(join(assets, 'contract/index.js'), 'candidate module');
  const stable = { manifestSha256: HASH.toLowerCase() };
  const candidate = {
    manifestSha256: digest('candidate manifest'),
    moduleHashes: { 'contract/index.js': digest('candidate module') },
  };
  const pins = { manifestSha256: candidate.manifestSha256, networkId: 'undeployed' };
  const env = {
    PASSPORT_BINDING_ID: 'acc-s3r1.1-zkir036',
    PASSPORT_CANDIDATE_LOCAL: '1',
    PASSPORT_ARTEFACT_DIR: assets,
    VITE_MIDNAMES_REGISTRY_PROFILE: 'standalone-0.35',
  };
  assert.equal(
    readDemoBinding({}, { ...pins, manifestSha256: stable.manifestSha256 }, stable, candidate),
    'acc-s3r1.1',
  );
  assert.equal(readDemoBinding(env, pins, stable, candidate), env.PASSPORT_BINDING_ID);
  for (const changed of [
    { PASSPORT_CANDIDATE_LOCAL: '0' },
    { VITE_MIDNAMES_REGISTRY_PROFILE: 'midnames-2.1.0' },
    { PASSPORT_ARTEFACT_DIR: 'relative' },
    { PASSPORT_BINDING_ID: 'unknown' },
  ])
    assert.throws(() => readDemoBinding({ ...env, ...changed }, pins, stable, candidate));
  assert.throws(() => readDemoBinding(env, { ...pins, networkId: 'preview' }, stable, candidate));
  assert.throws(() =>
    readDemoBinding(env, { ...pins, manifestSha256: HASH.toLowerCase() }, stable, candidate),
  );
  writeFileSync(join(assets, 'contract/index.js'), 'changed module');
  assert.throws(() => readDemoBinding(env, pins, stable, candidate), /asset bytes/);
} finally {
  rmSync(assets, { recursive: true });
}

// The pin reaches the page: vite defines it, the connector module exports it, and neither the app
// nor the connector (whose `networkId` feeds the `<networkId>/0` encryption-key context) keeps a
// literal network of its own.
const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8');
assert.match(read('../vite.config.ts'), /__PASSPORT_NETWORK_ID__: JSON\.stringify\(networkId\)/);
assert.match(read('../vite.config.ts'), /__PASSPORT_BINDING_ID__: JSON\.stringify\(bindingId\)/);
assert.match(read('../src/connector.ts'), /NETWORK_ID = __PASSPORT_NETWORK_ID__/);
assert.match(read('../src/connector.ts'), /BINDING_ID = __PASSPORT_BINDING_ID__/);
assert.match(read('../src/app.ts'), /const network = NETWORK_ID;/);
for (const file of ['../src/connector.ts', '../src/app.ts']) {
  assert.doesNotMatch(read(file), /'undeployed'/, file);
}

console.log('network pin: PASS');
