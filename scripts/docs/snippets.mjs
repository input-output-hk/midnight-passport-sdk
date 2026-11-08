/** Compile documentation verbatim; this never executes a snippet or starts a host. */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import ts from 'typescript';

/** @typedef {'neutral' | 'web' | 'worker' | 'node'} Target */
/** @typedef {{path:string, code:string, line:number, target:Target}} Example */

/** Extract only top-level fenced TypeScript, with its original first source line.
 * @param {string} text
 */
export function typeScriptFences(text) {
  /** @type {{index:number,code:string,line:number}[]} */
  const examples = [];
  /** @type {{marker:string,length:number,language:string,line:number,body:string[]} | undefined} */
  let open;
  const lines = text.split(/\r?\n/);
  for (const [index, line] of lines.entries()) {
    if (open) {
      if (new RegExp(`^ {0,3}${open.marker}{${open.length},}\\s*$`).test(line)) {
        if (['ts', 'typescript'].includes(open.language))
          examples.push({ index: examples.length + 1, code: open.body.join('\n'), line: open.line });
        open = undefined;
      } else open.body.push(line);
      continue;
    }
    const match = /^ {0,3}(`{3,}|~{3,})([^\r\n]*)$/.exec(line);
    if (!match?.[1]) continue;
    const language = (match[2] ?? '').trim().split(/\s+/)[0] ?? '';
    open = { marker: match[1][0] ?? '`', length: match[1].length, language, line: index + 2, body: [] };
  }
  if (open) throw new Error(`Unclosed documentation fence at line ${open.line - 1}`);
  return examples;
}

/** @param {unknown} value @returns {value is Record<string, unknown>} */
const object = (value) => !!value && typeof value === 'object' && !Array.isArray(value);
/** @param {unknown} value @returns {value is Target} */
const target = (value) => ['neutral', 'web', 'worker', 'node'].some((name) => name === value);

/** Source-only aliases are derived from actual public exports, never private paths.
 * @param {string} root
 */
export function sourceExportPaths(root) {
  /** @type {Record<string,string[]>} */
  const paths = {};
  for (const directory of readdirSync(join(root, 'packages'))) {
    const folder = join(root, 'packages', directory);
    const manifest = JSON.parse(readFileSync(join(folder, 'package.json'), 'utf8'));
    if (manifest.private || typeof manifest.name !== 'string' || !object(manifest.exports)) continue;
    for (const [subpath, entry] of Object.entries(manifest.exports)) {
      if (!object(entry) || typeof entry.types !== 'string') continue;
      const declaration = entry.types;
      const source = declaration.startsWith('./dist/')
        ? declaration.replace('./dist/', './src/').replace(/\.d\.ts$/, '.ts')
        : declaration;
      const file = resolve(folder, source);
      if (!statSync(file).isFile()) throw new Error(`Missing public source declaration: ${file}`);
      paths[manifest.name + (subpath === '.' ? '' : subpath.slice(1))] = [file];
    }
  }
  return paths;
}

/** Admit a checked-document inventory. Every TypeScript fence in each listed page
 * must be compiled, or explicitly identified as a fragment with a public reason.
 * @param {string} root @param {unknown} manifest
 * @returns {{examples:Example[],fragments:{path:string,fence:number,reason:string}[]}}
 */
export function documentationExamples(root, manifest) {
  if (!object(manifest) || manifest.version !== 1 || !Array.isArray(manifest.pages))
    throw new Error('Invalid documentation example manifest');
  /** @type {Example[]} */ const examples = [];
  /** @type {{path:string,fence:number,reason:string}[]} */ const fragments = [];
  const pages = new Set();
  for (const page of manifest.pages) {
    if (!object(page) || typeof page.path !== 'string' || !Array.isArray(page.fences))
      throw new Error('Invalid documentation page');
    if (!/^docs\/site\/(?:[a-z0-9-]+\/)*[a-z0-9-]+\.md$/.test(page.path) || pages.has(page.path))
      throw new Error('Unsafe or duplicate documentation page');
    pages.add(page.path);
    const fences = typeScriptFences(readFileSync(join(root, page.path), 'utf8'));
    if (fences.length !== page.fences.length) throw new Error(`Unaccounted example in ${page.path}`);
    for (const [index, policy] of page.fences.entries()) {
      const fence = fences[index];
      if (!fence || !object(policy)) throw new Error('Invalid documentation fence policy');
      if (typeof policy.fragment === 'string' && policy.fragment.trim().length >= 20 && !policy.targets) {
        fragments.push({ path: page.path, fence: fence.index, reason: policy.fragment });
        continue;
      }
      if (!Array.isArray(policy.targets) || !policy.targets.length || policy.fragment)
        throw new Error(`Missing compilation target for ${page.path} fence ${fence.index}`);
      const unique = new Set();
      for (const value of policy.targets) {
        if (!target(value) || unique.has(value)) throw new Error('Invalid or duplicate example target');
        unique.add(value);
        examples.push({
          path: page.path.replace(/\.md$/, `.example-${fence.index}.mts`),
          code: fence.code,
          line: fence.line,
          target: value,
        });
      }
    }
  }
  if (manifest.files !== undefined && !Array.isArray(manifest.files))
    throw new Error('Invalid documentation module inventory');
  for (const file of manifest.files ?? []) {
    if (
      !object(file) ||
      typeof file.path !== 'string' ||
      !/^docs\/examples\/(?:[a-z0-9-]+\/)*[a-z0-9-]+\.ts$/.test(file.path) ||
      pages.has(file.path) ||
      !Array.isArray(file.targets) ||
      !file.targets.length
    ) throw new Error('Invalid or duplicate documentation module');
    pages.add(file.path);
    const unique = new Set();
    for (const value of file.targets) {
      if (!target(value) || unique.has(value)) throw new Error('Invalid or duplicate module target');
      unique.add(value);
      examples.push({ path: file.path, code: readFileSync(join(root, file.path), 'utf8'), line: 1, target: value });
    }
  }
  return { examples, fragments };
}

/** @param {Target} target @param {Record<string,string[]>} paths */
function compilerOptions(target, paths) {
  const libs = {
    neutral: ['lib.es2022.d.ts'],
    web: ['lib.es2022.d.ts', 'lib.dom.d.ts', 'lib.dom.iterable.d.ts'],
    worker: ['lib.es2022.d.ts', 'lib.webworker.d.ts'],
    node: ['lib.es2022.d.ts'],
  };
  return /** @satisfies {import('typescript').CompilerOptions} */ ({
    target: ts.ScriptTarget.ES2022,
    module: target === 'node' ? ts.ModuleKind.NodeNext : ts.ModuleKind.ESNext,
    moduleResolution: target === 'node' ? ts.ModuleResolutionKind.NodeNext : ts.ModuleResolutionKind.Bundler,
    strict: true,
    noUncheckedIndexedAccess: true,
    exactOptionalPropertyTypes: true,
    noImplicitOverride: true,
    isolatedModules: true,
    verbatimModuleSyntax: true,
    noUnusedLocals: true,
    noUnusedParameters: true,
    noEmit: true,
    skipLibCheck: true,
    types: target === 'node' ? ['node'] : [],
    lib: libs[target],
    paths,
  });
}

/** Reject hidden host declarations and nonpublic source shortcuts before typechecking.
 * @param {string} root @param {Example} example @param {Record<string,string[]>} paths
 */
function exampleContracts(root, example, paths) {
  const file = ts.createSourceFile(example.path, example.code, ts.ScriptTarget.ES2022, true);
  /** @type {string[]} */ const diagnostics = [];
  if (file.referencedFiles.length || file.typeReferenceDirectives.length || file.libReferenceDirectives.length || file.hasNoDefaultLib)
    diagnostics.push(`${example.path}: DOC Reference directives cannot change the declared example target.`);
  /** @param {import('typescript').Node} node @param {string} message */
  const report = (node, message) => {
    const position = file.getLineAndCharacterOfPosition(node.getStart(file));
    diagnostics.push(`${example.path}:${example.line + position.line}: DOC ${message}`);
  };
  /** @param {string} specifier @param {import('typescript').Node} node */
  const imported = (specifier, node) => {
    if (specifier.startsWith('@input-output-hk/mn-passport-') && !Object.hasOwn(paths, specifier))
      report(node, 'Import must name an actual public source export.');
    if (specifier.startsWith('node:') && example.target !== 'node')
      report(node, 'Node modules require a Node example target.');
    if (specifier.startsWith('.') || specifier.startsWith('/')) {
      const destination = resolve(root, dirname(example.path), specifier);
      if (!destination.startsWith(resolve(root, 'docs/examples') + '/') || !/\.(?:ts|js)$/.test(destination))
        report(node, 'Relative imports may reference documentation examples, not package internals.');
    }
  };
  /** @param {import('typescript').Node} node */
  const visit = (node) => {
    if (node.kind === ts.SyntaxKind.DeclareKeyword)
      report(node, 'Pass host capabilities as parameters; ambient declarations are not complete examples.');
    if (ts.isImportEqualsDeclaration(node) || (ts.isCallExpression(node) &&
      ((ts.isIdentifier(node.expression) && node.expression.text === 'require') ||
       (ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'require'))))
      report(node, 'Use ESM public imports, not require or import-equals shortcuts.');
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier))
      imported(node.moduleSpecifier.text, node);
    if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal))
      imported(node.argument.literal.text, node);
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const value = node.arguments[0];
      if (!value || !ts.isStringLiteral(value)) report(node, 'Dynamic documentation imports must use a literal module path.');
      else imported(value.text, node);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  const scanner = ts.createScanner(ts.ScriptTarget.ES2022, false, ts.LanguageVariant.Standard, example.code);
  for (let token = scanner.scan(); token !== ts.SyntaxKind.EndOfFileToken; token = scanner.scan()) {
    if ((token === ts.SyntaxKind.SingleLineCommentTrivia || token === ts.SyntaxKind.MultiLineCommentTrivia) && /@ts-(?:ignore|nocheck)/.test(scanner.getTokenText()))
      diagnostics.push(`${example.path}: DOC TypeScript suppression cannot hide a broken documentation example.`);
  }
  return diagnostics;
}

