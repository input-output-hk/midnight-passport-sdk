// Public upstream source is a separately pinned input, not inferred from an npm version.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createRequire, isBuiltin } from 'node:module';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { installedTreeIdentity, verifyRetainedHostConsumer } from './host-retained.mjs';

export const PUBLIC_SIGNER_SOURCE = Object.freeze({
  repository: 'https://github.com/input-output-hk/lace-sdk.git',
  commit: 'ce04076bbe70d8455c924d175cfcb7ee65844ae7',
  module: 'packages/module/passport-account/src/remote/signer-handlers.ts',
  server: 'packages/lib/passkey/src/remote/server.ts',
  generated: 'packages/module/passport-account/src/acc/generated/index.js',
  moduleSha256: '0ee002d3ac6eae8c048fbd9017ed2f1215e3961629f998221dd9b3e77d74bccf',
});
/** @param {Uint8Array|string} bytes */
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
/** @param {string} directory @param {string[]} args */
const git = (directory, args) =>
  execFileSync('git', ['-C', directory, ...args], { maxBuffer: 16 * 1024 ** 2, timeout: 30000 });
/** @param {string} root @param {string} file */
export function signerRelativeFile(root, file) {
  assert.ok(isAbsolute(file));
  const path = relative(root, file);
  assert.ok(path && !path.startsWith('../') && !isAbsolute(path), 'Source path escaped its root');
  assert.ok(
    !path.split('/').includes('node_modules'),
    'Source must not traverse installed packages',
  );
  return path;
}
/** @param {string} requested */
export function publicSignerSource(requested) {
  const root = realpathSync(requested);
  assert.equal(git(root, ['rev-parse', '--show-toplevel']).toString().trim(), root);
  assert.equal(git(root, ['rev-parse', 'HEAD']).toString().trim(), PUBLIC_SIGNER_SOURCE.commit);
  assert.equal(
    git(root, ['remote', 'get-url', 'origin']).toString().trim(),
    PUBLIC_SIGNER_SOURCE.repository,
  );
  assert.equal(
    git(root, ['status', '--porcelain', '--untracked-files=normal']).length,
    0,
    'Public source must be clean',
  );
  const files = new Map();
  /** Read the pinned Git blob even in a sparse checkout. Existing worktree bytes must match.
   * @param {string} path
   */
  const read = (path) => {
    assert.equal(path.includes('..'), false);
    const entry = git(root, ['ls-tree', 'HEAD', '--', path]).toString().trim();
    assert.match(entry, /^100(?:644|755) blob [a-f0-9]{40}\t/);
    assert.equal(entry.slice(entry.indexOf('\t') + 1), path);
    const blob = entry.match(/[a-f0-9]{40}(?=\t)/)?.[0];
    assert.ok(blob);
    const bytes = git(root, ['cat-file', 'blob', blob]);
    const physical = join(root, path);
    if (existsSync(physical)) {
      assert.ok(lstatSync(physical).isFile() && !lstatSync(physical).isSymbolicLink());
      assert.equal(realpathSync(physical), physical);
      assert.equal(
        hash(readFileSync(physical)),
        hash(bytes),
        'Worktree source differs from pinned blob',
      );
    }
    const metadata = { path, blob, bytes: bytes.length, sha256: hash(bytes) };
    files.set(path, metadata);
    return bytes;
  };
  assert.equal(hash(read(PUBLIC_SIGNER_SOURCE.generated)), PUBLIC_SIGNER_SOURCE.moduleSha256);
  return { root, files, read };
}
/** Only the simple dependency ranges present in this pinned graph are admitted.
 * @param {string} range @param {string} version
 */
