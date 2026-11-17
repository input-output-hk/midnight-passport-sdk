#!/usr/bin/env node
// Bind shared-profile records to a chain observation after each quiescent run.
// --check is read-only; an unfinished run always refuses record reuse.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import {
  closeSync,
  existsSync,
  fsyncSync,
  linkSync,
  lstatSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = realpathSync(resolve(dirname(fileURLToPath(import.meta.url)), '..'));
const HASH = /^0x[0-9a-f]{64}$/;

/** @typedef {{ networkId: string, urls: { nodeRpcUrl: string }, genesisHash: string,
 * indexedBlock: { height: number, hash: string } }} SharedProfile */
/** @typedef {{ schemaVersion: number, networkId: string, genesisHash: string,
 * observedBlock: { height: number, hash: string } }} ChainAnchor */

/** @param {string} path */
const existing = (path) => lstatSync(path, { throwIfNoEntry: false });
/** @param {string} path */
const canonicalParent = (path) => realpathSync(dirname(path));

/** @param {string} path */
function assertPrivateRegular(path) {
  const row = existing(path);
  if (!row) return false;
  assert.ok(
    row.isFile() && !row.isSymbolicLink() && row.nlink === 1,
    `Refuse non-regular or linked state: ${path}`,
  );
  assert.equal(row.mode & 0o077, 0, `Shared state must be private: ${path}`);
  return true;
}

/** @param {string} path @param {string} defaultRegistryPath @param {string} repositoryRoot */
function canonicalRegistry(path, defaultRegistryPath, repositoryRoot) {
  assert.ok(
    isAbsolute(path) && path.endsWith('.json'),
    'Use an absolute shared registry .json path.',
  );
  const parent = canonicalParent(path);
  const directory = statSync(parent);
  assert.ok(directory.isDirectory(), 'Shared registry parent is not a directory.');
  assert.ok(typeof process.getuid === 'function', 'Shared registry needs a local Unix user.');
  assert.equal(directory.uid, process.getuid(), 'Shared registry parent must belong to this user.');
  assert.equal(directory.mode & 0o077, 0, 'Shared registry parent must be private.');
  const registry = join(parent, basename(path));
  const defaultParent = existsSync(dirname(defaultRegistryPath))
    ? canonicalParent(defaultRegistryPath)
    : resolve(dirname(defaultRegistryPath));
  assert.notEqual(
    parent,
    defaultParent,
    'Use a dedicated directory, separate from the default registry.',
  );
  const sourceRoot = realpathSync(repositoryRoot);
  assert.ok(
    parent !== sourceRoot && !parent.startsWith(`${sourceRoot}${sep}`),
    'Keep shared deployment state outside the repository.',
  );
  return registry;
}

/** @param {SharedProfile} profile */
function checkedProfile(profile) {
  assert.equal(profile?.networkId, 'undeployed');
  assert.equal(profile?.urls?.nodeRpcUrl, 'http://127.0.0.1:9944');
  assert.match(profile.genesisHash, HASH);
  assert.ok(Number.isSafeInteger(profile.indexedBlock?.height) && profile.indexedBlock.height > 0);
  assert.match(profile.indexedBlock.hash, HASH);
  return profile;
}

/** @param {string} nodeUrl @param {number} height */
async function nodeBlockHash(nodeUrl, height) {
  const response = await fetch(nodeUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'chain_getBlockHash', params: [height] }),
    signal: AbortSignal.timeout(4_000),
  });
  assert.ok(response.ok, 'Shared node did not answer the chain-anchor check.');
  const row = /** @type {{ error?: unknown, result?: unknown }} */ (await response.json());
  assert.equal(row.error, undefined, 'Shared node refused the chain-anchor check.');
  assert.ok(typeof row.result === 'string', 'Shared node returned no chain-anchor hash.');
  return row.result;
}

/** @param {string} path @param {unknown} value @param {'create' | 'replace'} mode */
function writeDurableJson(path, value, mode) {
  const temporary = `${path}.pending-${randomBytes(8).toString('hex')}`;
  try {
    const file = openSync(temporary, 'wx', 0o600);
    try {
      writeFileSync(file, JSON.stringify(value, null, 2));
      fsyncSync(file);
    } finally {
      closeSync(file);
    }
    if (mode === 'create') linkSync(temporary, path);
    else renameSync(temporary, path);
    const parent = openSync(dirname(path), 'r');
    try {
      fsyncSync(parent);
    } finally {
      closeSync(parent);
    }
  } finally {
    if (existsSync(temporary)) unlinkSync(temporary);
  }
}

/** @param {string} path */
function syncParent(path) {
  const parent = openSync(dirname(path), 'r');
  try {
    fsyncSync(parent);
  } finally {
    closeSync(parent);
  }
}

/** @param {{ mode: 'check' | 'begin' | 'finish', registryPath: string, profile: SharedProfile,
 * readBlockHash?: (nodeUrl: string, height: number) => Promise<string>,
 * defaultRegistryPath?: string, repositoryRoot?: string }} options */
