import assert from 'node:assert/strict';
import {
  chmodSync,
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { checkSharedState } from '../scripts/midnight-shared-state.mjs';

const blockHash = `0x${'ab'.repeat(32)}`;
const profile = {
  networkId: 'undeployed',
  urls: { nodeRpcUrl: 'http://127.0.0.1:9944' },
  genesisHash: `0x${'cd'.repeat(32)}`,
  indexedBlock: { height: 45, hash: blockHash },
};

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'passport-shared-state-'));
  const shared = join(root, 'shared');
  const defaults = join(root, 'default');
  mkdirSync(shared, { mode: 0o700 });
  mkdirSync(defaults, { mode: 0o700 });
  return {
    root,
    shared,
    defaults,
    registryPath: join(shared, 'registry.json'),
    defaultRegistryPath: join(defaults, 'registry.json'),
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

test('a fresh shared registry gets one private chain anchor and refuses a changed chain', async () => {
  const f = fixture();
  try {
    const options = { ...f, profile, readBlockHash: async () => blockHash };
    const anchor = `${f.registryPath}.chain-anchor.json`;
    assert.equal((await checkSharedState({ ...options, mode: 'check' })).status, 'fresh');
    assert.equal(existsSync(anchor), false);
    assert.equal((await checkSharedState({ ...options, mode: 'bind' })).status, 'bound');
    assert.equal(JSON.parse(readFileSync(anchor, 'utf8')).observedBlock.hash, blockHash);
    writeFileSync(f.registryPath, '{}', { mode: 0o600 });
    assert.equal((await checkSharedState({ ...options, mode: 'check' })).status, 'verified');
    await assert.rejects(
      checkSharedState({
        ...options,
        mode: 'check',
        readBlockHash: async () => `0x${'ef'.repeat(32)}`,
      }),
      /Shared chain differs/,
    );
  } finally {
    f.cleanup();
  }
});

test('unanchored records cannot be adopted from a reset chain', async () => {
  const f = fixture();
  try {
    writeFileSync(`${f.registryPath.slice(0, -5)}.deployments.json`, '{}', { mode: 0o600 });
    await assert.rejects(
      checkSharedState({ ...f, profile, mode: 'bind' }),
      /exist without a chain anchor/,
    );
  } finally {
    f.cleanup();
  }
});

test('default-directory aliases and hardlinked records cannot become shared state', async () => {
  const f = fixture();
  try {
    const alias = join(f.root, 'alias');
    symlinkSync(f.defaults, alias);
    await assert.rejects(
      checkSharedState({
        ...f,
        profile,
        mode: 'check',
        registryPath: join(alias, 'registry.json'),
      }),
      /dedicated directory/,
    );
    writeFileSync(f.defaultRegistryPath, '{}', { mode: 0o600 });
    linkSync(f.defaultRegistryPath, f.registryPath);
    await assert.rejects(checkSharedState({ ...f, profile, mode: 'check' }), /hard-link/);
  } finally {
    f.cleanup();
  }
});

test('shared registry parent and files must remain private', async () => {
  const f = fixture();
  try {
    chmodSync(f.shared, 0o755);
    await assert.rejects(
      checkSharedState({ ...f, profile, mode: 'check' }),
      /parent must be private/,
    );
    chmodSync(f.shared, 0o700);
    writeFileSync(f.registryPath, '{}', { mode: 0o644 });
    await assert.rejects(
      checkSharedState({ ...f, profile, mode: 'check' }),
      /Shared state must be private/,
    );
  } finally {
    f.cleanup();
  }
});
