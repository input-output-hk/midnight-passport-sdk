#!/usr/bin/env node
// Detect separate class/context identities before a consumer starts an ACC deployment.
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { readFileSync, realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const identityPackages = new Map([
  ['@midnight-ntwrk/compact-js', '3.0.0-rc.3'],
  ['@midnight-ntwrk/compact-runtime', '0.20.0'],
  ['@midnightntwrk/ledger-v9', '1.0.0-rc.5'],
]);

/**
 * Follow declared Midnight dependencies from installed consumer entry packages. The Ledger 8
 * runtime uses an explicit alias and is deliberately outside this Ledger 9 identity check.
 * @param {string} consumer
 * @param {string[]} entries
 */
export function checkMidnightRuntimeIdentity(consumer, entries) {
  const pending = entries.map((name) => ({ name, from: join(resolve(consumer), 'package.json') }));
  const seen = new Set();
  /** @type {Map<string, Map<string, string[]>>} */
  const copies = new Map([...identityPackages.keys()].map((name) => [name, new Map()]));
  while (pending.length) {
    const next = pending.pop();
    if (!next) break;
    const { name, from } = next;
    // Read the package root directly: some Midnight packages advertise a missing CJS entry,
    // although their ESM entry is valid. Node's node_modules search paths still locate the
    // same physical package for both conditions without executing any runtime code.
    let folder;
    let manifest;
    for (const search of createRequire(from).resolve.paths(name) ?? []) {
      try {
        const candidate = realpathSync(join(search, name));
        const value = JSON.parse(readFileSync(join(candidate, 'package.json'), 'utf8'));
        if (value.name !== name) throw new Error(`unexpected package ${value.name} for ${name}`);
        folder = candidate;
        manifest = value;
        break;
      } catch (error) {
        if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error;
      }
    }
    if (!folder) throw new Error(`cannot resolve installed ${name} from ${from}`);
    const expected = identityPackages.get(name);
    if (expected) {
      if (manifest.version !== expected)
        throw new Error(`${name}: expected ${expected}, found ${manifest.version} from ${from}`);
      const paths = copies.get(name);
      if (!paths) throw new Error(`untracked runtime ${name}`);
      paths.set(folder, [...(paths.get(folder) ?? []), from]);
    }
    if (seen.has(folder)) continue;
    seen.add(folder);
    for (const dependency of Object.keys({
      ...manifest.dependencies,
      ...manifest.peerDependencies,
    })) {
      if (dependency.startsWith('@midnight-ntwrk/') || dependency === '@midnightntwrk/ledger-v9')
        pending.push({ name: dependency, from: join(folder, 'package.json') });
    }
  }
  for (const [name, paths] of copies) {
    if (paths.size !== 1)
      throw new Error(
        `${name}: expected one physical runtime copy, found ${paths.size}\n` +
          [...paths]
            .map(([path, parents]) => `${path}\n  imported by ${parents.join('\n  imported by ')}`)
            .join('\n'),
      );
  }
  return Object.fromEntries([...copies].map(([name, paths]) => [name, [...paths.keys()][0]]));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [, , consumer, ...entries] = process.argv;
  if (!consumer || !entries.length)
    throw new Error('usage: check-midnight-runtime-identity.mjs CONSUMER PACKAGE [PACKAGE ...]');
  console.log(JSON.stringify(checkMidnightRuntimeIdentity(consumer, entries), null, 2));
}