export async function checkSharedState({
  mode,
  registryPath,
  profile,
  readBlockHash = nodeBlockHash,
  defaultRegistryPath = join(homedir(), '.midnight-passport', 'registry.json'),
  repositoryRoot = ROOT,
}) {
  assert.ok(['check', 'begin', 'finish'].includes(mode), 'Expected --check, --begin or --finish.');
  checkedProfile(profile);
  const registry = canonicalRegistry(registryPath, defaultRegistryPath, repositoryRoot);
  const files = [registry, `${registry.slice(0, -5)}.deployments.json`, `${registry}.v1`];
  const anchorPath = `${registry}.chain-anchor.json`;
  const activePath = `${registry}.chain-active.json`;
  const defaults = [
    defaultRegistryPath,
    `${defaultRegistryPath.replace(/\.json$/, '')}.deployments.json`,
    `${defaultRegistryPath}.v1`,
  ];
  for (const [index, file] of files.entries()) {
    const defaultFile = defaults[index];
    assert.ok(defaultFile);
    if (assertPrivateRegular(file) && existing(defaultFile)) {
      const candidate = statSync(file);
      const baseline = statSync(defaultFile);
      assert.ok(
        candidate.dev !== baseline.dev || candidate.ino !== baseline.ino,
        'Shared state must not hard-link the default deployment records.',
      );
    }
  }
  const active = assertPrivateRegular(activePath);
  if (mode === 'finish') {
    assert.ok(active, 'No shared session marker exists; refuse to advance the chain anchor.');
    const marker = JSON.parse(readFileSync(activePath, 'utf8'));
    assert.equal(marker.schemaVersion, 1, 'Unsupported shared session marker.');
    assert.equal(
      marker.pid,
      process.ppid,
      'Only the launcher that began this session may finish it.',
    );
  } else {
    assert.ok(!active, 'Shared session is unfinished; reconcile it before reusing records.');
  }
  let status = 'fresh';
  if (assertPrivateRegular(anchorPath)) {
    const anchor = JSON.parse(readFileSync(anchorPath, 'utf8'));
    assert.equal(anchor.schemaVersion, 1, 'Unsupported shared chain anchor.');
    assert.equal(anchor.networkId, 'undeployed');
    assert.match(anchor.genesisHash, HASH);
    assert.ok(
      Number.isSafeInteger(anchor.observedBlock?.height) && anchor.observedBlock.height > 0,
    );
    assert.match(anchor.observedBlock.hash, HASH);
    assert.equal(anchor.genesisHash, profile.genesisHash, 'Shared chain genesis changed.');
    assert.ok(
      profile.indexedBlock.height >= anchor.observedBlock.height,
      'Shared indexer is behind the recorded chain anchor.',
    );
    assert.equal(
      await readBlockHash(profile.urls.nodeRpcUrl, anchor.observedBlock.height),
      anchor.observedBlock.hash,
      'Shared chain differs at the recorded block.',
    );
    status = 'verified';
  } else {
    assert.ok(
      files.every((file) => !existing(file)),
      'Shared registry/deployment records exist without a chain anchor; reconcile them before reuse.',
    );
  }
  if (mode === 'begin') {
    writeDurableJson(activePath, { schemaVersion: 1, pid: process.ppid }, 'create');
    if (status === 'fresh')
      writeDurableJson(
        anchorPath,
        {
          schemaVersion: 1,
          networkId: 'undeployed',
          genesisHash: profile.genesisHash,
          observedBlock: profile.indexedBlock,
        },
        'create',
      );
    return { status: 'active', anchorPath };
  }
  if (mode === 'finish') {
    assert.equal(status, 'verified', 'Shared session has no initial chain anchor.');
    writeDurableJson(
      anchorPath,
      {
        schemaVersion: 1,
        networkId: 'undeployed',
        genesisHash: profile.genesisHash,
        observedBlock: profile.indexedBlock,
      },
      'replace',
    );
    unlinkSync(activePath);
    syncParent(activePath);
    return { status: 'finished', anchorPath };
  }
  return { status, anchorPath };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    const [flag, registryPath] = process.argv.slice(2);
    const mode =
      flag === '--check'
        ? 'check'
        : flag === '--begin'
          ? 'begin'
          : flag === '--finish'
            ? 'finish'
            : undefined;
    assert.ok(mode, 'Expected --check, --begin or --finish.');
    assert.ok(registryPath, 'Shared registry path is required.');
    let input = '';
    for await (const chunk of process.stdin) {
      input += chunk;
      assert.ok(input.length <= 16_384, 'Shared profile is too large.');
    }
    const result = await checkSharedState({ mode, registryPath, profile: JSON.parse(input) });
    console.log(`midnight-shared-state: ${result.status} (${result.anchorPath})`);
  } catch (error) {
    console.error(
      `midnight-shared-state: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  }
}