/** Typecheck all admitted snippets in separate ambient target programs. Virtual
 * filenames preserve the page directory so relative imports keep their meaning.
 * @param {string} root @param {Example[]} examples
 */
export function checkDocumentationTypes(root, examples) {
  const paths = sourceExportPaths(root);
  /** @type {{target:Target,examples:number,diagnostics:string[]}[]} */ const results = [];
  for (const lane of /** @type {const} */ (['neutral', 'web', 'worker', 'node'])) {
    const inputs = examples.filter((example) => example.target === lane);
    if (!inputs.length) continue;
    const virtual = new Map(inputs.map((example) => [resolve(root, example.path), example]));
    const options = compilerOptions(lane, paths);
    const host = ts.createCompilerHost(options);
    const read = host.readFile.bind(host), exists = host.fileExists.bind(host);
    host.readFile = (path) => virtual.get(resolve(path))?.code ?? read(path);
    host.fileExists = (path) => virtual.has(resolve(path)) || exists(path);
    const program = ts.createProgram([...virtual.keys()], options, host);
    const diagnostics = ts.getPreEmitDiagnostics(program).map((diagnostic) => {
      const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n');
      if (!diagnostic.file) return `TS${diagnostic.code}: ${message}`;
      const file = diagnostic.file.fileName;
      const position = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start ?? 0);
      const example = virtual.get(resolve(file));
      const path = relative(root, file).replace(/\.example-\d+\.mts$/, '.md');
      return `${path}:${position.line + (example?.line ?? 1)}:${position.character + 1} TS${diagnostic.code}: ${message}`;
    });
    diagnostics.push(...inputs.flatMap((example) => exampleContracts(root, example, paths)));
    results.push({ target: lane, examples: inputs.length, diagnostics });
  }
  return results;
}

