import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  recoveryVerifierRosterDigest,
  reviewRecoverySession,
} from '../packages/account/dist/recovery.js';

const target = {
  account: '11'.repeat(32),
  networkId: 'undeployed',
  bindingId: 'qualified-fixture',
};
const roster = /** @type {const} */ ([
  ['recover_submit', '22'.repeat(32)],
  ['recover_finalise', '33'.repeat(32)],
]);
const verifierRosterSha256 = recoveryVerifierRosterDigest(roster);
const profile = {
  networkId: target.networkId,
  bindingId: target.bindingId,
  verifierRosterSha256,
  recoveryVersion: 1n,
  maxPublicShares: 4,
  minimumVetoSeconds: 100n,
  blockTimeToleranceSeconds: 5n,
};
const observation = {
  ...target,
  verifierRosterSha256,
  recoveryVersion: 1n,
  blockHash: '44'.repeat(32),
  blockTimeSeconds: 203n,
  deviceEpoch: 1n,
  authorizationNonce: 8n,
  sessionId: '55'.repeat(32),
  viewingPublicKey: '66'.repeat(32),
  publicShareCount: 2,
  vetoSeconds: 100n,
};

test('recovery verifier identity binds each circuit to its key, independent of ordering', () => {
  assert.equal(recoveryVerifierRosterDigest([...roster].reverse()), verifierRosterSha256);
  assert.notEqual(
    recoveryVerifierRosterDigest([
      ['recover_submit', roster[1][1]],
      ['recover_finalise', roster[0][1]],
    ]),
    verifierRosterSha256,
  );
  assert.throws(() => recoveryVerifierRosterDigest([...roster, roster[0]]), {
    code: 'BindingUnsupported',
  });
});

test('recovery preflight refuses the deployed legacy binding and invalid profiles before lookup', async () => {
  const source = { readFinalizedRecovery: async () => assert.fail('unexpected chain read') };
  const legacy = { ...target, bindingId: 'acc-s3r1.1' };
  await assert.rejects(
    reviewRecoverySession(legacy, { ...profile, bindingId: legacy.bindingId }, source),
    {
      code: 'BindingUnsupported',
    },
  );
  await assert.rejects(
    reviewRecoverySession(target, { ...profile, bindingId: 'elsewhere' }, source),
    {
      code: 'BindingUnsupported',
    },
  );
  await assert.rejects(
    reviewRecoverySession(target, { ...profile, minimumVetoSeconds: 5n }, source),
    {
      code: 'BindingUnsupported',
    },
  );
  await assert.rejects(
    reviewRecoverySession(target, { ...profile, networkId: 'preview' }, source),
    {
      code: 'NetworkMismatch',
    },
  );
});

test('recovery preflight refuses observations for another deployment, roster, profile or session', async () => {
  /** @param {import('../packages/account/dist/recovery.js').RecoveryObservation | undefined} state */
  const read = (state) =>
    reviewRecoverySession(target, profile, {
      async readFinalizedRecovery(request) {
        assert.deepEqual(request, target);
        return state;
      },
    });
  await assert.rejects(read(undefined), { code: 'AccountNotFound' });
  await assert.rejects(read({ ...observation, account: 'ff'.repeat(32) }), {
    code: 'AccountNotFound',
  });
  await assert.rejects(read({ ...observation, networkId: 'preview' }), { code: 'NetworkMismatch' });
  for (const patch of [
    { bindingId: 'elsewhere' },
    { verifierRosterSha256: 'ff'.repeat(32) },
    { recoveryVersion: 2n },
    { publicShareCount: 5 },
    { vetoSeconds: 99n },
    { sessionId: '00'.repeat(32) },
  ])
    await assert.rejects(read({ ...observation, ...patch }), { code: 'BindingUnsupported' });
  await assert.rejects(read({ ...observation, authorizationNonce: -1n }), { name: 'ZodError' });
});

test('recovery preflight distinguishes a live guardian session, post-recovery gap and pending window', async () => {
  const pending = { notBeforeSeconds: 200n, successorEntry: '77'.repeat(32) };
  for (const [state, phase] of /** @type {const} */ ([
    [observation, 'guardian-session-present'],
    [{ ...observation, publicShareCount: 0 }, 'no-guardian-session'],
    [{ ...observation, pending }, 'pending-veto'],
    [{ ...observation, pending, blockTimeSeconds: 205n }, 'pending-veto-elapsed'],
  ])) {
    const review = await reviewRecoverySession(target, profile, {
      readFinalizedRecovery: async () => state,
    });
    assert.equal(review.phase, phase);
    assert.deepEqual(review.observation, state);
    assert.equal(Object.isFrozen(review.observation), true);
    if (review.observation.pending) assert.equal(Object.isFrozen(review.observation.pending), true);
  }
});

test('a recovery review retains the trusted pins while the host read is pending', async () => {
  const request = { ...target };
  const policy = { ...profile };
  /** @type {(value: typeof observation) => void} */
  let publish = () => {};
  const pending = reviewRecoverySession(request, policy, {
    readFinalizedRecovery: async (selected) => {
      assert.equal(Object.isFrozen(selected), true);
      return new Promise((resolve) => {
        publish = resolve;
      });
    },
  });
  const changedDigest = '99'.repeat(32);
  request.account = '99'.repeat(32);
  policy.verifierRosterSha256 = changedDigest;
  publish({ ...observation, verifierRosterSha256: changedDigest });
  await assert.rejects(pending, { code: 'BindingUnsupported' });
});