export function signerDependencyRange(range, version) {
  if (range === version) return true;
  if (range === '*') return /^\d+\.\d+\.\d+$/.test(version);
  const actual = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  const caret = /^\^(\d+)\.(\d+)\.(\d+)$/.exec(range);
  if (!actual || !caret) return false;
  const a = { major: Number(actual[1]), minor: Number(actual[2]), patch: Number(actual[3]) },
    b = { major: Number(caret[1]), minor: Number(caret[2]), patch: Number(caret[3]) };
  return (
    a.major === b.major &&
    (b.major === 0
      ? a.minor === b.minor && (b.minor === 0 ? a.patch === b.patch : a.patch >= b.patch)
      : a.minor > b.minor || (a.minor === b.minor && a.patch >= b.patch))
  );
}
/** @param {string} root */
export function signerBundleTree(root) {
  /** @type {Record<string,{bytes:number,sha256:string}>} */
  const files = {};
  /** @param {string} directory */
  const walk = (directory) => {
    for (const name of readdirSync(directory).sort()) {
      const path = join(directory, name),
        stat = lstatSync(path);
      assert.equal(stat.isSymbolicLink(), false, 'Signer bundle must not contain links');
      if (stat.isDirectory()) walk(path);
      else {
        assert.ok(stat.isFile());
        files[relative(root, path)] = { bytes: stat.size, sha256: hash(readFileSync(path)) };
      }
    }
  };
  walk(root);
  assert.ok(Object.keys(files).length > 0);
  return files;
}
/** @param {string} root @param {string} name */
function packageRoot(root, name) {
  const path = join(root, 'node_modules', name);
  assert.ok(existsSync(join(path, 'package.json')), 'A pinned dependency is missing: ' + name);
  return realpathSync(path);
}
/** @param {{consumer:string,consumerPin:string,source:string,extras:string,output:string,repository:string}} options */
export async function buildPublicSigner(options) {
  const consumer = realpathSync(options.consumer),
    extras = realpathSync(options.extras);
  verifyRetainedHostConsumer(consumer, options.consumerPin, options.repository);
  const source = publicSignerSource(options.source);
  assert.ok(isAbsolute(options.output));
  assert.equal(existsSync(options.output), false, 'Preserve every earlier public signer build');
  assert.equal(
    realpathSync(dirname(options.output)),
    consumer,
    'Prepared signer must be a fresh direct consumer child',
  );
  assert.match(basename(options.output), /^signer-[a-z0-9-]+$/);
  const extraPackage = readFileSync(join(extras, 'package.json'));
  const extraManifest = JSON.parse(extraPackage.toString());
  assert.deepEqual(extraManifest.dependencies, {
    '@scure/bip39': '1.6.0',
    '@noble/hashes': '1.8.0',
    '@noble/ciphers': '2.2.0',
    'bip39-build-wordlist': 'npm:@scure/bip39@2.2.0',
  });
  const extraTree = installedTreeIdentity(extras),
    extraLock = hash(readFileSync(join(extras, 'pnpm-lock.yaml')));
  const upstreamBuild = source.read('apps/lace-sdk/tsdown.config.ts').toString();
  assert.ok(
    upstreamBuild.includes(
      "'@scure/bip39/wordlists/english.js': nm('@scure/bip39/wordlists/english.js')",
    ),
    'Upstream wordlist build alias changed',
  );
  const upstreamLock = JSON.parse(source.read('package-lock.json').toString());
  assert.equal(upstreamLock.packages['node_modules/@scure/bip39'].version, '2.2.0');
  assert.equal(
    upstreamLock.packages['packages/lib/crypto/node_modules/@scure/bip39'].version,
    '1.6.0',
  );
  mkdirSync(options.output, { mode: 0o700 });
  const output = realpathSync(options.output);
  const entry = join(output, 'source-entry.ts');
  writeFileSync(
    entry,
    [
      `export {createPassportSignerHandlers} from ${JSON.stringify(join(source.root, PUBLIC_SIGNER_SOURCE.module))};`,
      `export {serveSignerRequests} from ${JSON.stringify(join(source.root, PUBLIC_SIGNER_SOURCE.server))};`,
      `export {createAccountRecordStore,toAccountRecords} from ${JSON.stringify(join(source.root, 'packages/module/passport-account/src/store/account-record.ts'))};`,
      `export {createManifestKeyMaterialResolver} from ${JSON.stringify(join(source.root, 'packages/module/passport-account/src/infra/http-prover.ts'))};`,
      `export {decodeSignerFlow} from ${JSON.stringify(join(source.root, 'packages/module/passport-account/src/remote/flow-descriptor.ts'))};`,
      `export {AccAddress,DeviceEpoch,UseCounter} from ${JSON.stringify(join(source.root, 'packages/contract/passport/src/value-objects/index.ts'))};`,
    ].join('\n') + '\n',
    { flag: 'wx', mode: 0o600 },
  );
  const consumerRequire = createRequire(join(consumer, 'package.json'));
  const toolRequire = createRequire(consumerRequire.resolve('vite'));
  const { rolldown } = await import(pathToFileURL(toolRequire.resolve('rolldown')).href);
  const resolvers = [
    consumerRequire,
    createRequire(join(consumer, 'node_modules/.pnpm/node_modules/.resolver.cjs')),
    createRequire(consumerRequire.resolve('@laceio/sdk/experimental')),
  ];
  const externalRecords = new Map(),
    manifests = new Map();
  /** @param {string} path */
  const ownerOf = (path) => {
    const match = /^packages\/(contract|lib|module)\/[^/]+\//.exec(path);
    if (!match) return undefined;
    const manifestPath = match[0] + 'package.json';
    if (!manifests.has(manifestPath))
      manifests.set(manifestPath, JSON.parse(source.read(manifestPath).toString()));
    return manifests.get(manifestPath);
  };
  /** @param {string} file */
  const sourceId = (file) => {
    const path = signerRelativeFile(source.root, file),
      metadata = ownerOf(path);
    return { id: file, moduleSideEffects: metadata?.sideEffects === false ? false : undefined };
  };
  /** @param {string} candidate */
  const localFile = (candidate) => {
    for (const suffix of ['', '.ts', '.tsx', '.js', '/index.ts', '/index.js']) {
      const path = signerRelativeFile(source.root, candidate + suffix);
      const row = git(source.root, ['ls-tree', 'HEAD', '--', path]).toString().trim();
      if (/^100(?:644|755) blob /.test(row)) return sourceId(candidate + suffix);
    }
    throw Error('Pinned public source import is missing');
  };
  const built = await rolldown({
    input: entry,
    platform: 'node',
    plugins: [
      {
        name: 'pinned-public-signer',
        /** @param {string} id @param {string|undefined} importer */
        resolveId(id, importer) {
          if (isBuiltin(id)) return { id, external: true };
          if (isAbsolute(id)) return id.startsWith(source.root + '/') ? localFile(id) : null;
          if (id.startsWith('.'))
            return importer?.startsWith(source.root + '/')
              ? localFile(resolve(dirname(importer), id))
              : null;
          const alias = /^@lace-(contract|lib|module)\/([a-z0-9-]+)(\/.*)?$/.exec(id);
          if (alias) {
            const directory = `packages/${alias[1]}/${alias[2]}`;
            const manifest = JSON.parse(source.read(directory + '/package.json').toString());
            const sub = alias[3] ? '.' + alias[3] : '.';
            const target = manifest.exports?.[sub] ?? (sub === '.' ? manifest.main : undefined);
            assert.equal(typeof target, 'string', 'Public source alias has no declared entry');
            return localFile(resolve(source.root, directory, target));
          }
          const name = id.startsWith('@')
            ? id.split('/').slice(0, 2).join('/')
            : (id.split('/')[0] ?? '');
          let found;
          if (id === '@scure/bip39/wordlists/english.js') {
            const pkg = packageRoot(extras, 'bip39-build-wordlist');
            assert.equal(
              JSON.parse(readFileSync(join(pkg, 'package.json'), 'utf8')).version,
              '2.2.0',
            );
            found = createRequire(join(pkg, 'package.json')).resolve(id);
          } else if (
            name === '@scure/bip39' ||
            name === '@noble/hashes' ||
            name === '@noble/ciphers'
          )
            found = createRequire(join(packageRoot(extras, name), 'package.json')).resolve(id);
          else if (name === '@noble/curves') {
            const pkg = join(
              consumer,
              'node_modules/.pnpm/@noble+curves@2.2.0/node_modules/@noble/curves',
            );
            assert.equal(
              JSON.parse(readFileSync(join(pkg, 'package.json'), 'utf8')).version,
              '2.2.0',
            );
            found = createRequire(join(pkg, 'package.json')).resolve(id);
          } else
            for (const resolver of resolvers) {
              try {
                found = resolver.resolve(id);
                break;
              } catch {}
            }
          // An unused upstream barrel may name dependencies outside this selected closure.
          // Any such import surviving tree-shaking is refused below, before execution.
          if (!found) return { id, external: true };
          const physical = realpathSync(found);
          assert.ok(
            [join(consumer, 'node_modules') + '/', join(extras, 'node_modules') + '/'].some(
              (root) => physical.startsWith(root),
            ),
            'External dependency escaped audited trees',
          );
          let parent = dirname(physical);
          for (;;) {
            if (
              existsSync(join(parent, 'package.json')) &&
              JSON.parse(readFileSync(join(parent, 'package.json'), 'utf8')).name === name
            )
              break;
            const next = dirname(parent);
            assert.notEqual(next, parent);
            parent = next;
          }
          const pkg = JSON.parse(readFileSync(join(parent, 'package.json'), 'utf8'));
          const declared = importer?.startsWith(source.root + '/')
            ? ownerOf(signerRelativeFile(source.root, importer))
            : undefined;
          const range =
            declared?.dependencies?.[name] ??
            declared?.peerDependencies?.[name] ??
            declared?.devDependencies?.[name] ??
            upstreamLock.packages['node_modules/' + name]?.version;
          const previous = externalRecords.get(physical);
          const requirements = previous?.requirements ?? [];
          if (range && importer && id !== '@scure/bip39/wordlists/english.js')
            requirements.push({ importer: signerRelativeFile(source.root, importer), range });
          externalRecords.set(physical, {
            name: pkg.name,
            version: pkg.version,
            path: physical,
            sha256: hash(readFileSync(physical)),
            requirements,
          });
          return {
            id: physical,
            external: true,
            moduleSideEffects: pkg.sideEffects === false ? false : undefined,
          };
        },
        /** @param {string} id */
        load(id) {
          if (id.startsWith(source.root + '/'))
            return source.read(signerRelativeFile(source.root, id)).toString();
          return null;
        },
      },
    ],
  });
  /** @type {any[]} */
  let chunks;
  try {
    chunks = (
      await built.write({
        dir: join(output, 'bundle'),
        format: 'esm',
        entryFileNames: 'handlers.mjs',
        chunkFileNames: 'chunk-[hash].mjs',
        sourcemap: false,
      })
    ).output;
  } finally {
    await built.close();
  }
  const emitted = new Set();
  for (const chunk of chunks)
    if (chunk.type === 'chunk')
      for (const id of [...chunk.imports, ...chunk.dynamicImports]) {
        if (isBuiltin(id) || chunks.some((c) => c.fileName === id)) continue;
        assert.ok(
          externalRecords.has(id),
          'Unresolved or unaudited import survived signer bundling: ' + id,
        );
        const external = externalRecords.get(id);
        for (const requirement of external.requirements)
          assert.ok(
            signerDependencyRange(requirement.range, external.version),
            'Live installed dependency violates the public source range: ' + external.name,
          );
        emitted.add(id);
      }
  const record = {
    schemaVersion: 1,
    kind: 'public-source-signer',
    source: {
      ...PUBLIC_SIGNER_SOURCE,
      root: source.root,
      closure: [...source.files.values()].sort((a, b) => a.path.localeCompare(b.path)),
    },
    consumer: { root: consumer, configSha256: options.consumerPin },
    extras: {
      root: extras,
      packageSha256: hash(extraPackage),
      lockSha256: extraLock,
      tree: extraTree,
    },
    upstreamBuildAlias: {
      request: '@scure/bip39/wordlists/english.js',
      version: '2.2.0',
      mnemonicVersion: '1.6.0',
    },
    externals: [...emitted].sort().map((id) => externalRecords.get(id)),
    bundle: signerBundleTree(join(output, 'bundle')),
    builderSha256: hash(readFileSync(import.meta.filename)),
    entrySha256: hash(readFileSync(entry)),
    fullUpstreamTypecheck: false,
    realProvider: false,
    signerPage: false,
  };
  verifyRetainedHostConsumer(consumer, options.consumerPin, options.repository);
  assert.deepEqual(installedTreeIdentity(extras), extraTree);
  assert.equal(hash(readFileSync(join(extras, 'pnpm-lock.yaml'))), extraLock);
  for (const file of record.source.closure) assert.equal(hash(source.read(file.path)), file.sha256);
  const bytes = JSON.stringify(record, null, 2) + '\n';
  writeFileSync(join(output, 'signer-inputs.json'), bytes, { flag: 'wx', mode: 0o600 });
  return {
    root: output,
    configSha256: hash(bytes),
    sourceFiles: record.source.closure.length,
    bundleFiles: Object.keys(record.bundle).length,
  };
}
/** No evaluated bundle code: validate before imports and again after execution.
 * @param {string} root @param {string} expected @param {string} repository
 */
