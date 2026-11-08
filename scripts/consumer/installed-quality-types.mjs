// Compile existing fixture/document text through the audited installed package graph.
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import ts from 'typescript';
import { assertDocumentationInventory, documentationExamples } from '../docs/snippets.mjs';
import {
  qualityNodeTypes,
  qualityWebTypes,
  qualityWorkerTypes,
  qualityConfigTypes,
} from './quality-contracts.mjs';
import {
  assertInstalledSdkResolution,
  inside,
  qualityHash,
  readJson,
  sdkPrefix,
} from './installed-quality-inputs.mjs';

/** @typedef {'neutral'|'node'|'web'|'worker'} Target */
/** @typedef {{path:string,code:string}} Source */
/** @typedef {import('./installed-quality-inputs.mjs').InstalledQualityContext} Context */
/** @typedef {{path:string,sha256:string}} CompilerInput */

/** @param {Target} target @param {boolean} documentation @param {string} repository */
function compilerOptions(target, documentation, repository) {
  const libs = {
    neutral: ['lib.es2022.d.ts'],
    node: ['lib.es2022.d.ts'],
    web: ['lib.es2022.d.ts', 'lib.dom.d.ts', 'lib.dom.iterable.d.ts'],
    worker: ['lib.es2022.d.ts', 'lib.webworker.d.ts'],
  };
  return /** @satisfies {import('typescript').CompilerOptions} */ ({
    target: ts.ScriptTarget.ES2022,
    module: target === 'node' ? ts.ModuleKind.NodeNext : ts.ModuleKind.ESNext,
    moduleResolution:
      target === 'node' ? ts.ModuleResolutionKind.NodeNext : ts.ModuleResolutionKind.Bundler,
    strict: true,
    noUncheckedIndexedAccess: true,
    exactOptionalPropertyTypes: true,
    noUnusedLocals: true,
    noUnusedParameters: true,
    noImplicitOverride: true,
    isolatedModules: true,
    verbatimModuleSyntax: true,
    noEmit: true,
    skipLibCheck: documentation,
    types: documentation && target === 'node' ? ['node'] : [],
    typeRoots: documentation && target === 'node' ? [join(repository, 'node_modules/@types')] : [],
    lib: libs[target],
  });
}

/** Only the pinned compiler libraries and explicit Node type tools may live outside consumer.
 * @param {Context} context @param {boolean} nodeTypes
 */
function outsideTypeRoots(context, nodeTypes) {
  const require = createRequire(import.meta.url);
  const roots = [dirname(require.resolve('typescript'))];
  if (nodeTypes) {
    const types = realpathSync(join(context.repository, 'node_modules/@types/node'));
    roots.push(types);
    const fromTypes = createRequire(join(types, 'package.json'));
    roots.push(dirname(fromTypes.resolve('undici-types/package.json')));
  }
  return roots;
}

/** Compiler options are closed here: no source aliases, tsconfig discovery or injected paths.
 * @param {Context} context @param {string} directory
 * @param {{target:Target,documentation:boolean,sources:Source[],entries?:string[]}} fixture
 */
