import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { verifyIsolationArtifacts } from '../../scripts/qualification/native-isolation-artifacts.mjs';

const pins = JSON.parse(readFileSync(new URL('./registry-manifest.json', import.meta.url), 'utf8'));
const artifacts = [
  { path: 'ns-standalone-0.27.compact', sha256: pins.standaloneSourceSha256 },
  ...Object.entries(pins.compiled).map(([path, sha256]) => ({
    path: join('managed', path),
    sha256,
  })),
  ...Object.entries(pins.circuits).flatMap(([circuit, hashes]) =>
    ['zkir', 'bzkir', 'prover', 'verifier'].map((kind) => ({
      path: join('managed', kind.endsWith('zkir') ? 'zkir' : 'keys', circuit + '.' + kind),
      sha256: hashes[kind],
    })),
  ),
];

/** Check the same committed registry pins before use and before accepting native evidence. */
export async function verifyPreparedRegistry(prepared, check = () => {}) {
  check();
  assert.deepEqual(JSON.parse(readFileSync(join(prepared, 'prepared.json'), 'utf8')), pins);
  await verifyIsolationArtifacts(prepared, artifacts, check);
  return structuredClone(pins);
}
