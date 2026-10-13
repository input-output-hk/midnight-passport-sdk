#!/usr/bin/env node
// Assemble the small, public inputs for one ACC binding. No prover key enters
// this bundle; the consumer must pin the compiler manifest independently.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';

const source = process.argv[2] && resolve(process.argv[2]);
const expectedManifest = process.argv[3];
const bindingId = 'acc-45721e1';
const output = resolve(
  import.meta.dirname,
  '../packages/contract/resources',
  `${bindingId}.zkir.json.gz`,
);
/** @param {string} message @returns {never} */
const fail = (message) => {
  throw new Error(`build-acc-key-bundle: ${message}`);
};
if (!source || !expectedManifest || process.argv.length !== 4)
  fail('usage: node scripts/build-acc-key-bundle.mjs <managed/account> <manifest-sha256>');
if (!/^[a-f0-9]{64}$/.test(expectedManifest)) fail('manifest pin must be 64 lowercase hex');
/** @param {Uint8Array} bytes */
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const manifestFile = join(source, 'compiler/contract-manifest.json');
if (!existsSync(manifestFile)) fail('compiler manifest is missing');
const manifestBytes = readFileSync(manifestFile);
if (sha256(manifestBytes) !== expectedManifest) fail('compiler manifest differs from the pin');
const manifest = JSON.parse(manifestBytes.toString('utf8'));
if (manifest['compiler-version'] !== '0.35.0' || manifest['manifest-version'] !== '1')
  fail('unsupported compiler manifest');

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
for (const circuit of circuits) {
  add('zkir', `${circuit}.zkir`, manifest.zkir?.[`${circuit}.zkir`]);
  add('zkir', `${circuit}.bzkir`, manifest.zkir?.[`${circuit}.bzkir`]);
  add('keys', `${circuit}.verifier`, manifest.keys?.[`${circuit}.verifier`]);
}
const bundle = {
  schemaVersion: 1,
  bindingId,
  manifest: manifestBytes.toString('utf8'),
  files,
};
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, gzipSync(Buffer.from(JSON.stringify(bundle)), { level: 9 }));
console.log(`${output}: ${circuits.length} circuits, ${statSync(output).size} bytes`);
