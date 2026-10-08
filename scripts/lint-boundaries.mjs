#!/usr/bin/env node
// Import-level dependency-boundary lint (FS-0.1 D-3; architecture §4.4).
// Every workspace package may import only the @midnight-ntwrk/mn-passport-*
// packages the architecture permits — most critically, `connect` must never
// import `core` or any adapter, so a dApp can never pull the kernel into its
// bundle. Also enforces platform neutrality at the import level: the four
// packages that reach browser/PWA bundles (`protocol`, `contract`, `core`,
// and `connect` — architecture §4.4) must not import Node built-ins; only
// adapters may be platform-specific. The manifest-level twin lives in
// tests/dependency-rules.test.mjs; both consume scripts/dependency-graph.mjs.
// Design §1.2: an adapter imports `account/ports`, never the account root, and
// only the Midnight entry points import a Midnight package statically (D-6).
// Arguments, for tests: a repository root, and a JSON file of the graph.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
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

// Matches static imports, re-exports, side-effect imports, require(), and
// dynamic import() — with ', ", or ` around the specifier.
const IMPORT_RE =
  /(?:\bfrom|\bimport|\brequire)\s*\(?\s*['"`](@midnight-ntwrk\/mn-passport-[^'"`/]+)(\/[^'"`]*)?/g;
// A statement that survives compilation: not `import type`, not `import()`.
const STATIC_MIDNIGHT_RE =
  /^\s*(?:import|export)\s+(?!type\s)(?:[^'"`;]*?\sfrom\s*)?['"]((?:@midnight-ntwrk\/(?!mn-passport-)|@midnightntwrk\/)[^'"]+)['"]/gm;
const NODE_BUILTIN_RE = /(?:\bfrom|\bimport|\brequire)\s*\(?\s*['"`](node:[^'"`]+)/g;
const PLATFORM_NEUTRAL = new Set(['protocol', 'contract', 'core', 'connect', 'account']);
// Ambient global declarations bypass import scanning, so they are gated by
// an explicit allowlist: only cross-platform standards may be assumed.
const GLOBAL_DECLARATION_RE = /declare\s+(?:const|var|let|function)\s+(\w+)/g;
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

/** @type {string[]} */
const violations = [];
for (const [pkg, allowed] of Object.entries(graph)) {
  const allowedNames = new Set(allowed.map((d) => SCOPE + d));
  let files;
  try {
    files = sourceFiles(join(root, 'packages', pkg, 'src'));
  } catch {
    continue; // The package is not scaffolded yet — nothing to lint.
  }
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    for (const match of text.matchAll(IMPORT_RE)) {
      const target = match[1] ?? '';
      const spec = target.slice(SCOPE.length) + (match[2] ?? '');
      if (!allowedNames.has(target)) {
        violations.push(`${file}: "${pkg}" must not import "${target}" (architecture §4.4).`);
      } else if (
        pkg.startsWith('adapter-') &&
        target === `${SCOPE}account` &&
        spec !== ACCOUNT_PORTS &&
        !COMPOSITION_ROOTS.includes(pkg)
      ) {
        violations.push(`${file}: "${pkg}" must import "${SCOPE}${ACCOUNT_PORTS}" (design §1.2).`);
      }
    }
    const path = relative(root, file).split(sep).join('/');
    if (!MIDNIGHT_ENTRY_POINTS.some((entry) => path.startsWith(entry))) {
      for (const match of text.matchAll(STATIC_MIDNIGHT_RE)) {
        violations.push(`${file}: "${pkg}" must reach "${match[1]}" through import() (D-6).`);
      }
    }
    if (PLATFORM_NEUTRAL.has(pkg)) {
      for (const match of text.matchAll(NODE_BUILTIN_RE)) {
        violations.push(
          `${file}: "${pkg}" must not import "${match[1]}" — it ships to browser/PWA bundles (architecture §4.4).`,
        );
      }
      for (const match of text.matchAll(GLOBAL_DECLARATION_RE)) {
        const name = match[1] ?? '';
        if (!ALLOWED_GLOBALS.has(name)) {
          violations.push(
            `${file}: "${pkg}" declares ambient global "${name}" — only allowlisted cross-platform globals are permitted (architecture §4.4).`,
          );
        }
      }
    }
  }
}

if (violations.length > 0) {
  for (const v of violations) console.error(`Boundary violation — ${v}`);
  process.exit(1);
}
console.log('Dependency boundaries respected (architecture §4.4, design §1.2).');
