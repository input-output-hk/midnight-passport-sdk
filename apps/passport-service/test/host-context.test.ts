import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { HostMutationRecord, HostJson } from '@input-output-hk/mn-passport-service';
import { callContext, deploymentContext } from '../src/host-context.ts';

function record(): HostMutationRecord {
  return {
    version: 1,
    revision: 1,
    owner: 'test',
    phase: 'active',
    input: {},
    steps: [],
    identity: {
      pins: {
        networkId: 'undeployed',
        bindingId: 'acc-s3r1.1',
        scheme: 'p256-webauthn',
        manifestSha256: '11'.repeat(32),
      },
      kind: 'deploy',
      requestId: '12'.repeat(16) + ':0',
      intentSha256: '34'.repeat(32),
    },
    plan: {
      address: 'ab'.repeat(32),
      steps: 2,
      context: {
        kind: 'deploy',
        driver: 'reference-v9-waves:1',
        state: 'aa',
        deployTx: 'bb',
        signingKey: { tag: 'schnorr', value: '22'.repeat(32) },
        retireAuthority: true,
        waves: [
          {
            index: 1,
            kind: 'deploy',
            circuits: ['one'],
            verifierBytes: 10,
            retiresAuthority: false,
          },
          {
            index: 2,
            kind: 'maintenance',
            circuits: ['two'],
            verifierBytes: 20,
            retiresAuthority: true,
          },
        ],
      },
    },
  };
}
test('retained deployment context round-trips without changing its signing key or waves', () => {
  const value = record();
  const before = JSON.stringify(value);
  const opened = deploymentContext(value);
  assert.deepEqual(opened, value.plan?.context);
  assert.equal(JSON.stringify(value), before, 'decoding never rewrites a retained plan');
  opened.waves[0]?.circuits.push('local-copy');
  assert.equal(JSON.stringify(value), before, 'decoded metadata does not alias journal arrays');
});
test('invalid context and mismatched plan metadata refuse before native work', () => {
  const base = record();
  const plan = base.plan;
  assert.ok(plan);
  const good = deploymentContext(base);
  for (const context of [
    null,
    [],
    { ...good, kind: 'call' },
    { ...good, driver: 'other' },
    { ...good, state: 'a' },
    { ...good, signingKey: { tag: 'other', value: 'aa' } },
    { ...good, waves: [] },
    { ...good, waves: good.waves.map((w) => ({ ...w, index: 1 })) },
  ] satisfies HostJson[]) {
    assert.throws(
      () => deploymentContext({ ...base, plan: { ...plan, context } }),
      /host mutation/i,
    );
  }
  assert.throws(
    () => deploymentContext({ ...base, plan: { ...plan, steps: 3 } }),
    /host mutation/i,
  );
  const { plan: omitted, ...withoutPlan } = base;
  assert.ok(omitted);
  assert.throws(() => deploymentContext(withoutPlan), /host mutation/i);
});
test('call context retains prepared transaction IDs and refuses cross-kind or multi-step plans', () => {
  const base = record();
  const transaction = { tx: 'aa', identifiers: ['00' + '33'.repeat(32)] };
  const plan = {
    address: 'ab'.repeat(32),
    steps: 1,
    context: { kind: 'call', driver: 'reference-v9-owner-call:1', transaction },
  };
  const call = { ...base, identity: { ...base.identity, kind: 'call' as const }, plan };
  const context = callContext(call);
  assert.equal(context.driver, 'reference-v9-owner-call:1');
  assert.deepEqual(context.transaction, transaction);
  assert.throws(() => deploymentContext(call), /host mutation/i);
  assert.throws(() => callContext({ ...call, plan: { ...plan, steps: 2 } }), /host mutation/i);
  assert.throws(
    () =>
      callContext({
        ...call,
        plan: { ...plan, context: { ...plan.context, transaction: { tx: 'aa', identifiers: [] } } },
      }),
    /host mutation/i,
  );
});