/** Newly added TypeScript examples must not silently escape the check inventory.
 * @param {string} root @param {ReturnType<typeof documentationExamples>} admitted
 */
export function assertDocumentationInventory(root, admitted) {
  const paths = new Set([
    ...admitted.examples.map((example) => example.path.replace(/\.example-\d+\.mts$/, '.md')),
    ...admitted.fragments.map((fragment) => fragment.path),
  ]);
  /** @param {string} directory @param {'.md' | '.ts'} extension */
  const walk = (directory, extension) => {
    for (const entry of readdirSync(join(root, directory), { withFileTypes: true })) {
      const path = `${directory}/${entry.name}`;
      if (entry.isSymbolicLink()) throw new Error(`Documentation inventory does not follow links: ${path}`);
      if (entry.isDirectory()) walk(path, extension);
      else if (entry.name.endsWith(extension) && (extension === '.ts' || typeScriptFences(readFileSync(join(root, path), 'utf8')).length) && !paths.has(path))
        throw new Error(`TypeScript documentation ${extension === '.md' ? 'page' : 'module'} is not checked: ${path}`);
    }
  };
  walk('docs/site', '.md');
  walk('docs/examples', '.ts');
}

/** @param {string} root */
export function checkDocumentation(root) {
  const manifest = JSON.parse(readFileSync(join(root, 'docs/examples/checked-snippets.json'), 'utf8'));
  const admitted = documentationExamples(root, manifest);
  assertDocumentationInventory(root, admitted);
  const results = checkDocumentationTypes(root, admitted.examples);
  return {
    scope: 'strict source-preview documentation types; no example execution',
    typescript: ts.version,
    examples: admitted.examples.map(({ path, code, line, target }) => ({
      path, line, target, sha256: createHash('sha256').update(code).digest('hex'),
    })),
    results,
    fragments: admitted.fragments,
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.slice(2).some((argument) => argument !== '--json'))
    throw new Error('Usage: node scripts/docs/snippets.mjs [--json]');
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
  const result = checkDocumentation(root);
  if (process.argv.includes('--json')) console.log(JSON.stringify(result, null, 2));
  else {
    for (const lane of result.results) {
      console.log(`Docs ${lane.target}: ${lane.examples} examples, ${lane.diagnostics.length} diagnostics`);
      for (const diagnostic of lane.diagnostics) console.error(diagnostic);
    }
    console.log(`Docs: ${new Set(result.examples.map((example) => example.path)).size} complete examples; ${result.fragments.length} declared fragments`);
  }
  if (result.results.some((lane) => lane.diagnostics.length)) process.exitCode = 1;
}
