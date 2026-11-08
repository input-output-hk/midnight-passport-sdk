#!/usr/bin/env node
// Offline copied-dist preview, not an installed or published package qualification.
import { createHash } from 'node:crypto';
import { spawnSync, execFileSync } from 'node:child_process';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  symlinkSync,
  writeFileSync,
  copyFileSync,
} from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';
import { releasePackageDirectories } from '../release-package-list.mjs';
import {
  qualityNodeTypes,
  qualityWebTypes,
  qualityWorkerTypes,
  qualityConfigTypes,
  qualityRuntimeSmoke,
} from './quality-contracts.mjs';

const prefix = '@input-output-hk/mn-passport-';
/** @param {Uint8Array|string} bytes */
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
/** @param {string} root @param {string} path */
const within = (root, path) => path === root || path.startsWith(root + sep);
/** @param {string} root @param {string} output */
export function previewOutputRoot(root, output) {
  const repository = realpathSync(root);
  if (!isAbsolute(output)) throw Error('preview output must be an absolute fresh path');
  const target = resolve(output);
  if (lstatSync(target, { throwIfNoEntry: false }))
    throw Error('preview output already exists; retain it and choose a fresh path');
  const canonical = join(realpathSync(dirname(target)), basename(target));
  if (within(repository, canonical) || within(canonical, repository))
    throw Error('preview output overlaps the repository');
  return canonical;
}
/** @param {string} root */
const manifest = (root) => JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

/** Every SDK export is a real copied file, never a link or an escape. @param {string} root @param {unknown} exports */
export function verifyPreviewExports(root, exports) {
  /** @type {string[]} */ const targets = [];
  const visit = (/** @type {unknown} */ value) => {
    if (typeof value === 'string') targets.push(value);
    else if (value && typeof value === 'object')
      for (const item of Object.values(value)) visit(item);
    else if (value !== null) throw Error('unsupported preview export declaration');
  };
  visit(exports);
  if (!targets.length) throw Error('preview package has no export targets');
  for (const target of targets) {
    if (
      !target.startsWith('./') ||
      target.includes('*') ||
      target.split('/').some((part) => part === '..' || part === 'src')
    )
      throw Error('unsafe preview export target');
    const file = resolve(root, target);
    if (
      !within(root, file) ||
      !existsSync(file) ||
      !lstatSync(file).isFile() ||
      lstatSync(file).isSymbolicLink() ||
      !within(realpathSync(root), realpathSync(file))
    )
      throw Error('missing or escaping preview export target');
  }
  return targets.length;
}
/** @param {string} preview @param {string} specifier @param {string} file */
export function assertPreviewSdkResolution(preview, specifier, file) {
  if (!specifier.startsWith(prefix)) return;
  const name = specifier.split('/').slice(0, 2).join('/');
  const folder = join(preview, 'node_modules', name);
  if (
    !existsSync(folder) ||
    lstatSync(folder).isSymbolicLink() ||
    !within(folder, resolve(file)) ||
    !within(realpathSync(folder), realpathSync(file))
  )
    throw Error('SDK import escapes the copied preview graph');
}
/** @param {string} folder */
export function assertExternalPackage(folder) {
  const value = manifest(folder);
  if (typeof value.name !== 'string' || value.name.startsWith(prefix))
    throw Error('external dependency points to an SDK package');
  return value;
}
/** Local ancestor node_modules only; no NODE_PATH, registry or package entry execution. @param {string} from @param {string} name */
function localPackage(from, name) {
  if (!/^(@[a-zA-Z0-9._-]+\/)?[a-zA-Z0-9._-]+$/.test(name))
    throw Error('invalid local dependency name');
  let cursor = from;
  for (;;) {
    const folder = join(cursor, 'node_modules', name);
    if (existsSync(join(folder, 'package.json'))) return realpathSync(folder);
    const parent = dirname(cursor);
    if (parent === cursor) throw Error(`missing offline dependency ${name}`);
    cursor = parent;
  }
}
/** @param {string} root @param {boolean} [strict] */
function treeFiles(root, strict = true) {
  /** @type {{path:string,size:number,sha256:string}[]} */ const files = [];
  const walk = (/** @type {string} */ directory, /** @type {string[]} */ ancestors) => {
    const canonical = realpathSync(directory);
    if (ancestors.includes(canonical))
      throw Error('dependency symlink cycle in preview fingerprint');
    const next = [...ancestors, canonical];
    for (const entry of readdirSync(directory).sort()) {
      if (entry === 'node_modules' || entry === '.tsbuildinfo') continue;
      const path = join(directory, entry),
        stat = lstatSync(path);
      if (stat.isSymbolicLink()) {
        if (strict) throw Error('SDK preview artifacts cannot contain symlinks');
        const physical = realpathSync(path),
          target = lstatSync(physical);
        files.push({
          path: relative(root, path) + '/@symlink-target',
          size: 0,
          sha256: hash(physical),
        });
        if (target.isDirectory()) walk(path, next);
        else if (target.isFile())
          files.push({
            path: relative(root, path),
            size: target.size,
            sha256: hash(readFileSync(physical)),
          });
        else throw Error('dependency symlink points to a special file');
      } else if (stat.isDirectory()) walk(path, next);
      else if (stat.isFile())
        files.push({
          path: relative(root, path),
          size: stat.size,
          sha256: hash(readFileSync(path)),
        });
      else throw Error('preview tree contains a special file');
    }
  };
  walk(root, []);
  return files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}
