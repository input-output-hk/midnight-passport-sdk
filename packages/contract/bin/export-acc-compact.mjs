#!/usr/bin/env node
// Export a verified compiler dependency from the installed package. This is
// build tooling, not an authorization API or a deployed-account upgrade.
import { createHash } from 'node:crypto';
import {
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

const PACKAGE_ROOT = fileURLToPath(new URL('..', import.meta.url));
const BINDING = 'acc-s3r1.1';
const MANIFEST = '77fb9c17b0d59047456c43115d9a58f5cb99a226ee73b6b974fd724930c3153f';
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const fail = (message) => {
  throw new Error(`export-acc-compact: ${message}`);
};

function parse(args) {
  const options = {};
  for (let i = 0; i < args.length; i += 2) {
    const name = args[i];
    if (!['--output', '--binding', '--manifest-sha256'].includes(name))
      fail(`unsupported option ${name}`);
    if (Object.hasOwn(options, name) || !args[i + 1] || args[i + 1].startsWith('--'))
      fail(`missing or duplicate ${name}`);
    options[name] = args[i + 1];
  }
  if (!options['--output']) fail('--output must name a new dependency directory');
  if ((options['--binding'] ?? BINDING) !== BINDING) fail('unsupported binding');
  if ((options['--manifest-sha256'] ?? MANIFEST) !== MANIFEST)
    fail('manifest pin differs from the supported binding');
  return options;
}

function checked(bytes, pin, name) {
  if (
    !pin ||
    !Number.isSafeInteger(pin.size) ||
    pin.size < 0 ||
    !/^[a-f0-9]{64}$/.test(pin.hash ?? '') ||
    bytes.length !== pin.size ||
    hash(bytes) !== pin.hash
  )
    fail(`${name} differs from the pinned compiler manifest`);
  return bytes;
}

function verifiedFiles() {
  const bundle = JSON.parse(
    gunzipSync(readFileSync(join(PACKAGE_ROOT, 'resources', `${BINDING}.zkir.json.gz`)), {
      maxOutputLength: 32 * 1024 * 1024,
    }).toString('utf8'),
  );
  if (bundle.schemaVersion !== 1 || bundle.bindingId !== BINDING) fail('unsupported key bundle');
  if (typeof bundle.manifest !== 'string') fail('compiler manifest is missing');
  const manifestBytes = Buffer.from(bundle.manifest);
  if (hash(manifestBytes) !== MANIFEST) fail('compiler manifest differs from the package pin');
  const manifest = JSON.parse(bundle.manifest);
  if (
    manifest['manifest-version'] !== '1' ||
    manifest['compiler-version'] !== '0.35.0' ||
    manifest['runtime-version'] !== '0.20.0'
  )
    fail('unsupported compiler manifest');
  const files = new Map([['compiler/contract-manifest.json', manifestBytes]]);
  for (const [name, directory, pin] of [
    ['index.js', 'contract', manifest.contract?.['index.js']],
    ['index.d.ts', 'contract', manifest.contract?.['index.d.ts']],
    ['index.js.map', 'contract', manifest.contract?.['index.js.map']],
    ['contract-info.json', 'compiler', manifest.compiler?.['contract-info.json']],
  ]) {
    files.set(
      `${directory}/${name}`,
      checked(
        readFileSync(join(PACKAGE_ROOT, 'generated', BINDING, name)),
        pin,
        `${directory}/${name}`,
      ),
    );
  }
  if (!bundle.files || typeof bundle.files !== 'object' || Array.isArray(bundle.files))
    fail('key bundle has no file map');
  const circuits = Object.keys(manifest.keys ?? {})
    .filter((name) => name.endsWith('.verifier'))
    .map((name) => name.slice(0, -'.verifier'.length))
    .sort();
  if (circuits.length !== 52) fail('unexpected ACC circuit roster');
  const expected = new Map();
  for (const circuit of circuits) {
    if (!/^[a-z][a-z0-9_]*$/.test(circuit)) fail('invalid circuit name');
    expected.set(`keys/${circuit}.verifier`, manifest.keys[`${circuit}.verifier`]);
    expected.set(`zkir/${circuit}.zkir`, manifest.zkir?.[`${circuit}.zkir`]);
    expected.set(`zkir/${circuit}.bzkir`, manifest.zkir?.[`${circuit}.bzkir`]);
  }
  if (Object.keys(bundle.files).length !== expected.size) fail('unexpected bundled file set');
  for (const [name, pin] of expected) {
    const encoded = Object.hasOwn(bundle.files, name) ? bundle.files[name] : undefined;
    if (
      typeof encoded !== 'string' ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)
    )
      fail(`${name} has invalid bundled bytes`);
    files.set(name, checked(Buffer.from(encoded, 'base64'), pin, name));
  }
  return { files, circuits };
}

function exportDependency(options) {
  // Resolve the existing parent, so the receipt names the actual output, not
  // a symlink alias. Reserve a new root exclusively; never reuse a prior run.
  const requested = resolve(options['--output']);
  const output = join(realpathSync(dirname(requested)), basename(requested));
  try {
    lstatSync(output);
    fail('output already exists; choose a new directory');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  // No output is created for an integrity failure, including in an unused
  // circuit. Pins are checked before any generated code can be imported.
  const { files, circuits } = verifiedFiles();
  mkdirSync(output, { mode: 0o700 });
  const partial = join(output, '.account-incomplete');
  mkdirSync(partial, { mode: 0o700 });
  const pins = {};
  for (const [name, bytes] of files) {
    const target = join(partial, name);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, bytes, { flag: 'wx', mode: 0o644 });
    const copied = readFileSync(target);
    if (copied.length !== bytes.length || hash(copied) !== hash(bytes))
      fail(`incomplete export of ${name}`);
    pins[name] = { bytes: bytes.length, sha256: hash(bytes) };
  }
  // The compiler-visible account directory appears only after all its bytes
  // have been checked. Failed writes retain the private incomplete root.
  renameSync(partial, join(output, 'account'));
  const receipt = {
    schemaVersion: 1,
    bindingId: BINDING,
    compilerManifestSha256: MANIFEST,
    compilerVersion: '0.35.0',
    runtimeVersion: '0.20.0',
    dependency: 'account',
    proofCircuits: circuits,
    proverKeysIncluded: false,
    files: pins,
  };
  writeFileSync(join(output, 'export-receipt.json'), JSON.stringify(receipt, null, 2) + '\n', {
    flag: 'wx',
    mode: 0o644,
  });
  console.log(JSON.stringify({ output, ...receipt }));
}

try {
  if (process.argv.slice(2).includes('--help')) {
    console.log(
      'Usage: mn-passport-export-compact --output <new-directory> ' +
        '[--binding acc-s3r1.1] [--manifest-sha256 <independent-pin>]\n' +
        'Use the new directory as --compact-path. It contains account/{compiler,contract,keys,zkir}.\n' +
        'No prover keys, private state, source contracts or spending authority are exported.',
    );
  } else {
    exportDependency(parse(process.argv.slice(2)));
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
