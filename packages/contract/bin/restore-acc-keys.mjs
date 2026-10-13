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
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

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
const bindingId = args.includes('--binding') ? option('--binding') : 'acc-45721e1';
/** @type {Record<string, {manifest: string, keys: string}>} */
const packagePins = {
  'acc-45721e1': {
    manifest: '682bfbd3420e4ad1ce8061a585f1029c395d82accdee030751ed25ede62df8ec',
    keys: '195ed95074cfe6dd6670c5229c59f291761d366238415c25499c54d5f6e98d24',
  },
  'acc-s3r1.1': {
    manifest: '77fb9c17b0d59047456c43115d9a58f5cb99a226ee73b6b974fd724930c3153f',
    keys: '6f452180f8beb3b4c1844ac18be3517403412be0a06e055dcc867c18e69f52c5',
  },
};
const packagePin = packagePins[bindingId];
if (!packagePin) fail(`unsupported binding ${bindingId}`);
const sourceArg = args.includes('--source') ? option('--source') : undefined;
const bundleArg = args.includes('--bundle') ? option('--bundle') : undefined;
if (sourceArg && bundleArg) fail('provide at most one of --source or --bundle');
const source = sourceArg ? resolve(sourceArg) : undefined;
const bundleFile = source
  ? undefined
  : bundleArg
    ? resolve(bundleArg)
    : fileURLToPath(new URL(`../resources/${bindingId}.zkir.json.gz`, import.meta.url));
const output = resolve(option('--output'));
const expectedManifest = args.includes('--manifest-sha256')
  ? option('--manifest-sha256')
  : packagePin.manifest;
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
let manifestBytes;
/** @type {Record<string, string> | undefined} */
let bundledFiles;
if (source) {
  const manifestFile = join(source, 'compiler', 'contract-manifest.json');
  if (!existsSync(manifestFile)) fail('compiler manifest is missing');
  manifestBytes = readFileSync(manifestFile);
} else {
  if (!bundleFile || !existsSync(bundleFile)) fail('key bundle is missing');
  const bundle = JSON.parse(
    gunzipSync(readFileSync(bundleFile), { maxOutputLength: 32 * 1024 * 1024 }).toString('utf8'),
  );
  if (bundle.schemaVersion !== 1 || bundle.bindingId !== bindingId) fail('unsupported key bundle');
  manifestBytes = Buffer.from(bundle.manifest, 'utf8');
  bundledFiles = bundle.files;
  if (!bundledFiles || typeof bundledFiles !== 'object' || Array.isArray(bundledFiles))
    fail('key bundle has no files');
}
if (createHash('sha256').update(manifestBytes).digest('hex') !== expectedManifest)
  fail('compiler manifest does not match the independent SHA-256 pin');
const manifest = JSON.parse(manifestBytes.toString('utf8'));
if (manifest['compiler-version'] !== '0.35.0' || manifest['manifest-version'] !== '1')
  fail('unsupported compiler manifest');

const allCircuits = Object.keys(manifest.keys ?? {})
  .filter((name) => name.endsWith('.prover'))
  .map((name) => name.slice(0, -'.prover'.length))
  .sort();
