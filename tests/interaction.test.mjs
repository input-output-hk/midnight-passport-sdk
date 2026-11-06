import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import {
  createActivityStore,
  createOperationStatus,
  RUNNING_FILL_CAP,
  stageWeight,
} from '../packages/account/dist/interaction.js';

/** @typedef {import('../packages/account/dist/interaction.js').OperationObservation} Observation */
/** @typedef {import('../packages/account/dist/interaction.js').ActivityObservation} Activity */

/** @returns {Observation} */
const deployment = () => ({
  id: 'create-1',
  title: 'Create Passport account',
  phase: 'running',
  startedAt: 1000,
  references: { flowId: 'flow-1', requestId: 'request-1', intentId: 'intent-1' },
  stages: [
    { id: 'passkey', title: 'Create passkey', phase: 'succeeded', startedAt: 1000, endedAt: 2000 },
    {
      id: 'deploy',
      title: 'Deploy account',
      phase: 'running',
      startedAt: 2000,
      estimateMs: 180000,
    },
    { id: 'activate', title: 'Activate device', phase: 'pending', estimateMs: 25000 },
  ],
});

test('interaction is a lightweight subpath of the existing account package', () => {
  const manifest = JSON.parse(
    readFileSync(new URL('../packages/account/package.json', import.meta.url), 'utf8'),
  );
  assert.equal(manifest.exports['./interaction'].default, './dist/interaction.js');
  assert.equal(manifest.dependencies.react, undefined);
});

test('deployment estimates never claim completion, and keep actual stage observations', () => {
  const status = createOperationStatus(deployment(), 902000);
  assert.equal(status.phase, 'running');
  assert.equal(status.elapsedMs, 901000);
  assert.deepEqual(
    status.stages.map((s) => [s.phase, s.fillPercent, s.weight]),
    [
      ['succeeded', 100, 1],
      ['running', RUNNING_FILL_CAP, 9],
      ['pending', 0, 1.25],
    ],
  );
  assert.equal(status.stages[1]?.elapsedMs, 900000);
  assert.equal(stageWeight({ estimateMs: 1000 }), 1);
});

test('unknown submission retains original references and has no estimated completion', () => {
  const observation = deployment();
  const input = { ...observation, phase: /** @type {const} */ ('unknown'), endedAt: 3000 };
  const status = createOperationStatus(input, 9000000);
  assert.equal(status.phase, 'unknown');
  assert.equal(status.elapsedMs, 2000, 'the attempt stopped, even while outcome is unresolved');
  assert.equal(status.stages[0]?.fillPercent, 100, 'completed credential stage stays observed');
  assert.equal(status.stages[1]?.fillPercent, undefined, 'never imply submit confirmation');
  assert.deepEqual(status.references, observation.references);
  assert.equal(status.references.intentId, 'intent-1');
});

test('unestimated and explicitly unknown stages are indeterminate at any elapsed time', () => {
  const source = deployment();
  const status = createOperationStatus(
    {
      ...source,
      stages: [
        { id: 'wait', title: 'Waiting for provider', phase: 'running', startedAt: 1000 },
        { id: 'submit', title: 'Reconcile submission', phase: 'unknown', estimateMs: 1000 },
      ],
    },
    9000000,
  );
  assert.equal(status.stages[0]?.fillPercent, undefined);
  assert.equal(status.stages[1]?.fillPercent, undefined);
  assert.equal(status.phase, 'running', 'the host supplies the operation outcome');
});

test('attempt failure and cancellation never manufacture successful later stages', () => {
  for (const phase of /** @type {const} */ (['failed', 'cancelled'])) {
    const status = createOperationStatus({ ...deployment(), phase, endedAt: 4000 }, 900000);
    assert.equal(status.phase, phase);
    assert.equal(status.stages[2]?.phase, 'pending');
    assert.equal(status.stages[2]?.fillPercent, 0);
    assert.equal(status.elapsedMs, 3000);
  }
  const source = deployment();
  const stages = source.stages.map((s) =>
    s.id === 'deploy' ? { ...s, phase: /** @type {const} */ ('failed'), endedAt: 4000 } : s,
  );
  const status = createOperationStatus(
    { ...source, phase: 'failed', endedAt: 4000, stages },
    900000,
  );
  assert.equal(status.stages[1]?.phase, 'failed');
  assert.equal(status.stages[1]?.fillPercent, 100, 'a full failed segment is still failed');
});

test('late reads do not advance ended attempts or infer completion of planned stages', () => {
  const source = { ...deployment(), phase: /** @type {const} */ ('succeeded'), endedAt: 4000 };
  assert.deepEqual(createOperationStatus(source, 4000), createOperationStatus(source, 900000));
  assert.equal(createOperationStatus(source, 4000).stages[2]?.phase, 'pending');
});

