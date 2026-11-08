#!/usr/bin/env node
// All executable authored sources in the nine published packages. Outside fast required CI.
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { releasePackageDirectories } from './release-package-list.mjs';
import { generatedSources, testHelperDirectory } from './source-policy.mjs';
import { publishedSources } from './package-inventory.mjs';
import {
  coverageFailures,
  coverageThresholds,
  coverageInventoryFailures,
} from './coverage-policy.mjs';

/** @param {string} lcov */
export function summarizeLcov(lcov) {
  /** @type {{file: string; lines: {hit:number,total:number}; functions: {hit:number,total:number}; branches: {hit:number,total:number}}[]} */
  const files = [];
  let current = /** @type {(typeof files)[number] | undefined} */ (undefined);
  const metric = {
    LF: ['lines', 'total'],
    LH: ['lines', 'hit'],
    FNF: ['functions', 'total'],
    FNH: ['functions', 'hit'],
    BRF: ['branches', 'total'],
    BRH: ['branches', 'hit'],
  };
  for (const line of lcov.split(/\r?\n/)) {
    if (line.startsWith('SF:')) {
      if (current) throw new Error('Unterminated coverage record.');
      current = {
        file: relative(process.cwd(), resolve(line.slice(3))),
        lines: { hit: 0, total: 0 },
        functions: { hit: 0, total: 0 },
        branches: { hit: 0, total: 0 },
      };
    } else if (line === 'end_of_record') {
      if (!current) throw new Error('Coverage record has no source.');
      for (const name of ['lines', 'functions', 'branches']) {
        const count = current[/** @type {'lines'|'functions'|'branches'} */ (name)];
        if (count.hit > count.total) throw new Error('Invalid coverage counts.');
      }
      files.push(current);
      current = undefined;
    } else {
      const [tag, raw] = line.split(':');
      const mapping = metric[/** @type {keyof typeof metric} */ (tag)];
      if (mapping) {
        const value = Number(raw);
        if (!current || !/^\d+$/.test(raw ?? '') || !Number.isSafeInteger(value))
          throw new Error('Invalid coverage counter.');
        const [name, field] = mapping;
        current[/** @type {'lines'|'functions'|'branches'} */ (name)][
          /** @type {'hit'|'total'} */ (field)
        ] = value;
      }
    }
  }
  if (current || files.length === 0) throw new Error('Missing or incomplete coverage.');
  const total = {
    lines: { hit: 0, total: 0 },
    functions: { hit: 0, total: 0 },
    branches: { hit: 0, total: 0 },
  };
  for (const file of files)
    for (const name of /** @type {const} */ (['lines', 'functions', 'branches'])) {
      total[name].hit += file[name].hit;
      total[name].total += file[name].total;
    }
  const percent = (/** @type {{ hit:number; total:number }} */ count) =>
    count.total ? Math.round((count.hit / count.total) * 10000) / 100 : null;
  return {
    files,
    total,
    percent: {
      lines: percent(total.lines),
      functions: percent(total.functions),
      branches: percent(total.branches),
    },
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.env.IN_NIX_SHELL) throw new Error('Run coverage through nix develop.');
  const output = resolve(process.argv[2] ?? `review/coverage-${Date.now()}`);
  mkdirSync(dirname(output), { recursive: true });
  mkdirSync(output); // Fresh path only: preserve earlier measurements and failures.
  const inventory = publishedSources();
  const args = [
    'exec',
    'c8',
    '--all',
    '--src=packages',
    '--include=packages/*/src/**/*.ts',
    ...generatedSources.map((file) => `--exclude=${file}`),
    `--exclude=${testHelperDirectory}/**`,
    '--exclude-after-remap',
    '--reporter=json-summary',
    '--reporter=lcov',
    `--reports-dir=${output}`,
  ];
  const included = new Set(inventory.map((file) => file.package));
  for (const pkg of [
    'core',
    'connect',
    'adapter-signer-local',
    'adapter-signer-managed',
    'adapter-prover-remote',
  ]) {
    if (!included.has(pkg)) args.push(`--exclude=packages/${pkg}/**`);
  }
  for (const file of inventory) if (!file.executable) args.push(`--exclude=${file.source}`);
  args.push(process.execPath, '--test', 'tests/**/*.test.mjs');
  const result = spawnSync('pnpm', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  writeFileSync(resolve(output, 'tests.tap'), result.stdout ?? '', { flag: 'wx' });
  writeFileSync(resolve(output, 'stderr.log'), result.stderr ?? '', { flag: 'wx' });
  if (result.error) throw result.error;
  const summary = summarizeLcov(readFileSync(resolve(output, 'lcov.info'), 'utf8'));
  const raw = JSON.parse(readFileSync(resolve(output, 'coverage-summary.json'), 'utf8'));
  const measured = new Set(
    Object.keys(raw)
      .filter((name) => name !== 'total')
      .map((name) => relative(process.cwd(), name)),
  );
  const failures = [
    ...coverageFailures(raw.total),
    ...coverageInventoryFailures(inventory, measured, releasePackageDirectories),
  ];
  /** @type {Record<string, unknown>} */
  const packages = {};
  for (const pkg of included) {
    const counters = {
      lines: { covered: 0, total: 0 },
      functions: { covered: 0, total: 0 },
      branches: { covered: 0, total: 0 },
    };
    for (const file of inventory.filter((entry) => entry.package === pkg && entry.executable)) {
      const entry = raw[resolve(file.source)];
      if (!entry) continue;
      for (const metric of /** @type {const} */ (['lines', 'functions', 'branches'])) {
        counters[metric].covered += entry[metric].covered;
        counters[metric].total += entry[metric].total;
      }
    }
    const rejected = coverageFailures(counters);
    failures.push(...rejected.map((reason) => `${pkg}: ${reason}`));
    packages[pkg] = counters;
  }
  const tap = readFileSync(resolve(output, 'tests.tap'), 'utf8');
  const count = (/** @type {string} */ name) =>
    Number(tap.match(new RegExp(`^# ${name} (\\d+)$`, 'm'))?.[1] ?? 0);
  const source = spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' });
  const dirty = spawnSync('git', ['status', '--porcelain'], { encoding: 'utf8' });
  const receipt = {
    schemaVersion: 2,
    outcome: result.status === 0 && failures.length === 0 ? 'passed' : 'failed',
    sourceCommit: source.stdout.trim(),
    dirty: dirty.stdout.length > 0,
    node: process.version,
    tests: { passed: count('pass'), failed: count('fail'), skipped: count('skipped') },
    scope:
      'All executable authored TypeScript in nine published packages, including unimported files; excludes generated metadata, type-only stubs, testing helpers and private legacy scaffolds. Not app, native or provider coverage.',
    thresholds: coverageThresholds,
    exclusions: {
      generated: generatedSources,
      helpers: 'packages/account/src/testing/**',
      privateScaffolds: [
        'core',
        'connect',
        'adapter-signer-local',
        'adapter-signer-managed',
        'adapter-prover-remote',
      ],
      typeOnly: inventory.filter((file) => !file.executable).map((file) => file.source),
    },
    failures,
    inventory,
    packages,
    ...summary,
  };
  writeFileSync(resolve(output, 'summary.json'), JSON.stringify(receipt, null, 2) + '\n', {
    flag: 'wx',
  });
  console.log(JSON.stringify({ output, ...receipt, files: summary.files.length }, null, 2));
  process.exitCode = result.status === 0 && failures.length === 0 ? 0 : 1;
}
