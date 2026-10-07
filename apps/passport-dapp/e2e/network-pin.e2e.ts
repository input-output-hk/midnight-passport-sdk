// The page's build-time pins (manifest hash and network id), with no network needed:
//   nix develop -c bash -c 'cd apps/passport-dapp && node --import tsx e2e/network-pin.e2e.ts'
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readPins } from '../build-pins.ts';

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

// The pin reaches the page: vite defines it, the connector module exports it, and neither the app
// nor the connector (whose `networkId` feeds the `<networkId>/0` encryption-key context) keeps a
// literal network of its own.
const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8');
assert.match(read('../vite.config.ts'), /__PASSPORT_NETWORK_ID__: JSON\.stringify\(networkId\)/);
assert.match(read('../src/connector.ts'), /NETWORK_ID = __PASSPORT_NETWORK_ID__/);
assert.match(read('../src/app.ts'), /const network = NETWORK_ID;/);
for (const file of ['../src/connector.ts', '../src/app.ts']) {
  assert.doesNotMatch(read(file), /'undeployed'/, file);
}

console.log('network pin: PASS');
