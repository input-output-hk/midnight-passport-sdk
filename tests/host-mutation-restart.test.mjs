import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { hostWorker } from '../scripts/qualification/host-mutation-matrix.mjs';
for (const [arm, retire] of /** @type {Array<[string,string]>} */ ([
  ['p256', 'true'],
  ['jubjub', 'false'],
]))
  test(`fresh host process resumes ${arm}, retire=${retire}, after a lost wave response`, async () => {
    const root = await mkdtemp(tmpdir() + '/passport-host-restart-');
    try {
      assert.equal(hostWorker(root, arm, retire, 'submit-2:after').status, 86);
      const result = hostWorker(root, arm, retire, 'none', 'resume');
      assert.equal(result.status, 0, JSON.stringify(result));
      assert.equal(result.output.result.kind, 'confirmed');
      assert.equal(result.output.plans, 1);
      assert.equal(result.output.sends, 3);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
