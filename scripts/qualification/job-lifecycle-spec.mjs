// Closed qualification contract; never a production retry/authorization policy.
import assert from 'node:assert/strict';
import { requireNativeJobFailure } from './native-job-evidence.mjs';
/** @param {'creation'|'lifecycle'} profile */
export function nativeJobProfile(profile = 'creation') {
  assert.ok(['creation', 'lifecycle'].includes(profile));
  return profile === 'lifecycle'
    ? {
        profile,
        platform: 'linux/arm64',
        arch: 'arm64',
        label: 'job-lifecycle-20261028',
        depsVolume: 'mn-passport-joblife-20261028-linux-deps-arm64',
        depsLabel: 'job-lifecycle-20261028',
        ownerTimeoutMs: 30 * 60000,
      }
    : {
        profile,
        platform: 'linux/amd64',
        arch: 'amd64',
        label: 'native-host-jobs-20261027',
        depsVolume: 'mn-passport-hostjobs-20261027-linux-deps',
        depsLabel: 'native-host-jobs-20261027',
        ownerTimeoutMs: 15 * 60000,
      };
}
/** @param {'jubjub'|'p256'} arm */
export function jobLifecycleStages(arm) {
  assert.ok(['jubjub', 'p256'].includes(arm));
  return [
    { operation: 'add-survivor' },
    { operation: 'add-target', circuit: `add_device_with_${arm}` },
    { operation: 'remove-target', circuit: `rotate_enc_key_with_${arm}` },
    { operation: 'survivor-rotate', circuit: `rotate_enc_key_with_${arm}` },
  ];
}
/** @param {any} result @param {string} operation */
export function requireJobLifecycleCompletion(result, operation) {
  assert.equal(result.code, 0);
  assert.equal(
    result.messages.some((/** @type {any} */ m) => m.failed),
    false,
  );
  const completed = result.messages.filter((/** @type {any} */ m) => m.completed === operation);
  assert.equal(completed.length, 1);
  const m = completed[0];
  assert.equal(m.audit?.phase, 'complete');
  assert.equal(m.audit?.unresolvedEffects, 0);
  if (operation !== 'create') {
    assert.equal(m.populated?.heldCoins, 1);
    assert.equal(m.populated?.activeReadGrants, 1);
    assert.equal(m.populated?.grantOpenedCurrentKey, true);
    assert.deepEqual(
      m.readers?.currentReaders,
      operation === 'add-target' ? ['owner', 'survivor', 'target'] : ['owner', 'survivor'],
    );
    if (['remove-target', 'survivor-rotate'].includes(operation))
      assert.equal(m.readers?.removedTargetCannotOpenCurrentKey, true);
    assert.equal(m.readers?.actor, operation === 'survivor-rotate' ? 'survivor' : 'owner');
  }
  return m;
}
/** @param {any} result */
export function requireJobRemovedRefusal(result) {
  assert.equal(result.code, 0);
  assert.equal(
    result.messages.some((/** @type {any} */ m) => m.failed),
    false,
  );
  const messages = result.messages.filter(
    (/** @type {any} */ m) => m.completed === 'verify-removed',
  );
  assert.equal(messages.length, 1);
  const m = messages[0];
  for (const k of [
    'removedIdentityRefused',
    'hostRecordsUnchanged',
    'hostReachable',
    'originalTargetKeyStillWorks',
    'hostJobsUnchanged',
  ])
    assert.equal(m[k], true);
  assert.equal(m.mutationAttempts, 0);
  assert.equal(m.populated?.heldCoins, 1);
  assert.equal(m.populated?.activeReadGrants, 1);
  assert.equal(m.populated?.grantOpenedCurrentKey, true);
}
/** A deterministic owner-side lost observation of a confirmed original result, followed by
 * an actual production container kill/restart. Never describe this as a pre-send kill.
 * @param {any} result @param {string} operation @param {string} circuit @param {any} before @param {any} atLoss */
export function requireImageLifecycleReplyLoss(result, operation, circuit, before, atLoss) {
  assert.ok(
    ['InternalError', 'MutationUnsettled'].includes(
      result.messages.find((/** @type {any} */ m) => m.failed)?.code,
    ),
  );
  requireNativeJobFailure(
    result,
    operation,
    result.messages.find((/** @type {any} */ m) => m.failed)?.code,
  );
  const markers = result.messages.filter((/** @type {any} */ m) => m.imageReplyLost);
  assert.equal(markers.length, 1);
  const marker = markers[0];
  assert.equal(marker.circuit, circuit);
  assert.equal(marker.state, 'done');
  assert.equal(
    before.jobs.some((/** @type {any} */ j) => j.jobId === marker.jobId),
    false,
    'Boundary must be a new effect of this original operation.',
  );
  const job = atLoss.jobs.find((/** @type {any} */ j) => j.jobId === marker.jobId);
  assert.ok(job && job.identity.kind === 'call');
  assert.equal(
    job.identity.requestId.split(':')[0],
    result.messages.find((/** @type {any} */ m) => m.failed)?.audit?.id,
  );
  assert.equal(job.circuit, circuit);
  assert.equal(job.state, 'done');
  assert.equal(job.host?.phase, 'complete');
  assert.equal(job.host?.steps.length, 1);
  assert.equal(job.host.steps[0].phase, 'confirmed');
  assert.equal(job.host.steps[0].dispatchClaims, 1);
}

/** @param {any} interrupted @param {any} completed @param {string} operation */
export function requireOriginalLifecycleResume(interrupted, completed, operation) {
  const before = interrupted.messages.find((/** @type {any} */ m) => m.failed === operation)?.audit;
  const after = requireJobLifecycleCompletion(completed, operation).audit;
  assert.match(before?.id ?? '', /^[a-f0-9]{32}$/);
  assert.equal(after.id, before.id, 'Continuation must use the exact original owner intent.');
  assert.ok(after.completedSteps >= before.completedSteps);
}

/** Qualification-only deterministic loss of a confirmed original response.
 * Production execution/receipt storage is unchanged; the caller stops this invocation.
 * @param {string} target @param {(value:Record<string,unknown>)=>void} emit */
export function confirmedReplyLossProbe(target, emit) {
  assert.match(target, /^(add_device|rotate_enc_key)_with_(p256|jubjub)$/);
  /** @type {string|undefined} */ let active;
  let lost = false;
  return {
    /** @param {string|undefined} circuit */ track(circuit) {
      active = circuit;
    },
    get lost() {
      return lost;
    },
    /** @param {{jobId:string,state:string}} snapshot */ observe(snapshot) {
      if (!lost && active === target && snapshot.state === 'done') {
        assert.match(snapshot.jobId, /^[a-f0-9]{32}$/);
        lost = true;
        emit({ imageReplyLost: true, circuit: target, jobId: snapshot.jobId, state: 'done' });
        throw new Error(
          'Synthetic owner observation interrupted after original native confirmation.',
        );
      }
    },
  };
}