export function verifyPublicSigner(root, expected, repository) {
  assert.match(expected, /^[a-f0-9]{64}$/);
  const bytes = readFileSync(join(root, 'signer-inputs.json'));
  assert.equal(hash(bytes), expected, 'Public signer configuration pin changed');
  const input = JSON.parse(bytes.toString());
  assert.equal(input.schemaVersion, 1);
  assert.equal(input.kind, 'public-source-signer');
  for (const [key, value] of Object.entries(PUBLIC_SIGNER_SOURCE))
    assert.equal(input.source[key], value);
  assert.equal(
    input.builderSha256,
    hash(readFileSync(import.meta.filename)),
    'Signer preparation recipe changed; use a fresh root',
  );
  assert.equal(input.entrySha256, hash(readFileSync(join(root, 'source-entry.ts'))));
  verifyRetainedHostConsumer(input.consumer.root, input.consumer.configSha256, repository);
  const source = publicSignerSource(input.source.root);
  for (const file of input.source.closure) {
    const bytes = source.read(file.path);
    assert.equal(bytes.length, file.bytes);
    assert.equal(hash(bytes), file.sha256);
  }

  assert.deepEqual(
    signerBundleTree(join(root, 'bundle')),
    input.bundle,
    'Public signer bundle bytes changed',
  );
  assert.equal(
    hash(readFileSync(join(input.extras.root, 'package.json'))),
    input.extras.packageSha256,
  );
  assert.equal(
    hash(readFileSync(join(input.extras.root, 'pnpm-lock.yaml'))),
    input.extras.lockSha256,
  );
  assert.deepEqual(installedTreeIdentity(input.extras.root), input.extras.tree);
  for (const file of input.externals) assert.equal(hash(readFileSync(file.path)), file.sha256);
  return input;
}
