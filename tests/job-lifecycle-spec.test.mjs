import test from 'node:test';
import assert from 'node:assert/strict';
import {
  nativeJobProfile,
  confirmedReplyLossProbe,
  jobLifecycleStages,
  requireJobLifecycleCompletion,
  requireJobRemovedRefusal,
  requireImageLifecycleReplyLoss,
  requireOriginalLifecycleResume,
} from '../scripts/qualification/job-lifecycle-spec.mjs';
import { imageStateNames } from '../scripts/qualification/image-journal-mirror.mjs';
const id = 'a'.repeat(32),
  jobId = 'b'.repeat(32),
  circuit = 'add_device_with_p256';
const populated = () => ({ heldCoins: 1, activeReadGrants: 1, grantOpenedCurrentKey: true });
const good = () => ({
  code: 0,
  messages: [
    {
      completed: 'remove-target',
      audit: { id, phase: 'complete', unresolvedEffects: 0, completedSteps: 8 },
      populated: populated(),
      readers: {
        currentReaders: ['owner', 'survivor'],
        removedTargetCannotOpenCurrentKey: true,
        actor: 'owner',
      },
    },
  ],
});
test('explicit lifecycle profile isolates native ARM image resources and pins legacy creation unchanged', () => {
  assert.equal(nativeJobProfile().platform, 'linux/amd64');
  assert.equal(nativeJobProfile('lifecycle').platform, 'linux/arm64');
  assert.equal(
    imageStateNames('image-v1', 'p256', 'lifecycle').volume,
    'mn-passport-joblife-20261028-image-v1-p256-state',
  );
  assert.notEqual(
    imageStateNames('image-v1', 'p256').volume,
    imageStateNames('image-v1', 'p256', 'lifecycle').volume,
  );
  assert.throws(() => nativeJobProfile(/** @type {any} */ ('ambient')));
  assert.deepEqual(
    jobLifecycleStages('p256')
      .filter((s) => s.circuit)
      .map((s) => s.circuit),
    [circuit, 'rotate_enc_key_with_p256', 'rotate_enc_key_with_p256'],
  );
  assert.throws(() => jobLifecycleStages(/** @type {any} */ ('foreign')));
});
test('lifecycle acceptance requires exact readers, live grant access, qualified holding and complete owner journal', () => {
  requireJobLifecycleCompletion(good(), 'remove-target');
  for (const change of [
    (/** @type {any} */ m) => (m.audit.phase = 'pending'),
    (/** @type {any} */ m) => (m.audit.unresolvedEffects = 1),
    (/** @type {any} */ m) => (m.populated.heldCoins = 0),
    (/** @type {any} */ m) => (m.populated.activeReadGrants = 0),
    (/** @type {any} */ m) => (m.populated.grantOpenedCurrentKey = false),
    (/** @type {any} */ m) => m.readers.currentReaders.push('target'),
    (/** @type {any} */ m) => (m.readers.removedTargetCannotOpenCurrentKey = false),
    (/** @type {any} */ m) => (m.readers.actor = 'target'),
  ]) {
    const r = good();
    change(r.messages[0]);
    assert.throws(() => requireJobLifecycleCompletion(r, 'remove-target'));
  }
  const r = good();
  assert.ok(r.messages[0]);
  r.messages.push({ ...r.messages[0] });
  assert.throws(() => requireJobLifecycleCompletion(r, 'remove-target'));
});
test('image reply-loss acceptance binds new confirmed target job to the unresolved original owner intent', () => {
  const r = {
    code: 2,
    messages: [
      { imageReplyLost: true, circuit, jobId, state: 'done' },
      { failed: 'add-target', code: 'InternalError', audit: { id, unresolvedEffects: 1 } },
    ],
  };
  const snapshot = {
    jobs: [
      {
        jobId,
        circuit,
        identity: { kind: 'call', requestId: id + ':2' },
        state: 'done',
        host: { phase: 'complete', steps: [{ phase: 'confirmed', dispatchClaims: 1 }] },
      },
    ],
  };
  requireImageLifecycleReplyLoss(r, 'add-target', circuit, { jobs: [] }, snapshot);
  for (const bad of [
    { ...r, code: 0 },
    { ...r, messages: [{ ...r.messages[0], state: 'unknown' }, r.messages[1]] },
    { ...r, messages: [r.messages[0], { ...r.messages[1], code: 'ProverUnavailable' }] },
  ])
    assert.throws(() =>
      requireImageLifecycleReplyLoss(bad, 'add-target', circuit, { jobs: [] }, snapshot),
    );
  assert.throws(
    () => requireImageLifecycleReplyLoss(r, 'add-target', circuit, snapshot, snapshot),
    'Old matching circuit must not supply this boundary.',
  );
  const foreign = structuredClone(snapshot);
  assert.ok(foreign.jobs[0]);
  foreign.jobs[0].identity.requestId = 'c'.repeat(32) + ':2';
  assert.throws(() =>
    requireImageLifecycleReplyLoss(r, 'add-target', circuit, { jobs: [] }, foreign),
  );
  const unconfirmed = structuredClone(snapshot);
  assert.ok(unconfirmed.jobs[0]?.host.steps[0]);
  unconfirmed.jobs[0].host.steps[0].phase = 'dispatching';
  assert.throws(() =>
    requireImageLifecycleReplyLoss(r, 'add-target', circuit, { jobs: [] }, unconfirmed),
  );
});
test('resumption cannot silently replace an interrupted original intent', () => {
  const interrupted = { messages: [{ failed: 'remove-target', audit: { id, completedSteps: 3 } }] };
  requireOriginalLifecycleResume(interrupted, good(), 'remove-target');
  const replacement = good();
  assert.ok(replacement.messages[0]);
  replacement.messages[0].audit.id = 'f'.repeat(32);
  assert.throws(() => requireOriginalLifecycleResume(interrupted, replacement, 'remove-target'));
});
test('removed-reader refusal requires a reachable host, zero effects, old disclosure and current grant/holding evidence', () => {
  const message = {
    completed: 'verify-removed',
    removedIdentityRefused: true,
    hostRecordsUnchanged: true,
    hostReachable: true,
    originalTargetKeyStillWorks: true,
    hostJobsUnchanged: true,
    mutationAttempts: 0,
    populated: populated(),
  };
  requireJobRemovedRefusal({ code: 0, messages: [message] });
  for (const key of ['hostReachable', 'hostJobsUnchanged', 'originalTargetKeyStillWorks'])
    assert.throws(() =>
      requireJobRemovedRefusal({ code: 0, messages: [{ ...message, [key]: false }] }),
    );
  assert.throws(() =>
    requireJobRemovedRefusal({ code: 0, messages: [{ ...message, mutationAttempts: 1 }] }),
  );
  assert.throws(() =>
    requireJobRemovedRefusal({
      code: 0,
      messages: [{ ...message, populated: { ...populated(), grantOpenedCurrentKey: false } }],
    }),
  );
});

test('qualification reply observer only drops a confirmed target result once and exports no raw outcome', () => {
  /** @type {Record<string,unknown>[]} */ const events = [];
  const probe = confirmedReplyLossProbe(circuit, (v) => events.push(v));
  probe.track('append_inbox_with_p256');
  probe.observe({ jobId, state: 'done' });
  assert.equal(probe.lost, false);
  probe.track(circuit);
  for (const state of ['queued', 'running', 'unknown']) probe.observe({ jobId, state });
  assert.equal(events.length, 0);
  assert.throws(() => probe.observe({ jobId, state: 'done' }));
  assert.equal(probe.lost, true);
  assert.deepEqual(events, [{ imageReplyLost: true, circuit, jobId, state: 'done' }]);
  probe.observe({ jobId, state: 'done' });
  assert.equal(events.length, 1);
  assert.throws(() => confirmedReplyLossProbe('withdraw_all', () => {}));
});
