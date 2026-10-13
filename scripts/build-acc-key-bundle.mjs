#!/usr/bin/env node
// Assemble the small, public inputs for one ACC binding. No prover key enters
// this bundle; the consumer must pin the compiler manifest independently.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';

const source = process.argv[2] && resolve(process.argv[2]);
const expectedManifest = process.argv[3];
const bindingId = process.argv[4] ?? 'acc-45721e1';
/** @type {Record<string, string>} */
const bindings = {
  'acc-45721e1': '682bfbd3420e4ad1ce8061a585f1029c395d82accdee030751ed25ede62df8ec',
  'acc-s3r1.1': '77fb9c17b0d59047456c43115d9a58f5cb99a226ee73b6b974fd724930c3153f',
};
const root = resolve(import.meta.dirname, '..');
const output = resolve(root, 'packages/contract/resources', `${bindingId}.zkir.json.gz`);
const keyManifestOutput = resolve(
  root,
  'packages/contract/resources',
  `${bindingId}.key-manifest.json`,
);
/** @param {string} message @returns {never} */
const fail = (message) => {
  throw new Error(`build-acc-key-bundle: ${message}`);
};
if (!source || !expectedManifest || ![4, 5].includes(process.argv.length))
  fail(
    'usage: node scripts/build-acc-key-bundle.mjs <managed/account> <manifest-sha256> [binding-id]',
  );
if (!/^[a-f0-9]{64}$/.test(expectedManifest)) fail('manifest pin must be 64 lowercase hex');
if (bindings[bindingId] !== expectedManifest) fail('binding and manifest pin disagree');
/** @param {Uint8Array} bytes */
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const manifestFile = join(source, 'compiler/contract-manifest.json');
if (!existsSync(manifestFile)) fail('compiler manifest is missing');
const manifestBytes = readFileSync(manifestFile);
if (sha256(manifestBytes) !== expectedManifest) fail('compiler manifest differs from the pin');
const manifest = JSON.parse(manifestBytes.toString('utf8'));
if (manifest['compiler-version'] !== '0.35.0' || manifest['manifest-version'] !== '1')
  fail('unsupported compiler manifest');
if (!/^[a-f0-9]{40}$/.test(manifest['compiler-commit'] ?? ''))
  fail('compiler commit is missing from the manifest');

/** @type {Record<string, string>} */
const files = {};
/** @param {string} directory @param {string} name @param {{size: number, hash: string} | undefined} pin */
const add = (directory, name, pin) => {
  if (!/^[a-z][a-z0-9_]*\.(?:zkir|bzkir|verifier)$/.test(name))
    fail(`invalid artefact name ${name}`);
  if (!pin || !Number.isSafeInteger(pin.size) || !/^[a-f0-9]{64}$/.test(pin.hash))
    fail(`invalid pin for ${name}`);
  const path = join(source, directory, name);
  if (!existsSync(path) || statSync(path).size !== pin.size)
    fail(`${name} is missing or wrong-sized`);
  const bytes = readFileSync(path);
  if (sha256(bytes) !== pin.hash) fail(`${name} differs from the compiler manifest`);
  files[`${directory}/${name}`] = bytes.toString('base64');
};
const circuits = Object.keys(manifest.keys ?? {})
  .filter((name) => name.endsWith('.prover'))
  .map((name) => name.slice(0, -'.prover'.length))
  .sort();
if (circuits.length !== 52) fail(`expected 52 proof circuits, found ${circuits.length}`);
/** @type {Record<string, {zkir: {size: number, sha256: string}, bzkir: {size: number, sha256: string}, prover: {size: number, sha256: string}, verifier: {size: number, sha256: string}}>} */
const keyPins = {};
/** @param {{size: number, hash: string} | undefined} pin @param {string} name */
const recordPin = (pin, name) => {
  if (!pin || !Number.isSafeInteger(pin.size) || !/^[a-f0-9]{64}$/.test(pin.hash))
    fail(`invalid pin for ${name}`);
  return { size: pin.size, sha256: pin.hash };
};
for (const circuit of circuits) {
  add('zkir', `${circuit}.zkir`, manifest.zkir?.[`${circuit}.zkir`]);
  add('zkir', `${circuit}.bzkir`, manifest.zkir?.[`${circuit}.bzkir`]);
  add('keys', `${circuit}.verifier`, manifest.keys?.[`${circuit}.verifier`]);
  keyPins[circuit] = {
    zkir: recordPin(manifest.zkir?.[`${circuit}.zkir`], `${circuit}.zkir`),
    bzkir: recordPin(manifest.zkir?.[`${circuit}.bzkir`], `${circuit}.bzkir`),
    prover: recordPin(manifest.keys?.[`${circuit}.prover`], `${circuit}.prover`),
    verifier: recordPin(manifest.keys?.[`${circuit}.verifier`], `${circuit}.verifier`),
  };
}
const bundle = {
  schemaVersion: 1,
  bindingId,
  manifest: manifestBytes.toString('utf8'),
  files,
};
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, gzipSync(Buffer.from(JSON.stringify(bundle)), { level: 9 }));
writeFileSync(
  keyManifestOutput,
  JSON.stringify(
    {
      schemaVersion: 1,
      bindingId,
      compilerManifestSha256: expectedManifest,
      compiler: {
        version: manifest['compiler-version'],
        commit: manifest['compiler-commit'],
        languageVersion: manifest['language-version'],
        runtimeVersion: manifest['runtime-version'],
      },
      regeneration: {
        tool: 'zkir-v3',
        command: 'zkir-v3 compile <circuit>.zkir <circuit>.prover <circuit>.verifier',
        toolchainVersion: '0.35.0',
        nix: {
          command: 'nix develop',
          compactRecipe: 'nix/packages/compact.nix',
          compactRecipeSha256: sha256(readFileSync(join(root, 'nix/packages/compact.nix'))),
          flakeLockSha256: sha256(readFileSync(join(root, 'flake.lock'))),
        },
      },
      circuits: keyPins,
    },
    null,
    2,
  ) + '\n',
);
console.log(`${output}: ${circuits.length} circuits, ${statSync(output).size} bytes`);
console.log(`${keyManifestOutput}: ${circuits.length} circuit pins and toolchain provenance`);
