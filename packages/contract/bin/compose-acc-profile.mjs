#!/usr/bin/env node
// Deterministically bind the unchanged Compact 0.35 outputs to the separately
// pinned 0.36.1 key-generation profile. No prover bytes enter this manifest.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

const SOURCE_SHA256 = '77fb9c17b0d59047456c43115d9a58f5cb99a226ee73b6b974fd724930c3153f';
const BINDING_ID = 'acc-s3r1.1-zkir036';
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

/** @param {Uint8Array} sourceBytes @param {Uint8Array} keyManifestBytes */
export function composeAccProfileManifest(sourceBytes, keyManifestBytes) {
  if (sha256(sourceBytes) !== SOURCE_SHA256) throw new Error('source compiler manifest differs');
  const source = JSON.parse(Buffer.from(sourceBytes).toString('utf8'));
  const profile = JSON.parse(Buffer.from(keyManifestBytes).toString('utf8'));
  const names = Object.keys(source.keys ?? {})
    .filter((name) => name.endsWith('.prover'))
    .map((name) => name.slice(0, -'.prover'.length))
    .sort();
  if (
    source['compiler-version'] !== '0.35.0' ||
    source['manifest-version'] !== '1' ||
    profile.schemaVersion !== 1 ||
    profile.bindingId !== BINDING_ID ||
    profile.compilerManifestSha256 !== SOURCE_SHA256 ||
    profile.regeneration?.toolchainVersion !== '0.36.1' ||
    names.length !== 52 ||
    Object.keys(source.keys).filter((name) => name.endsWith('.verifier')).length !== 52 ||
    JSON.stringify(Object.keys(profile.circuits ?? {}).sort()) !== JSON.stringify(names)
  )
    throw new Error('incomplete or incompatible ACC key profile');
  let changed = 0;
  for (const name of names) {
    const circuit = profile.circuits[name];
    for (const kind of ['zkir', 'bzkir']) {
      const original = source.zkir?.[`${name}.${kind}`];
      const pin = circuit?.[kind];
      if (original?.type !== 'file' || pin?.size !== original.size || pin?.sha256 !== original.hash)
        throw new Error(`${name}.${kind}: source ZKIR differs`);
    }
    for (const kind of ['prover', 'verifier']) {
      const original = source.keys?.[`${name}.${kind}`];
      const pin = circuit?.[kind];
      if (
        original?.type !== 'file' ||
        !Number.isSafeInteger(pin?.size) ||
        pin.size <= 0 ||
        !/^[a-f0-9]{64}$/.test(pin?.sha256 ?? '')
      )
        throw new Error(`${name}.${kind}: invalid key pin`);
      if (kind === 'verifier' && pin.sha256 !== original.hash) changed++;
      source.keys[`${name}.${kind}`] = { type: 'file', size: pin.size, hash: pin.sha256 };
    }
  }
  if (changed !== 48) throw new Error('candidate verifier delta differs from pinned inventory');
  return Buffer.from(JSON.stringify(source, null, 2) + '\n');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length > 3 || (process.argv[2] && process.argv[2] !== '--write'))
    throw new Error('usage: compose-acc-profile.mjs [--write]');
  const resource = (name) => new URL(`../resources/${name}`, import.meta.url);
  const bundle = JSON.parse(
    gunzipSync(readFileSync(resource(`${BINDING_ID}.zkir.json.gz`))).toString('utf8'),
  );
  if (bundle.bindingId !== BINDING_ID) throw new Error('wrong source bundle');
  const output = composeAccProfileManifest(
    Buffer.from(bundle.manifest, 'utf8'),
    readFileSync(resource(`${BINDING_ID}.key-manifest.json`)),
  );
  const target = resource(`${BINDING_ID}.artefact-manifest.json`);
  if (process.argv[2] === '--write') writeFileSync(target, output);
  else if (!readFileSync(target).equals(output)) throw new Error('derived manifest differs');
  console.log(`${BINDING_ID} artifact manifest SHA-256 ${sha256(output)}`);
}