/** @param {{path:string,size:number,sha256:string}[]} files */
const fingerprint = (files) => ({
  fileCount: files.length,
  bytes: files.reduce((sum, file) => sum + file.size, 0),
  sha256: hash(JSON.stringify(files)),
  files,
});
/** @param {string} root @param {unknown} value */
function publishedFiles(root, value) {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string'))
    throw Error('preview package needs explicit files entries');
  const entries = value.filter((entry) => typeof entry === 'string');
  /** @type {{path:string,size:number,sha256:string}[]} */ const files = [];
  const exclusions = new Set(
    entries.filter((entry) => entry.startsWith('!')).map((entry) => entry.slice(1)),
  );
  for (const entry of ['package.json', ...entries.filter((entry) => !entry.startsWith('!'))]) {
    if (
      entry.includes('*') ||
      isAbsolute(entry) ||
      entry.split('/').some((part) => part === '..' || part === 'src')
    )
      throw Error('unsupported preview package file entry');
    const source = join(root, entry);
    if (!existsSync(source)) throw Error('missing preview package artifact');
    if (!within(realpathSync(root), realpathSync(source)))
      throw Error('SDK preview artifact escapes its source package');
    const stat = lstatSync(source);
    if (stat.isSymbolicLink()) throw Error('SDK preview artifacts cannot contain symlinks');
    const entries = stat.isDirectory()
      ? treeFiles(source).map((file) => ({ ...file, path: join(entry, file.path) }))
      : [{ path: entry, size: stat.size, sha256: hash(readFileSync(source)) }];
    files.push(...entries.filter((file) => !exclusions.has(file.path)));
  }
  return [...new Map(files.map((file) => [file.path, file])).values()].sort((a, b) =>
    a.path < b.path ? -1 : a.path > b.path ? 1 : 0,
  );
}
/** Running tools and shared fixture bytes are also checked before/after execution. */
function toolSnapshot() {
  return fingerprint(
    [
      process.execPath,
      fileURLToPath(import.meta.url),
      fileURLToPath(new URL('./quality-contracts.mjs', import.meta.url)),
    ].map((file) => {
      const path = realpathSync(file),
        bytes = readFileSync(path);
      return { path, size: bytes.length, sha256: hash(bytes) };
    }),
  );
}
/** @param {string} repository */
function sdkSnapshot(repository) {
  return releasePackageDirectories.map((directory) => {
    const root = join(repository, 'packages', directory),
      pkg = manifest(root);
    if (pkg.private || pkg.name !== prefix + directory)
      throw Error('unexpected preview package identity');
    const artifacts = publishedFiles(root, pkg.files);
    return {
      directory,
      name: pkg.name,
      root,
      pkg,
      artifacts,
      source: fingerprint(treeFiles(join(root, 'src'))),
      published: fingerprint(artifacts),
    };
  });
}
/** @param {ReturnType<typeof sdkSnapshot>} packages @param {string} output */
function copyPackages(packages, output) {
  let exports = 0;
  for (const pkg of packages) {
    const target = join(output, 'node_modules', pkg.name);
    mkdirSync(target, { recursive: true });
    for (const file of pkg.artifacts) {
      const destination = join(target, file.path);
      mkdirSync(dirname(destination), { recursive: true });
      copyFileSync(join(pkg.root, file.path), destination);
    }
    exports += verifyPreviewExports(target, pkg.pkg.exports);
    if (JSON.stringify(treeFiles(target)) !== JSON.stringify(pkg.artifacts))
      throw Error('copied SDK artifacts differ from source');
  }
  return exports;
}
/** @param {ReturnType<typeof sdkSnapshot>} packages @param {string} output @param {string} repository */
function reuseDependencies(packages, output, repository) {
  const sdkNames = new Set(packages.map((pkg) => pkg.name));
  /** @type {Map<string,{folder:string,name:string,version:string,manifestSha256:string,tree:ReturnType<typeof fingerprint>}>} */ const external =
    new Map();
  /** @type {string[]} */ const pending = [];
  for (const pkg of packages) {
    for (const name of Object.keys({ ...pkg.pkg.dependencies, ...pkg.pkg.peerDependencies })) {
      if (name.startsWith(prefix)) {
        if (!sdkNames.has(name)) throw Error('SDK dependency is absent from preview');
        continue;
      }
      const folder = localPackage(pkg.root, name);
      assertExternalPackage(folder);
      const destination = join(output, 'node_modules', pkg.name, 'node_modules', name);
      mkdirSync(dirname(destination), { recursive: true });
      symlinkSync(folder, destination, 'dir');
      pending.push(folder);
    }
  }
  pending.push(localPackage(repository, 'typescript'));
  while (pending.length) {
    const folder = pending.pop();
    if (!folder || external.has(folder)) continue;
    const value = assertExternalPackage(folder);
    external.set(folder, {
      folder,
      name: value.name,
      version: value.version,
      manifestSha256: hash(readFileSync(join(folder, 'package.json'))),
      tree: fingerprint(treeFiles(folder, false)),
    });
    const optional = new Set([
      ...Object.keys(value.optionalDependencies ?? {}),
      ...Object.entries(value.peerDependenciesMeta ?? {})
        .filter(
          ([, meta]) =>
            meta && typeof meta === 'object' && 'optional' in meta && meta.optional === true,
        )
        .map(([name]) => name),
    ]);
    for (const name of Object.keys({
      ...value.dependencies,
      ...value.optionalDependencies,
      ...value.peerDependencies,
    })) {
      if (name.startsWith(prefix)) throw Error('external dependency graph reaches an SDK package');
      try {
        pending.push(localPackage(folder, name));
      } catch (error) {
        if (!optional.has(name)) throw error;
      }
    }
  }
  return [...external.values()].sort((a, b) => a.folder.localeCompare(b.folder));
}
/** @param {string} output @param {ReturnType<typeof sdkSnapshot>} packages */
function compileFixtures(output, packages) {
  const directory = join(output, 'fixtures');
  mkdirSync(directory);
  const cases = [
    {
      name: 'node',
      source: qualityNodeTypes + qualityConfigTypes,
      lib: ['ES2022'],
      module: 'NodeNext',
      moduleResolution: 'NodeNext',
    },
    {
      name: 'web',
      source: qualityWebTypes + qualityConfigTypes,
      lib: ['ES2022', 'DOM'],
      module: 'ESNext',
      moduleResolution: 'Bundler',
    },
    {
      name: 'worker',
      source: qualityWorkerTypes + qualityConfigTypes,
      lib: ['ES2022', 'WebWorker'],
      module: 'ESNext',
      moduleResolution: 'Bundler',
    },
  ];
  const results = [];
  for (const fixture of cases) {
    const file = join(directory, fixture.name + '.mts');
    writeFileSync(file, fixture.source, { flag: 'wx' });
    const config = {
      compilerOptions: {
        target: 'ES2022',
        module: fixture.module,
        moduleResolution: fixture.moduleResolution,
        strict: true,
        exactOptionalPropertyTypes: true,
        noUncheckedIndexedAccess: true,
        noUnusedLocals: true,
        noUnusedParameters: true,
        noEmit: true,
        skipLibCheck: false,
        types: [],
        lib: fixture.lib,
      },
      files: [file],
    };
    writeFileSync(join(directory, fixture.name + '.json'), JSON.stringify(config, null, 2), {
      flag: 'wx',
    });
    const parsed = ts.parseJsonConfigFileContent(config, ts.sys, directory);
    const program = ts.createProgram(parsed.fileNames, parsed.options),
      diagnostics = [...parsed.errors, ...ts.getPreEmitDiagnostics(program)];
    let sdkResolutions = 0;
    for (const source of program.getSourceFiles()) {
      const physical = realpathSync(source.fileName);
      if (packages.some((pkg) => within(pkg.root, physical)))
        throw Error('TypeScript resolved an SDK source or workspace artifact outside the preview');
      for (const dependency of ts.preProcessFile(source.text).importedFiles) {
        if (!dependency.fileName.startsWith(prefix)) continue;
        const target = ts.resolveModuleName(
          dependency.fileName,
          source.fileName,
          parsed.options,
          ts.sys,
        ).resolvedModule;
        if (!target) throw Error('SDK import did not resolve in preview');
        assertPreviewSdkResolution(output, dependency.fileName, target.resolvedFileName);
        sdkResolutions++;
      }
    }
    writeFileSync(
      join(directory, fixture.name + '.log'),
      ts.formatDiagnostics(diagnostics, {
        getCanonicalFileName: (file) => file,
        getCurrentDirectory: () => directory,
        getNewLine: () => '\n',
      }),
      { flag: 'wx' },
    );
    results.push({
      name: fixture.name,
      diagnostics: diagnostics.length,
      sourceFiles: program.getSourceFiles().length,
      sdkResolutions,
    });
  }
  return results;
}
/** Zod's safe typeof-navigator probe must observe an absent value, not a throwing getter.
 * Only the recorded dependency file receives that exception; SDK accesses still throw.
 * @param {string[]} navigatorProbeFiles
 */