export function compileInstalledProgram(context, directory, fixture) {
  if (!inside(context.consumer, resolve(directory)))
    throw Error('compile output must be in consumer');
  mkdirSync(directory, { recursive: true });
  const names = new Set();
  for (const source of fixture.sources) {
    if (
      isAbsolute(source.path) ||
      source.path.split(/[\\/]/).some((part) => part === '..') ||
      names.has(source.path)
    )
      throw Error('unsafe or duplicate installed compile input');
    names.add(source.path);
    const file = join(directory, source.path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, source.code, { flag: 'wx', mode: 0o600 });
  }
  const entries = fixture.entries ?? [...names];
  if (!entries.length || entries.some((entry) => !names.has(entry)))
    throw Error('installed compile case needs admitted entries');
  const options = compilerOptions(fixture.target, fixture.documentation, context.repository);
  const typeTools = outsideTypeRoots(context, fixture.documentation && fixture.target === 'node');
  const host = ts.createCompilerHost(options),
    read = host.readFile.bind(host);
  /** @type {Map<string,CompilerInput>} */ const inputs = new Map();
  host.readFile = (file) => {
    const text = read(file);
    if (text === undefined) return text;
    const path = realpathSync(file);
    if (
      /\.(?:[cm]?ts|tsx)$/.test(path) &&
      !inside(context.consumer, path) &&
      !typeTools.some((root) => inside(root, path))
    )
      throw Error('compiler input escapes installed consumer and pinned type tools');
    if (inside(join(context.repository, 'packages'), path))
      throw Error('compiler reached SDK workspace source or output');
    const previous = inputs.get(path),
      sha256 = qualityHash(readFileSync(path));
    if (previous && previous.sha256 !== sha256) throw Error('compiler input changed while reading');
    inputs.set(path, { path, sha256 });
    return text;
  };
  const program = ts.createProgram(
    entries.map((entry) => join(directory, entry)),
    options,
    host,
  );
  const diagnostics = ts.getPreEmitDiagnostics(program);
  const formatted = ts.formatDiagnostics(diagnostics, {
    getCanonicalFileName: (file) => file,
    getCurrentDirectory: () => directory,
    getNewLine: () => '\n',
  });
  writeFileSync(join(directory, 'diagnostics.log'), formatted, { flag: 'wx', mode: 0o600 });
  if (diagnostics.length)
    throw Error(`installed ${fixture.target} compile failed; inspect diagnostics.log`);
  let sdkResolutions = 0;
  for (const source of program.getSourceFiles()) {
    for (const dependency of ts.preProcessFile(source.text).importedFiles) {
      if (!dependency.fileName.startsWith(sdkPrefix)) continue;
      const resolved = ts.resolveModuleName(
        dependency.fileName,
        source.fileName,
        options,
        ts.sys,
      ).resolvedModule;
      if (!resolved) throw Error('installed SDK type import did not resolve');
      assertInstalledSdkResolution(context.roots, dependency.fileName, resolved.resolvedFileName);
      sdkResolutions++;
    }
  }
  return {
    target: fixture.target,
    documentation: fixture.documentation,
    skipLibCheck: options.skipLibCheck,
    entries: entries.length,
    sdkResolutions,
    inputs: [...inputs.values()].sort((a, b) => a.path.localeCompare(b.path)),
  };
}

/** Keep the exact extracted public text and the existing documented target policy.
 * @param {Context} context @param {string} output
 */
export function compileInstalledDocumentation(context, output) {
  const manifest = readJson(join(context.repository, 'docs/examples/checked-snippets.json'));
  const admitted = documentationExamples(context.repository, manifest);
  assertDocumentationInventory(context.repository, admitted);
  const modules = new Map(
    admitted.examples
      .filter((entry) => entry.path.endsWith('.ts'))
      .map((entry) => [entry.path, entry.code]),
  );
  const docs = [];
  for (const target of /** @type {const} */ (['neutral', 'node', 'web', 'worker'])) {
    const examples = admitted.examples.filter((entry) => entry.target === target);
    if (!examples.length) continue;
    const sources = new Map(modules);
    for (const entry of examples) sources.set(entry.path, entry.code);
    docs.push(
      compileInstalledProgram(context, join(output, 'docs-' + target), {
        target,
        documentation: true,
        sources: [...sources].map(([path, code]) => ({ path, code })),
        entries: examples.map((entry) => entry.path),
      }),
    );
  }
  return {
    docs,
    examples: admitted.examples.map(({ path, line, target, code }) => ({
      path,
      line,
      target,
      sha256: qualityHash(code),
    })),
    fragments: admitted.fragments,
  };
}

/** @param {Context} context @param {string} output */
export function compileInstalledQuality(context, output) {
  const quality = [
    { target: /** @type {const} */ ('node'), code: qualityNodeTypes + qualityConfigTypes },
    { target: /** @type {const} */ ('web'), code: qualityWebTypes + qualityConfigTypes },
    { target: /** @type {const} */ ('worker'), code: qualityWorkerTypes + qualityConfigTypes },
  ].map(({ target, code }) =>
    compileInstalledProgram(context, join(output, 'quality-' + target), {
      target,
      documentation: false,
      sources: [{ path: 'quality.mts', code }],
    }),
  );
  return { quality, ...compileInstalledDocumentation(context, output) };
}

/** @param {readonly CompilerInput[]} inputs */
export function verifyCompilerInputs(inputs) {
  for (const input of inputs)
    if (qualityHash(readFileSync(input.path)) !== input.sha256)
      throw Error('compiler input bytes changed during installed quality checks');
}
