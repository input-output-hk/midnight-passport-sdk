import assert from 'node:assert/strict';
import { test } from 'node:test';
import { plainError } from '../src/flows.ts';
import { EventLog } from '../src/event-log.ts';
import { demoActivityObservation, operationForRun } from '../src/activity-observations.ts';

const facts = { accountOpen: true, walletConnected: false };
const fail = (log: EventLog) =>
  log.fail({
    code: 'Error',
    message: 'read or acknowledgement failed',
    hint: 'Inspect original state',
  });
const session = (log: EventLog, phase: string, intentId: string) =>
  log.trace({
    at: new Date(1000).toISOString(),
    kind: 'session.state',
    details: { phase, intentId },
  });

test('a late blocked intent cannot relabel or replace the references of a finished attempt', () => {
  const log = new EventLog(() => 1000);
  log.start('withdraw');
  fail(log);
  const before = demoActivityObservation(log, 1000, facts);
  session(log, 'blocked', 'unrelated-late-intent');
  assert.deepEqual(demoActivityObservation(log, 1000, facts), before);
  assert.equal(log.traceJSON().at(-1)?.details.intentId, 'unrelated-late-intent');
});

test('an unrelated timer intent arriving during a public read stays outside that operation', () => {
  const log = new EventLog(() => 1000);
  log.start('refresh');
  session(log, 'blocked', 'foreign-intent');
  fail(log);
  const operation = demoActivityObservation(log, 1000, facts).operation!;
  assert.equal(operation.phase, 'failed');
  assert.equal(operation.references.intentId, undefined);
});

test('a refused withdrawal cannot borrow an imported blocked intent without its own begin', () => {
  const log = new EventLog(() => 1000);
  log.start('withdraw');
  session(log, 'blocked', 'foreign-intent');
  fail(log);
  const operation = demoActivityObservation(log, 1000, facts).operation!;
  assert.equal(operation.phase, 'failed');
  assert.equal(operation.references.intentId, undefined);
});

test('unknown issue, spend and revoke keep their controller begin identity despite foreign updates', () => {
  for (const [action, phase] of [
    ['startSession', 'authorizing'],
    ['withdraw', 'spending'],
    ['revokeSession', 'revoking'],
  ] as const) {
    const log = new EventLog(() => 1000);
    log.start(action);
    session(log, phase, 'owned-intent');
    session(log, 'blocked', 'foreign-intent');
    session(log, 'blocked', 'owned-intent');
    fail(log);
    const operation = demoActivityObservation(log, 1000, facts).operation!;
    assert.equal(operation.phase, 'unknown');
    assert.equal(operation.references.intentId, 'owned-intent');
  }
});

test('foreign blocked updates cannot turn a known local intent into an unknown send', () => {
  const log = new EventLog(() => 1000);
  log.start('withdraw');
  session(log, 'spending', 'owned-intent');
  session(log, 'active', 'owned-intent');
  session(log, 'blocked', 'foreign-intent');
  fail(log);
  const operation = demoActivityObservation(log, 1000, facts).operation!;
  assert.equal(operation.phase, 'failed');
  assert.equal(operation.references.intentId, 'owned-intent');
});

test('exact review cancellation remains cancelled and never advances optional wallet authority', () => {
  const log = new EventLog(() => 1000);
  log.start('issueGrant');
  log.trace({ at: new Date(1000).toISOString(), kind: 'grant.issue.cancelled', details: {} });
  log.finish();
  const snapshot = demoActivityObservation(log, 1000, {
    accountOpen: false,
    walletConnected: true,
  });
  assert.equal(snapshot.operation?.phase, 'cancelled');
  assert.equal(snapshot.journey[0]?.phase, 'current');
  assert.equal(snapshot.journey[1]?.phase, 'optional');
  assert.equal(snapshot.journey[2]?.phase, 'done');
});

test('historical Audit rows retain their outcome and ID after newer actions, alongside raw attempts', () => {
  const log = new EventLog(() => 1000);
  const cancelled = log.start('create');
  log.trace({ at: new Date(1000).toISOString(), kind: 'action.declined', details: {} });
  log.finish();
  const uncertain = log.start('fund');
  log.trace({
    at: new Date(1000).toISOString(),
    kind: 'funding.intent',
    details: { requestId: 'original-request' },
  });
  log.fail({ code: 'FundingRejected', message: 'Unconfirmed', hint: 'Reconcile' });
  log.start('refresh');
  log.finish();
  assert.equal(operationForRun(log, cancelled, 1000).phase, 'cancelled');
  assert.equal(operationForRun(log, cancelled, 1000).id, 'operation-1');
  assert.equal(operationForRun(log, uncertain, 1000).phase, 'unknown');
  assert.equal(operationForRun(log, uncertain, 1000).id, 'operation-2');
  assert.equal(operationForRun(log, uncertain, 1000).references.requestId, 'original-request');
  assert.equal(log.toJSON()[0]?.result, 'done', 'raw legacy attempt state is preserved');
  assert.equal(
    log.toJSON()[1]?.result,
    'failed',
    'raw failure is not rewritten to invent finality',
  );
});

test('the same grant roster error distinguishes submitted unknown from pre-submit refusal', () => {
  for (const submitted of [false, true]) {
    const log = new EventLog(() => 1000);
    const run = log.start('spendGrant');
    const txHash = 'ab'.repeat(32);
    log.fail(
      plainError(
        { code: 'GrantRosterUnsettled', message: 'Roster unsettled', ...(submitted && { txHash }) },
        '',
      ),
    );
    const operation = operationForRun(log, run, 1000);
    assert.equal(operation.phase, submitted ? 'unknown' : 'failed');
    assert.equal(operation.references.transactionId, submitted ? txHash : undefined);
    assert.equal(log.toJSON()[0]?.result, 'failed');
  }
});

test('validated accepted transaction evidence wins over a later cancellation or stale trace hash', () => {
  const log = new EventLog(() => 1000);
  const run = log.start('issueGrant');
  log.trace({
    at: new Date(1000).toISOString(),
    kind: 'grant.issue.cancelled',
    details: { txHash: 'old' },
  });
  const txHash = 'cd'.repeat(32);
  log.fail(plainError({ code: 'UserCancelled', txHash, grantId: 'ab'.repeat(32) }, ''));
  const operation = operationForRun(log, run, 1000);
  assert.equal(operation.phase, 'unknown');
  assert.equal(operation.references.transactionId, txHash);
});
