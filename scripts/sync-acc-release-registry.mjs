#!/usr/bin/env node
// Keep the release ACC current while deriving a separate provisional Ledger 9
// key-generation profile from its independently pinned source and key bytes.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { composeAccProfileManifest } from '../packages/contract/bin/compose-acc-profile.mjs';

const root = resolve(import.meta.dirname, '..');
const metadataPath = resolve(root, 'packages/contract/acc-binding-v2.generated.json');
const registryPath = resolve(root, 'packages/contract/acc-versions.generated.json');
const typesPath = resolve(root, 'packages/contract/src/manifest.generated.ts');
const candidateId = 'acc-s3r1.1-zkir036';
const candidateSha256 = '590d3c97db7fce05d5ea85a9bf37c82b7032c498703a2807276ca7ae0ca52e5f';
/** @param {string} name */
const resource = (name) => resolve(root, `packages/contract/resources/${candidateId}.${name}`);
/** @param {Uint8Array} bytes */
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const metadata = JSON.parse(readFileSync(metadataPath, 'utf8'));
if (
  metadata.id !== 'acc-s3r1.1' ||
  metadata.manifestSha256 !== '77fb9c17b0d59047456c43115d9a58f5cb99a226ee73b6b974fd724930c3153f' ||
  metadata.roster?.length !== 52 ||
  metadata.pureCircuits?.length !== 66
)
  throw new Error('unexpected ACC release binding');
const registry = JSON.parse(readFileSync(registryPath, 'utf8'));
if (!['0.0.0-prototype.1', metadata.id].includes(registry.current))
  throw new Error('unexpected registry pointer');

/** @type {Record<string, unknown>} */
const circuits = {};
for (const name of metadata.pureCircuits) {
  if (typeof name !== 'string' || Object.hasOwn(circuits, name))
    throw new Error('duplicate circuit');
  circuits[name] = { pure: true, proof: false };
}
for (const item of metadata.roster) {
  if (typeof item.name !== 'string' || Object.hasOwn(circuits, item.name))
    throw new Error('duplicate circuit');
  circuits[item.name] = {
    pure: false,
    proof: true,
    keyLocation: `acc/${metadata.id}/${item.name}`,
    hashes: {
      zkir: item.zkir.sha256,
      bzkir: item.bzkir.sha256,
      verifierKey: item.verifier.sha256,
      proverKey: item.prover.sha256,
    },
  };
}
registry.versions[metadata.id] = {
  provisional: false,
  manifestSha256: metadata.manifestSha256,
  source: {
    path: `midnightntwrk/passport@${metadata.source.revision}/contracts/account.compact`,
    sha256: metadata.source.files['contracts/account.compact'],
  },
  toolchain: {
    cliVersion: 'compact 0.35.0',
    compilerVersion: metadata.toolchain.compiler,
    languageVersion: metadata.toolchain.language,
    runtimeVersion: metadata.toolchain.runtime,
  },
  moduleHashes: {
    'contract/index.js': metadata.module.js.sha256,
    'contract/index.d.ts': metadata.module.types.sha256,
    'compiler/contract-info.json': metadata.module.contractInfo.sha256,
  },
  circuits: Object.fromEntries(Object.entries(circuits).sort(([a], [b]) => a.localeCompare(b))),
};
const keyManifestBytes = readFileSync(resource('key-manifest.json'));
const profile = JSON.parse(keyManifestBytes.toString('utf8'));
const bundle = JSON.parse(gunzipSync(readFileSync(resource('zkir.json.gz'))).toString('utf8'));
const candidateManifest = readFileSync(resource('artefact-manifest.json'));
if (
  profile.bindingId !== candidateId ||
  profile.regeneration?.toolchainVersion !== '0.36.1' ||
  bundle.bindingId !== candidateId ||
  sha256(candidateManifest) !== candidateSha256 ||
  !composeAccProfileManifest(Buffer.from(bundle.manifest, 'utf8'), keyManifestBytes).equals(
    candidateManifest,
  ) ||
  JSON.stringify(Object.keys(profile.circuits).sort()) !==
    JSON.stringify(metadata.roster.map((/** @type {{name: string}} */ item) => item.name).sort())
)
  throw new Error('unexpected ACC candidate profile');
const candidateCircuits = structuredClone(registry.versions[metadata.id].circuits);
for (const item of metadata.roster) {
  const key = profile.circuits[item.name];
  if (
    key.zkir.sha256 !== item.zkir.sha256 ||
    key.bzkir.sha256 !== item.bzkir.sha256 ||
    !/^[a-f0-9]{64}$/.test(key.verifier.sha256) ||
    !/^[a-f0-9]{64}$/.test(key.prover.sha256)
  )
    throw new Error(`${item.name}: candidate key profile differs from compiler inventory`);
  candidateCircuits[item.name] = {
    pure: false,
    proof: true,
    keyLocation: `acc/${candidateId}/${item.name}`,
    hashes: {
      zkir: item.zkir.sha256,
      bzkir: item.bzkir.sha256,
      verifierKey: key.verifier.sha256,
      proverKey: key.prover.sha256,
    },
  };
}
registry.versions[candidateId] = {
  ...registry.versions[metadata.id],
  provisional: true,
  manifestSha256: candidateSha256,
  toolchain: {
    ...registry.versions[metadata.id].toolchain,
    cliVersion: 'compact 0.35.0; zkir-v3 0.36.1',
  },
  circuits: candidateCircuits,
};
registry.current = metadata.id;
delete registry.versions['0.0.0-prototype.1'];
registry.$generatedBy = 'scripts/sync-acc-release-registry.mjs';

/** @param {string} input @param {string} path */
const format = (input, path) =>
  execFileSync('pnpm', ['exec', 'prettier', '--stdin-filepath', path], {
    cwd: root,
    input,
    encoding: 'utf8',
  });
const { $generatedBy, schemaVersion, ...data } = registry;
writeFileSync(registryPath, format(JSON.stringify(registry, null, 2) + '\n', registryPath));
const currentTypes = readFileSync(typesPath, 'utf8');
const marker = 'export const ACC_REGISTRY: AccRegistry = ';
const index = currentTypes.indexOf(marker);
if (index < 0) throw new Error('registry TypeScript marker missing');
const header = currentTypes
  .slice(0, index)
  .replace(
    'GENERATED by scripts/build-acc-artefact.mjs',
    'GENERATED by scripts/sync-acc-release-registry.mjs',
  )
  .replace('every supported ACC', 'every pinned ACC')
  .replace('Regenerate: pnpm run build:artefact.', 'Regenerate: pnpm run sync:acc-registry.');
writeFileSync(
  typesPath,
  format(`${header}${marker}${JSON.stringify(data, null, 2)};\n`, typesPath),
);
console.log(
  `${metadata.id} current; ${candidateId} provisional: ${metadata.roster.length} proof and ${metadata.pureCircuits.length} pure circuits each`,
);
