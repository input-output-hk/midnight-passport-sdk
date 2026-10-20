import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { encodeMutationValue } from '../packages/account/dist/index.js';
import { invokeMutationWorker, mutationWorld } from '../scripts/qualification/mutation-matrix.mjs';

for (const [arm, operation] of /** @type {Array<[string,string]>} */ ([
  ['p256', 'create'],
  ['jubjub', 'rotate'],
])) {
  test(`${arm} ${operation}: actual contract receipt is reconciled in a new process without replacement or duplicate submission`, async () => {
    const root = await mkdtemp(join(tmpdir(), 'passport-resume-test-'));
    try {
      assert.equal(invokeMutationWorker(root, arm, operation, 'prepare').status, 0);
      const fault =
        operation === 'create'
          ? 'deploy:after'
          : operation === 'rotate'
            ? 'material:committed:after'
            : 'complete:before';
      const interrupted = invokeMutationWorker(root, arm, operation, 'run', fault);
      assert.equal(interrupted.status, 86, JSON.stringify(interrupted));
      const before = await mutationWorld(root);
      if (operation === 'create') {
        const uncertain = invokeMutationWorker(root, arm, operation, 'resume', 'none', 'unknown');
        assert.equal(uncertain.output?.code, 'MutationUnsettled');
        assert.equal((await mutationWorld(root)).effects.length, before.effects.length);
      }
      const completed = invokeMutationWorker(root, arm, operation, 'resume');
      assert.equal(completed.status, 0, JSON.stringify(completed));
      const after = await mutationWorld(root);
      assert.equal(after.created, before.created);
      assert.equal(completed.output.audit.phase, 'complete');
      const effects = after.effects.length;
      after.record = undefined;
      after.hint = undefined;
      await writeFile(join(root, 'world.json'), JSON.stringify(encodeMutationValue(after)));
      assert.equal(invokeMutationWorker(root, arm, operation, 'resume').status, 0);
      assert.equal((await mutationWorld(root)).effects.length, effects);
      assert.ok((await mutationWorld(root)).record, 'final local record restored');
      assert.equal(JSON.stringify(completed.output.audit).includes('randomSeed'), false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
}

test('cancellation retains the submitted intent; explicit newly approved resume is required', async () => {
  const root = await mkdtemp(join(tmpdir(), 'passport-cancel-test-'));
  try {
    assert.equal(invokeMutationWorker(root, 'jubjub', 'create', 'run', 'deploy:after').status, 86);
    const before = await mutationWorld(root);
    assert.equal(invokeMutationWorker(root, 'jubjub', 'create', 'cancel').status, 0);
    assert.equal(
      invokeMutationWorker(root, 'jubjub', 'create', 'resume').output.code,
      'MutationUnsettled',
    );
    assert.equal((await mutationWorld(root)).effects.length, before.effects.length);
    assert.equal(invokeMutationWorker(root, 'jubjub', 'create', 'resume-cancelled').status, 0);
    const after = await mutationWorld(root);
    assert.ok(after.consents.at(-1).resuming);
    assert.equal(after.effects[0].request.retireAuthority, true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('lost key-origin output refuses rather than drawing a replacement generation', async () => {
  const root = await mkdtemp(join(tmpdir(), 'passport-key-window-test-'));
  try {
    assert.equal(invokeMutationWorker(root, 'p256', 'create', 'run', 'material:after').status, 86);
    const before = await mutationWorld(root);
    const refused = invokeMutationWorker(root, 'p256', 'create', 'resume');
    assert.equal(refused.output.code, 'MutationUnsettled');
    const after = await mutationWorld(root);
    assert.equal(after.created, before.created);
    assert.equal(after.effects.length, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