test('backwards wall-clock movement produces no negative fill or elapsed time', () => {
  const status = createOperationStatus(deployment(), 500);
  assert.equal(status.elapsedMs, 0);
  assert.equal(status.stages[1]?.elapsedMs, 0);
  assert.equal(status.stages[1]?.fillPercent, 0);
});

test('invalid timing, duplicate stage IDs and invalid runtime enums are refused', () => {
  const source = deployment();
  for (const now of [NaN, Infinity, -1]) {
    assert.throws(() => createOperationStatus(source, now), TypeError);
  }
  for (const estimateMs of [NaN, Infinity, -1]) {
    assert.throws(() => stageWeight({ estimateMs }), TypeError);
  }
  /** @type {Observation[]} */
  const invalid = [
    { ...source, endedAt: 2000 },
    { ...source, startedAt: NaN },
    { ...source, phase: 'failed' },
    { ...source, phase: 'cancelled', endedAt: 999 },
    { ...source, stages: [source.stages[0], source.stages[0]].filter((s) => s !== undefined) },
    {
      ...source,
      stages: [{ id: 's', title: 'End without start', phase: 'failed', endedAt: 3000 }],
    },
    {
      ...source,
      stages: [{ id: 's', title: 'Bad interval', phase: 'failed', startedAt: 3000, endedAt: 2000 }],
    },
    {
      ...source,
      stages: [
        { id: 's', title: 'Already ended', phase: 'running', startedAt: 2000, endedAt: 3000 },
      ],
    },
  ];
  for (const input of invalid) assert.throws(() => createOperationStatus(input, 5000), TypeError);
  assert.throws(
    () =>
      createOperationStatus(
        { ...source, phase: /** @type {Observation['phase']} */ ('confirmed') },
        5000,
      ),
    TypeError,
  );
  assert.throws(
    () =>
      createOperationStatus(
        {
          ...source,
          stages: [
            {
              id: 's',
              title: 'x',
              phase: /** @type {import('../packages/account/dist/interaction.js').StagePhase} */ (
                'confirmed'
              ),
            },
          ],
        },
        5000,
      ),
    TypeError,
  );
});

test('snapshots copy only public fields and cannot be changed through source references', () => {
  const source = deployment();
  const supplied = {
    ...source,
    seed: 'not-public',
    references: { ...source.references, token: 'not-public' },
    stages: source.stages.map((s) => ({ ...s, witness: 'not-public' })),
  };
  const status = createOperationStatus(supplied, 4000);
  assert.equal(JSON.stringify(status).includes('not-public'), false);
  supplied.references.intentId = 'changed';
  assert.ok(supplied.stages[0]);
  supplied.stages[0].title = 'changed';
  assert.equal(status.references.intentId, 'intent-1');
  assert.equal(status.stages[0]?.title, 'Create passkey');
  assert.equal(Object.isFrozen(status), true);
  assert.equal(Object.isFrozen(status.references), true);
  assert.equal(Object.isFrozen(status.stages), true);
  assert.ok(status.stages.every(Object.isFrozen));
});

test('two hosts share a stable external-store snapshot without starting an operation', () => {
  const store = createActivityStore();
  const initial = store.getSnapshot();
  assert.strictEqual(store.getSnapshot(), initial);
  /** @type {import('../packages/account/dist/interaction.js').ActivitySnapshot[]} */
  const a = [];
  /** @type {import('../packages/account/dist/interaction.js').ActivitySnapshot[]} */
  const b = [];
  const detachA = store.subscribe(() => a.push(store.getSnapshot()));
  const detachB = store.subscribe(() => b.push(store.getSnapshot()));
  assert.equal(a.length + b.length, 0, 'subscription is not an action or an immediate emission');
  assert.strictEqual(store.getSnapshot(), initial, 'render/subscribe leaves identity stable');
  const operation = createOperationStatus(deployment(), 4000);
  assert.equal(store.replace({ operation, journey: [] }, initial.revision), true);
  assert.strictEqual(a[0], b[0]);
  assert.strictEqual(a[0], store.getSnapshot());
  assert.notStrictEqual(store.getSnapshot(), initial);
  detachA();
  detachA();
  assert.equal(store.replace({ journey: [] }, 1), true);
  assert.equal(a.length, 1);
  assert.equal(b.length, 2);
  detachB();
});

test('a stale asynchronous result cannot replace newer unknown-outcome identity', () => {
  const store = createActivityStore();
  const old = store.getSnapshot();
  const operation = createOperationStatus(
    { ...deployment(), phase: 'unknown', endedAt: 5000 },
    5000,
  );
  assert.equal(store.replace({ operation, journey: [] }, old.revision), true);
  const unknown = store.getSnapshot();
  assert.equal(store.replace({ journey: [] }, old.revision), false);
  assert.strictEqual(store.getSnapshot(), unknown);
  assert.equal(unknown.operation?.references.intentId, 'intent-1');
  assert.equal(store.replace({ journey: [] }, NaN), false);
  assert.equal(store.replace({ journey: [] }, 0.5), false);
});

