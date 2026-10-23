// Fast representative populated continuation. Exhaustive boundaries are in the opt-in matrix.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { invokeMutationWorker, mutationWorld } from '../scripts/qualification/mutation-matrix.mjs';
for (const arm of ['jubjub', 'p256'])
  test(`${arm}: populated grant and holding survive a fresh-process receipt-loss continuation`, async () => {
    const root = await mkdtemp(join(tmpdir(), 'passport-combined-test-'));
    /** @param {string} mode */
    const invoke = (mode, fault = 'none', outcomes = 'known') =>
      invokeMutationWorker(root, arm, 'rotate', mode, fault, outcomes, 'populated');
    try {
      const prepared = invoke('prepare');
      assert.equal(prepared.status, 0, prepared.diagnostic);
      const killed = invoke('run', 'first-owner-send:after');
      assert.equal(killed.status, 86, JSON.stringify(killed));
      const before = await mutationWorld(root);
      assert.equal(invoke('resume', 'none', 'unknown').status, 2);
      assert.equal((await mutationWorld(root)).effects.length, before.effects.length);
      const resumed = invoke('resume');
      assert.equal(resumed.status, 0, JSON.stringify(resumed));
      const final = await mutationWorld(root);
      assert.deepEqual(final.populatedVerified, {
        held: 1,
        activeReadGrants: 1,
        currentGrantOpened: true,
      });
      assert.equal(final.created, before.created);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
