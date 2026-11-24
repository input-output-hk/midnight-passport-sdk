import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { verifyIsolationArtifacts } from '../../scripts/qualification/native-isolation-artifacts.mjs';

function pinned(profile) {
  assert.ok(profile === 'standalone-0.35' || profile === 'standalone-0.36.1');
  const manifest =
    profile === 'standalone-0.36.1' ? 'registry-manifest-0361.json' : 'registry-manifest.json';
  const pins = JSON.parse(readFileSync(new URL(manifest, import.meta.url), 'utf8'));
  const source =
    profile === 'standalone-0.36.1' ? 'ns-standalone-0.28.compact' : 'ns-standalone-0.27.compact';
  const artifacts = [
    { path: source, sha256: pins.standaloneSourceSha256 },
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
  return { pins, artifacts };
}

/** Check the same committed registry pins before use and before accepting native evidence. */
export async function verifyPreparedRegistry(
  prepared,
  check = () => {},
  profile = 'standalone-0.35',
) {
  const { pins, artifacts } = pinned(profile);
  check();
  assert.deepEqual(JSON.parse(readFileSync(join(prepared, 'prepared.json'), 'utf8')), pins);
  await verifyIsolationArtifacts(prepared, artifacts, check);
  return structuredClone(pins);
}
