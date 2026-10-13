#!/usr/bin/env node
// Restore public prover/verifier keys from a pinned Compact 0.35.0 ZKIR bundle.
// The caller pins the compiler manifest independently of the artefact host.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  createReadStream,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  renameSync,
  rmSync,
  statSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';

/** @param {string} message @returns {never} */
const fail = (message) => {
  throw new Error(`restore-acc-keys: ${message}`);
};
const args = process.argv.slice(2);
/** @param {string} name */
const option = (name) => {
  const index = args.indexOf(name);
  if (index < 0 || !args[index + 1]) fail(`missing ${name}`);
  const value = args[index + 1];
  if (!value) fail(`missing ${name}`);
  args.splice(index, 2);
  return value;
};
const source = resolve(option('--source'));
const output = resolve(option('--output'));
const expectedManifest = option('--manifest-sha256');
const selected = args.includes('--circuit') ? option('--circuit') : undefined;
if (args.length) fail(`unexpected arguments: ${args.join(' ')}`);
if (!/^[a-f0-9]{64}$/.test(expectedManifest))
  fail('manifest pin must be 64 lowercase hex characters');
if (selected && !/^[a-z][a-z0-9_]*$/.test(selected)) fail('invalid circuit name');

/** @param {string} file */
const digest = async (file) => {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
};
/** @param {string} file @param {{size: number, hash: string} | undefined} pin */
const checked = async (file, pin) =>
  existsSync(file) && statSync(file).size === pin?.size && (await digest(file)) === pin?.hash;
const manifestFile = join(source, 'compiler', 'contract-manifest.json');
if (!existsSync(manifestFile) || (await digest(manifestFile)) !== expectedManifest)
  fail('compiler manifest is missing or does not match the independent SHA-256 pin');
const manifest = JSON.parse(readFileSync(manifestFile, 'utf8'));
if (manifest['compiler-version'] !== '0.35.0' || manifest['manifest-version'] !== '1')
  fail('unsupported compiler manifest');

const compactHome = process.env.COMPACT_DIRECTORY;
if (!compactHome) fail('run inside the pinned Nix shell (COMPACT_DIRECTORY is missing)');
const zkirCompiler = join(dirname(readlinkSync(join(compactHome, 'bin', 'compactc'))), 'zkir-v3');
if (!existsSync(zkirCompiler)) fail('pinned zkir-v3 compiler is missing');

const circuits = Object.keys(manifest.keys ?? {})
  .filter((name) => name.endsWith('.prover'))
  .map((name) => name.slice(0, -'.prover'.length))
  .filter((name) => !selected || name === selected)
  .sort();
if (!circuits.length) fail('no matching circuit in manifest');
mkdirSync(output, { recursive: true });
for (const circuit of circuits) {
  if (!/^[a-z][a-z0-9_]*$/.test(circuit)) fail(`invalid circuit name in manifest: ${circuit}`);
  const zkir = join(source, 'zkir', `${circuit}.zkir`);
  const prover = join(output, `${circuit}.prover`);
  const verifier = join(output, `${circuit}.verifier`);
  const zkirPin = manifest.zkir?.[`${circuit}.zkir`];
  const proverPin = manifest.keys?.[`${circuit}.prover`];
  const verifierPin = manifest.keys?.[`${circuit}.verifier`];
  if (!zkirPin || !proverPin || !verifierPin || !(await checked(zkir, zkirPin)))
    fail(`${circuit}: ZKIR is missing or differs from the pinned manifest`);
  const haveProver = await checked(prover, proverPin);
  const haveVerifier = await checked(verifier, verifierPin);
  if (haveProver && haveVerifier) {
    console.log(`${circuit}: verified existing keys`);
    continue;
  }
  if ((existsSync(prover) && !haveProver) || (existsSync(verifier) && !haveVerifier))
    fail(
      `${circuit}: existing key differs from the pinned manifest; move it aside before restoring`,
    );
  const scratch = mkdtempSync(join(output, '.restore-'));
  try {
    const nextProver = join(scratch, `${circuit}.prover`);
    const nextVerifier = join(scratch, `${circuit}.verifier`);
    const result = spawnSync(zkirCompiler, ['compile', zkir, nextProver, nextVerifier], {
      stdio: 'inherit',
    });
    if (result.status !== 0) fail(`${circuit}: zkir-v3 exited with ${result.status}`);
    if (!(await checked(nextProver, proverPin)) || !(await checked(nextVerifier, verifierPin)))
      fail(`${circuit}: regenerated keys differ from the pinned compiler manifest`);
    if (!haveProver) renameSync(nextProver, prover);
    if (!haveVerifier) renameSync(nextVerifier, verifier);
    console.log(`${circuit}: restored and verified`);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}
console.log(`restore-acc-keys: ${circuits.length} circuit(s) verified`);
