import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, writeFileSync, rmSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { configuredHostMutations } from '../src/host-config.ts';
import { serial, type HostMutationDriver } from '@input-output-hk/mn-passport-service';
import { testConfig } from './fixtures.ts';
const driver: HostMutationDriver = {
  prepare: async () => {
    throw new Error('unused');
  },
  prepareStep: async () => {
    throw new Error('unused');
  },
  submit: async () => {
    throw new Error('unused');
  },
  lookup: async () => undefined,
  check: async () => true,
};
test('host RPC is opt-in and requires independent private encryption/authentication files', () => {
  const root = mkdtempSync(join(tmpdir(), 'passport-host-config-'));
  try {
    const config = testConfig();
    const run = serial(8),
      noop = () => {};
    assert.equal(configuredHostMutations(config, undefined, {}, run, noop), undefined);
    assert.throws(() =>
      configuredHostMutations(config, driver, { PASSPORT_HOST_MUTATION_DIR: root }, run, noop),
    );
    const key = join(root, 'key'),
      token = join(root, 'token');
    writeFileSync(key, '11'.repeat(32), { mode: 0o600 });
    writeFileSync(token, '22'.repeat(32), { mode: 0o600 });
    const env = {
      PASSPORT_HOST_MUTATION_DIR: join(root, 'journal'),
      PASSPORT_HOST_MUTATION_KEY_FILE: key,
      PASSPORT_HOST_MUTATION_TOKEN_FILE: token,
    };
    assert.equal(typeof configuredHostMutations(config, driver, env, run, noop), 'function');
    writeFileSync(token, '11'.repeat(32));
    assert.throws(() => configuredHostMutations(config, driver, env, run, noop), /independent/);
    writeFileSync(token, '22'.repeat(32));
    chmodSync(token, 0o644);
    assert.throws(() => configuredHostMutations(config, driver, env, run, noop), /private/);
    assert.throws(() => configuredHostMutations(config, undefined, env, run, noop));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
