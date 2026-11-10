#!/usr/bin/env node
// Enforce the package graph and public source boundaries from literal AST imports.
// Platform-neutral packages reject Node imports; explicit adapter entry points own
// runtime-specific dependencies. Dynamic computed module names remain host review scope.
// The manifest-level twin is tests/dependency-rules.test.mjs; both use dependency-graph.mjs.
// Test arguments: repository root and an optional graph JSON file.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { builtinModules } from 'node:module';
import { architectureSource } from './architecture-source.mjs';
import {
  ACCOUNT_PORTS,
  ALLOWED,
  COMPOSITION_ROOTS,
  MIDNIGHT_ENTRY_POINTS,
  SCOPE,
} from './dependency-graph.mjs';

const [root = '.', graphFile] = process.argv.slice(2);
/** @type {Record<string, string[]>} */
const graph = graphFile ? JSON.parse(readFileSync(graphFile, 'utf8')) : ALLOWED;

const TESTING_DIR = 'packages/account/src/testing/';
const PLATFORM_NEUTRAL = new Set(['protocol', 'contract', 'core', 'connect', 'account', 'keys']);
const BUILTINS = new Set(builtinModules.map((name) => name.replace(/^node:/, '')));
const ALLOWED_GLOBALS = new Set(['crypto']);

/** @param {string} dir @returns {string[]} */
function sourceFiles(dir) {
  /** @type {string[]} */
  const out = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...sourceFiles(path));
    else if (/\.(ts|mts|cts|js|mjs|cjs)$/.test(entry)) out.push(path);
  }
  return out;
}

/** @param {string} file @param {string} pkg @param {string} spec */
function crossesSourceBoundary(file, pkg, spec) {
  if (isAbsolute(spec) || spec.startsWith('file:')) return true;
  if (!spec.startsWith('.')) return false;
  const target = relative(resolve(root, 'packages', pkg), resolve(dirname(file), spec));
  return target === '..' || target.startsWith(`..${sep}`) || isAbsolute(target);
}

/** @type {string[]} */
const violations = [];
for (const [pkg, allowed] of Object.entries(graph)) {
  const allowedNames = new Set(allowed.map((name) => SCOPE + name));
  let files;
  try {
    files = sourceFiles(join(root, 'packages', pkg, 'src'));
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') continue;
    throw error;
  }
  for (const file of files) {
    const source = architectureSource(readFileSync(file, 'utf8'), file);
    const path = relative(root, file).split(sep).join('/');
    for (const { specifier: spec, runtimeStatic } of source.imports) {
      if (crossesSourceBoundary(file, pkg, spec))
        violations.push(`${file}: "${pkg}" must use a public package import instead of "${spec}".`);
      if (spec.startsWith(SCOPE)) {
        const target = spec.slice(SCOPE.length).split('/')[0];
        if (!allowedNames.has(SCOPE + target))
          violations.push(
            `${file}: "${pkg}" must not import "${SCOPE + target}" (architecture §4.4).`,
          );
        else if (
          pkg.startsWith('adapter-') &&
          target === 'account' &&
          spec !== SCOPE + ACCOUNT_PORTS &&
          !(
            ['adapter-webauthn', 'adapter-service', 'adapter-midnight-js'].includes(pkg) &&
            spec === SCOPE + 'account/errors'
          ) &&
          !COMPOSITION_ROOTS.includes(pkg)
        )
          violations.push(
            `${file}: "${pkg}" must import "${SCOPE}${ACCOUNT_PORTS}" (design §1.2).`,
          );
      }
      if (
        runtimeStatic &&
        /^@(?:midnight-ntwrk|midnightntwrk)\//.test(spec) &&
        !MIDNIGHT_ENTRY_POINTS.some((entry) => path.startsWith(entry))
      )
        violations.push(`${file}: "${pkg}" must reach "${spec}" through import() (D-6).`);
      if (
        path.startsWith(TESTING_DIR) &&
        !(/^\.\/[^/]+$/.test(spec) || spec.startsWith('../ports/') || spec === `${SCOPE}protocol`)
      )
        violations.push(
          `${file}: account's ./testing imports only ./ports and protocol, not "${spec}" (design §1.1).`,
        );
      if (PLATFORM_NEUTRAL.has(pkg) && (spec.startsWith('node:') || BUILTINS.has(spec)))
        violations.push(
          `${file}: "${pkg}" must not import "${spec}" — it ships to browser/PWA bundles (architecture §4.4).`,
        );
    }
    if (PLATFORM_NEUTRAL.has(pkg))
      for (const name of source.globals)
        if (!ALLOWED_GLOBALS.has(name))
          violations.push(
            `${file}: "${pkg}" declares ambient global "${name}" — only allowlisted cross-platform globals are permitted (architecture §4.4).`,
          );
  }
}
if (violations.length) {
  for (const violation of violations) console.error(`Boundary violation — ${violation}`);
  process.exitCode = 1;
} else console.log('Dependency boundaries respected (architecture §4.4, design §1.2).');