export function previewBrowserGuard(navigatorProbeFiles) {
  const callers = navigatorProbeFiles.map(
    (file) => 'at ' + pathToFileURL(realpathSync(file)).href + ':',
  );
  return `const callers=${JSON.stringify(callers)};for(const name of ['window','document','indexedDB','navigator'])Object.defineProperty(globalThis,name,{configurable:true,get(){const caller=(new Error().stack??'').split('\\n')[2]?.trim()??'';if(name==='navigator'&&callers.some(prefix=>caller.startsWith(prefix))){process.stderr.write('EXTERNAL_BROWSER_PROBE '+JSON.stringify({name,caller})+'\\n');return undefined;}throw Error('Unexpected ambient browser access: '+name);}});`;
}
/** @param {string} output @param {ReturnType<typeof sdkSnapshot>} packages @param {ReturnType<typeof reuseDependencies>} external */
function runtimePreview(output, packages, external) {
  const directory = join(output, 'runtime');
  mkdirSync(directory);
  const guard = join(directory, 'guard.mjs'),
    loader = join(directory, 'loader.mjs'),
    entry = join(directory, 'smoke.mjs');
  const navigatorProbeFiles = external
    .filter((value) => value.name === 'zod')
    .map((value) => join(value.folder, 'v4/core/util.js'))
    .filter(existsSync);
  writeFileSync(guard, previewBrowserGuard(navigatorProbeFiles), { flag: 'wx' });
  writeFileSync(
    loader,
    `import{realpathSync,writeSync}from'node:fs';import{fileURLToPath}from'node:url';import{join,sep}from'node:path';const root=${JSON.stringify(output)};export async function resolve(specifier,context,next){const result=await next(specifier,context);if(specifier.startsWith(${JSON.stringify(prefix)})){const name=specifier.split('/').slice(0,2).join('/'),expected=join(root,'node_modules',name),actual=realpathSync(fileURLToPath(result.url));if(!actual.startsWith(expected+sep))throw Error('SDK runtime import escaped preview');writeSync(2,'SDK_RESOLVE '+JSON.stringify({specifier,url:result.url})+'\\n');}return result;}`,
    { flag: 'wx' },
  );
  const exports = packages.flatMap((pkg) =>
    Object.keys(pkg.pkg.exports).map(
      (subpath) => pkg.name + (subpath === '.' ? '' : subpath.slice(1)),
    ),
  );
  writeFileSync(
    entry,
    qualityRuntimeSmoke +
      `\nfor(const specifier of ${JSON.stringify(exports)}){const url=import.meta.resolve(specifier);if(!url.startsWith(${JSON.stringify(pathToFileURL(join(output, 'node_modules') + sep).href)}))throw Error('SDK export escaped preview');}console.log('Preview export resolutions: '+${exports.length});`,
    { flag: 'wx' },
  );
  const result = spawnSync(
    process.execPath,
    ['--import', guard, '--experimental-loader', loader, entry],
    {
      cwd: output,
      env: { PATH: process.env.PATH ?? '', LANG: 'C.UTF-8' },
      encoding: 'utf8',
      timeout: 30000,
      maxBuffer: 8 * 1024 * 1024,
    },
  );
  writeFileSync(join(directory, 'stdout.log'), result.stdout ?? '', { flag: 'wx' });
  writeFileSync(join(directory, 'stderr.log'), result.stderr ?? '', { flag: 'wx' });
  return {
    exitCode: result.status,
    signal: result.signal,
    failure: result.error?.message,
    stdoutBytes: Buffer.byteLength(result.stdout ?? ''),
    stderrBytes: Buffer.byteLength(result.stderr ?? ''),
    exportResolutions: exports.length,
    sdkImportResolutions: (result.stderr ?? '')
      .split('\n')
      .filter((line) => line.startsWith('SDK_RESOLVE ')).length,
    browserGlobals:
      'throwing accessors before entry import; recorded Zod typeof-navigator probes observe undefined',
    externalNavigatorProbeFiles: navigatorProbeFiles,
    externalNavigatorProbes: (result.stderr ?? '')
      .split('\n')
      .filter((line) => line.startsWith('EXTERNAL_BROWSER_PROBE ')).length,
  };
}