test('journey facts remain host-owned: a wallet connection is explicitly optional', () => {
  /** @type {import('../packages/account/dist/interaction.js').JourneyStep[]} */
  const journey = [
    { id: 'account', title: 'Open Passport account', phase: 'done' },
    { id: 'wallet', title: 'Connect Midnight wallet', phase: 'optional' },
    { id: 'review', title: 'Review account access', phase: 'current' },
  ];
  const store = createActivityStore({ journey });
  journey[0] = { id: 'account', title: 'Changed', phase: 'blocked' };
  assert.equal(store.getSnapshot().journey[0]?.phase, 'done');
  assert.equal(store.getSnapshot().journey[1]?.phase, 'optional');
  assert.equal(Object.isFrozen(store.getSnapshot().journey), true);
  assert.ok(store.getSnapshot().journey.every(Object.isFrozen));
});

test('invalid replacement is atomic and leaves the previous snapshot and subscribers untouched', () => {
  const store = createActivityStore();
  let notifications = 0;
  store.subscribe(() => notifications++);
  const initial = store.getSnapshot();
  const step = { id: 'a', title: 'Account', phase: /** @type {const} */ ('done') };
  assert.throws(() => store.replace({ journey: [step, step] }, 0), TypeError);
  assert.throws(() => store.replace({ journey: [{ ...step, title: '' }] }, 0), TypeError);
  assert.throws(
    () => store.replace({ journey: [{ ...step, title: 'x'.repeat(1025) }] }, 0),
    TypeError,
  );
  assert.throws(
    () =>
      store.replace(
        {
          journey: [
            {
              ...step,
              phase: /** @type {import('../packages/account/dist/interaction.js').JourneyPhase} */ (
                'confirmed'
              ),
            },
          ],
        },
        0,
      ),
    TypeError,
  );
  assert.strictEqual(store.getSnapshot(), initial);
  assert.equal(notifications, 0);
});

test('store also copies caller-created operation snapshots and strips extensions', () => {
  const operation = createOperationStatus(deployment(), 4000);
  const supplied = {
    ...operation,
    privateKey: 'not-public',
    stages: operation.stages.map((s) => ({ ...s, providerPrivateField: 'not-public' })),
    references: { ...operation.references, auth: 'not-public' },
  };
  const store = createActivityStore({ operation: supplied, journey: [] });
  supplied.references.intentId = 'changed';
  assert.ok(supplied.stages[0]);
  supplied.stages[0].title = 'changed';
  const snapshot = store.getSnapshot();
  assert.equal(JSON.stringify(snapshot).includes('not-public'), false);
  assert.equal(snapshot.operation?.references.intentId, 'intent-1');
  assert.equal(snapshot.operation?.stages[0]?.title, 'Create passkey');
});

test('effect cleanup and re-subscription do not erase operation identity or replay writes', () => {
  const operation = createOperationStatus({ ...deployment(), phase: 'unknown' }, 4000);
  const store = createActivityStore({ operation, journey: [] });
  let calls = 0;
  const listener = () => calls++;
  const detach = store.subscribe(listener);
  detach();
  const again = store.subscribe(listener);
  assert.equal(calls, 0);
  assert.equal(store.getSnapshot().operation?.references.intentId, 'intent-1');
  store.dispose();
  store.dispose();
  assert.equal(store.replace({ journey: [] }, 0), false);
  assert.equal(store.getSnapshot().operation?.phase, 'unknown');
  store.subscribe(listener)();
  again();
  assert.equal(calls, 0);
});

test('duplicate callback registrations have separate cleanup ownership', () => {
  const store = createActivityStore();
  let count = 0;
  const callback = () => count++;
  const a = store.subscribe(callback);
  const b = store.subscribe(callback);
  a();
  store.replace({ journey: [] }, 0);
  assert.equal(count, 1);
  b();
  store.replace({ journey: [] }, 1);
  assert.equal(count, 1);
});

test('one failing renderer cannot starve another host or roll back an accepted snapshot', () => {
  const store = createActivityStore();
  store.subscribe(() => {
    throw new Error('renderer failed');
  });
  let observed = -1;
  store.subscribe(() => {
    observed = store.getSnapshot().revision;
  });
  assert.throws(() => store.replace({ journey: [] }, 0), AggregateError);
  assert.equal(observed, 1);
  assert.equal(store.getSnapshot().revision, 1);
});

test('unsubscribing a later listener during notification prevents its stale callback', () => {
  const store = createActivityStore();
  let count = 0;
  let detach = () => {};
  store.subscribe(() => detach());
  detach = store.subscribe(() => count++);
  store.replace({ journey: [] }, 0);
  assert.equal(count, 0);
});