if (expectedManifest === packagePin.manifest) {
  const keyManifestBytes = readFileSync(
    new URL(`../resources/${bindingId}.key-manifest.json`, import.meta.url),
  );
  if (createHash('sha256').update(keyManifestBytes).digest('hex') !== packagePin.keys)
    fail('key manifest differs from the package pin');
  const keyManifest = JSON.parse(keyManifestBytes.toString('utf8'));
  if (
    keyManifest.schemaVersion !== 1 ||
    keyManifest.bindingId !== bindingId ||
    keyManifest.compilerManifestSha256 !== expectedManifest ||
    keyManifest.compiler?.version !== manifest['compiler-version'] ||
    keyManifest.compiler?.commit !== manifest['compiler-commit'] ||
    keyManifest.regeneration?.tool !== 'zkir-v3' ||
    keyManifest.regeneration?.toolchainVersion !== '0.35.0' ||
    Object.keys(keyManifest.circuits ?? {}).length !== allCircuits.length
  )
    fail('key manifest disagrees with the pinned compiler manifest');
  for (const circuit of allCircuits) {
    for (const [kind, pin] of Object.entries({
      zkir: manifest.zkir?.[`${circuit}.zkir`],
      bzkir: manifest.zkir?.[`${circuit}.bzkir`],
      prover: manifest.keys?.[`${circuit}.prover`],
      verifier: manifest.keys?.[`${circuit}.verifier`],
    })) {
      const recorded = keyManifest.circuits[circuit]?.[kind];
      if (!pin || recorded?.sha256 !== pin.hash || recorded?.size !== pin.size)
        fail(`${circuit}.${kind}: key manifest differs from the pinned compiler manifest`);
    }
  }
}
if (bundledFiles) {
  const expected = new Map();
  for (const circuit of allCircuits) {
    if (!/^[a-z][a-z0-9_]*$/.test(circuit)) fail(`invalid circuit name: ${circuit}`);
    expected.set(`zkir/${circuit}.zkir`, manifest.zkir?.[`${circuit}.zkir`]);
    expected.set(`zkir/${circuit}.bzkir`, manifest.zkir?.[`${circuit}.bzkir`]);
    expected.set(`keys/${circuit}.verifier`, manifest.keys?.[`${circuit}.verifier`]);
  }
  if (Object.keys(bundledFiles).length !== expected.size)
    fail('key bundle does not contain the exact pinned input set');
  for (const [name, pin] of expected) {
    const encoded = bundledFiles[name];
    if (
      typeof encoded !== 'string' ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded) ||
      !Number.isSafeInteger(pin?.size) ||
      !/^[a-f0-9]{64}$/.test(pin?.hash ?? '')
    )
      fail(`${name}: missing or invalid bundled input`);
    const bytes = Buffer.from(encoded, 'base64');
    if (bytes.length !== pin.size || createHash('sha256').update(bytes).digest('hex') !== pin.hash)
      fail(`${name}: bundled input differs from the pinned manifest`);
  }
  if (Object.keys(bundledFiles).some((name) => !expected.has(name)))
    fail('key bundle contains an unexpected input');
}

const compactHome = process.env.COMPACT_DIRECTORY;
if (!compactHome) fail('run inside the pinned Nix shell (COMPACT_DIRECTORY is missing)');
const compactCompiler = readlinkSync(join(compactHome, 'bin', 'compactc'));
if (!compactCompiler.includes('/versions/0.35.0/')) fail('Compact 0.35.0 toolchain is required');
const zkirCompiler = join(dirname(compactCompiler), 'zkir-v3');
if (!existsSync(zkirCompiler)) fail('pinned zkir-v3 compiler is missing');

const circuits = allCircuits.filter((name) => !selected || name === selected).sort();
if (!circuits.length) fail('no matching circuit in manifest');
mkdirSync(output, { recursive: true });
for (const circuit of circuits) {
  if (!/^[a-z][a-z0-9_]*$/.test(circuit)) fail(`invalid circuit name in manifest: ${circuit}`);
  const zkir = source ? join(source, 'zkir', `${circuit}.zkir`) : undefined;
  const prover = join(output, `${circuit}.prover`);
  const verifier = join(output, `${circuit}.verifier`);
  const zkirPin = manifest.zkir?.[`${circuit}.zkir`];
  const proverPin = manifest.keys?.[`${circuit}.prover`];
  const verifierPin = manifest.keys?.[`${circuit}.verifier`];
  if (!zkirPin || !proverPin || !verifierPin)
    fail(`${circuit}: incomplete circuit pins in the compiler manifest`);
  if (zkir && !(await checked(zkir, zkirPin)))
    fail(`${circuit}: ZKIR is missing or differs from the pinned manifest`);
  const encoded = bundledFiles?.[`zkir/${circuit}.zkir`];
  const zkirBytes = encoded ? Buffer.from(encoded, 'base64') : undefined;
  if (
    bundledFiles &&
    (!zkirBytes ||
      zkirBytes.length !== zkirPin.size ||
      createHash('sha256').update(zkirBytes).digest('hex') !== zkirPin.hash)
  )
    fail(`${circuit}: bundled ZKIR is missing or differs from the pinned manifest`);
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
    const zkirFile = zkir ?? join(scratch, `${circuit}.zkir`);
    if (zkirBytes) writeFileSync(zkirFile, zkirBytes);
    const result = spawnSync(zkirCompiler, ['compile', zkirFile, nextProver, nextVerifier], {
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