/** Run only after the owner freezes source/dist. All outputs/failures remain for inspection.
 * @param {{repository?:string,output:string}} options
 */
export function runPreviewQuality(options) {
  const repository = realpathSync(options.repository ?? resolve(import.meta.dirname, '../..'));
  const output = previewOutputRoot(repository, options.output);
  mkdirSync(output, { mode: 0o700 });
  const receipt = {
    kind: 'offline-source-preview-consumer',
    schemaVersion: 1,
    outcome: 'failed',
    startedAt: new Date().toISOString(),
    nodeVersion: process.version,
    typescriptVersion: ts.version,
    claims: {
      sourcePreview: true,
      externalDependenciesReused: true,
      installedRelease: false,
      registryProvenance: false,
      nativeProof: false,
      realProvider: false,
    },
  };
  /** @type {Record<string,unknown>} */ const evidence = {};
  /** @type {ReturnType<typeof sdkSnapshot>|undefined} */ let before;
  /** @type {ReturnType<typeof reuseDependencies>} */ let external = [];
  /** @type {unknown} */ let failure;
  try {
    evidence.toolsBefore = toolSnapshot();
    evidence.sourceHead = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: repository,
      encoding: 'utf8',
    }).trim();
    evidence.dirty =
      execFileSync('git', ['status', '--porcelain'], { cwd: repository, encoding: 'utf8' }).trim()
        .length > 0;
    before = sdkSnapshot(repository);
    evidence.sdkBefore = before.map(({ name, source, published }) => ({ name, source, published }));
    evidence.exportTargets = copyPackages(before, output);
    external = reuseDependencies(before, output, repository);
    evidence.externalBefore = external;
    writeFileSync(
      join(output, 'package.json'),
      JSON.stringify({ name: 'passport-offline-source-preview', private: true, type: 'module' }),
      { flag: 'wx' },
    );
    const compile = compileFixtures(output, before);
    evidence.compile = compile;
    if (compile.some((result) => result.diagnostics !== 0))
      throw Error('preview compile failed; inspect retained counts and logs');
    const runtime = runtimePreview(output, before, external);
    evidence.runtime = runtime;
    if (runtime.exitCode !== 0 || runtime.failure)
      throw Error('preview runtime smoke failed; inspect retained counts and logs');
    receipt.outcome = 'passed';
  } catch (error) {
    failure = error;
  } finally {
    try {
      evidence.toolsAfter = toolSnapshot();
      if (
        evidence.toolsBefore &&
        JSON.stringify(evidence.toolsBefore) !== JSON.stringify(evidence.toolsAfter)
      )
        throw Error('preview runner, fixtures or Node executable changed during the run');
      const after = sdkSnapshot(repository);
      evidence.sdkAfter = after.map(({ name, source, published }) => ({ name, source, published }));
      const externalAfter = external.map((value) => ({
        ...value,
        manifestSha256: hash(readFileSync(join(value.folder, 'package.json'))),
        tree: fingerprint(treeFiles(value.folder, false)),
      }));
      evidence.externalAfter = externalAfter;
      if (
        before &&
        (JSON.stringify(evidence.sdkBefore) !== JSON.stringify(evidence.sdkAfter) ||
          JSON.stringify(external) !== JSON.stringify(externalAfter))
      )
        throw Error('preview source/dist or reused dependency bytes changed during the run');
      if (before && evidence.exportTargets !== undefined)
        for (const pkg of before)
          if (
            JSON.stringify(treeFiles(join(output, 'node_modules', pkg.name))) !==
            JSON.stringify(pkg.artifacts)
          )
            throw Error('copied SDK graph changed during preview');
      evidence.fingerprintsUnchanged = Boolean(before);
    } catch (error) {
      evidence.provenanceFailure =
        error instanceof Error ? error.message : 'Unknown provenance failure';
      if (failure === undefined) failure = error;
    }
    if (failure !== undefined) {
      receipt.outcome = 'failed';
      evidence.failure = failure instanceof Error ? failure.message : 'Unknown preview failure';
    }
    writeFileSync(
      join(output, 'receipt.json'),
      JSON.stringify({ ...receipt, endedAt: new Date().toISOString(), ...evidence }, null, 2) +
        '\n',
      { flag: 'wx', mode: 0o600 },
    );
  }
  if (failure !== undefined) throw failure;
  return { output, kind: receipt.kind, outcome: receipt.outcome };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.argv.length !== 4 || process.argv[2] !== '--output')
    throw Error('usage: preview-quality.mjs --output NEW_ABSOLUTE_ROOT');
  console.log(JSON.stringify(runPreviewQuality({ output: process.argv[3] ?? '' })));
}
