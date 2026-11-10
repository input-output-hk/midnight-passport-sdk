import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  realpathSync,
  readFileSync,
  writeFileSync,
  renameSync,
  existsSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import {
  ResourceOwner,
  claimReleaseLease,
  releaseRecordedLease,
} from '../scripts/release/resources.mjs';
import { reconciliationInterval } from '../scripts/release/reconcile-interval.mjs';
import { admitMountedJournal } from '../scripts/release/reconcile-record.mjs';
import { reconcileMounted } from '../scripts/release/reconcile.mjs';
import { observeProcess } from '../scripts/release/process-identity.mjs';
import { claimReconciliation } from '../scripts/release/reconcile-claim.mjs';
import { saveJournal, sha256 } from '../scripts/release/files.mjs';
import { FakeDocker } from './fixtures/release-docker.mjs';

const runId = 'b'.repeat(16),
  image = 'sha256:' + 'a'.repeat(64);

test('exclusive reconciliation claim remains after interruption and refuses replacement', () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'reconcile-claim-')));
  const controller = observeProcess(process.pid);
  assert.ok(controller);
  const lease = { dev: 1, ino: 2, sha256: 'c'.repeat(64) };
  const claim = claimReconciliation(root, 'a'.repeat(64), lease, controller);
  claim.verify();
  assert.throws(() => claimReconciliation(root, 'a'.repeat(64), lease, controller), /EEXIST/);
  const path = join(claim.path, 'claim.json');
  writeFileSync(path + '.replacement', readFileSync(path), { mode: 0o600 });
  renameSync(path + '.replacement', path);
  assert.throws(claim.verify);
  assert.equal(existsSync(claim.path), true);
});

test('a SIGKILLed reconciler leaves its exclusive claim and original journal intact', () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'reconcile-killed-')));
  writeFileSync(join(root, 'journal.json'), 'original interrupted run\n', { mode: 0o600 });
  const claimModule = new URL('../scripts/release/reconcile-claim.mjs', import.meta.url).href;
  const identityModule = new URL('../scripts/release/process-identity.mjs', import.meta.url).href;
  const script = `import {claimReconciliation} from ${JSON.stringify(claimModule)};
    import {observeProcess} from ${JSON.stringify(identityModule)};
    claimReconciliation(process.argv[1], 'a'.repeat(64), {dev:1,ino:2,sha256:'c'.repeat(64)}, observeProcess(process.pid));
    process.kill(process.pid, 'SIGKILL');`;
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', script, root], {
    timeout: 5000,
    encoding: 'utf8',
  });
  assert.equal(child.signal, 'SIGKILL');
  assert.equal(readFileSync(join(root, 'journal.json'), 'utf8'), 'original interrupted run\n');
  const controller = observeProcess(process.pid);
  assert.ok(controller);
  assert.throws(
    () =>
      claimReconciliation(
        root,
        'a'.repeat(64),
        { dev: 1, ino: 2, sha256: 'c'.repeat(64) },
        controller,
      ),
    /EEXIST/,
  );
  assert.equal(existsSync(join(root, 'reconciliation', 'claim.json')), true);
});
/** @param {string} variant */
function scenario(variant) {
  const docker = new FakeDocker();
  /** @type {unknown[]} */ const writes = [];
  const owner = new ResourceOwner(runId, docker.run, () =>
    writes.push(structuredClone({ resources: owner.resources, pending: owner.pending })),
  );
  const row = owner.create('container', `passport-${runId}-service`, [image], image);
  owner.start(row);
  if (variant === 'lost-create' || variant === 'late-create') {
    if (variant === 'lost-create') docker.fault = 'create';
    else docker.late = true;
    assert.throws(() => owner.create('container', `passport-${runId}-late`, [image], image));
  }
  if (variant === 'late-start') {
    const pending = owner.create('container', `passport-${runId}-late-start`, [image], image);
    docker.lateStart = true;
    assert.throws(() => owner.start(pending));
  }
  /** @type {import('../scripts/release/reconcile-interval.mjs').ReconcileReceipt} */
  const receipt = {
    verdict: 'IN_PROGRESS',
    functional: false,
    clientClosed: false,
    quiescent: false,
    inputsUnchanged: false,
    leaseReleased: false,
    before:
      variant === 'no-before'
        ? undefined
        : { source: 'fixed', dist: 'fixed', keys: 'fixed', linux: 'fixed' },
  };
  let released = false,
    captured = 0;
  const execute = () =>
    reconciliationInterval({
      owner,
      receipt,
      verify: () => {
        if (variant === 'daemon-mismatch') throw Error('Daemon changed');
      },
      closeClient: async () => {
        if (variant === 'process-inspection-failed') throw Error('Identity unknown');
        return variant !== 'client-unresponsive';
      },
      capture: async () => {
        captured++;
        const helper = owner.create(
          'container',
          `passport-${runId}-reconcile-helper`,
          [image],
          image,
        );
        owner.start(helper);
        if (variant === 'final-helper-stop-failed') docker.fault = 'stop';
        if (variant === 'capture-failed') throw Error('Input hash failed');
        return {
          source: 'fixed',
          dist: variant === 'drift' ? 'changed' : 'fixed',
          keys: 'fixed',
          linux: 'fixed',
        };
      },
      releaseLease: (safe) => {
        assert.equal(safe, true);
        if (variant === 'lease-substituted') throw Error('Wrong lease');
        released = true;
      },
      save: () => {
        writes.push(structuredClone(receipt));
      },
    });
  return {
    docker,
    owner,
    receipt,
    writes,
    execute,
    released: () => released,
    captured: () => captured,
  };
}

for (const variant of [
  'success',
  'lost-create',
  'client-unresponsive',
  'process-inspection-failed',
  'daemon-mismatch',
  'no-before',
  'capture-failed',
  'drift',
  'final-helper-stop-failed',
  'lease-substituted',
  'late-create',
  'late-start',
])
  test(`interruption reconciliation is conjunctive and never functional PASS: ${variant}`, async () => {
    const run = scenario(variant);
    if (['success', 'lost-create'].includes(variant)) {
      assert.equal((await run.execute()).verdict, 'RECONCILED_INTERRUPTION');
      assert.equal(run.released(), true);
      assert.equal(run.receipt.inputsUnchanged, true);
      assert.ok([...run.docker.rows.values()].every((row) => !row.State.Running));
    } else {
      await assert.rejects(run.execute(), /preserve every record/);
      assert.equal(run.released(), false);
      assert.equal(run.receipt.verdict, 'FAIL');
      if (
        [
          'client-unresponsive',
          'process-inspection-failed',
          'daemon-mismatch',
          'no-before',
          'late-create',
          'late-start',
        ].includes(variant)
      )
        assert.equal(run.captured(), 0);
      if (['client-unresponsive', 'process-inspection-failed'].includes(variant))
        assert.ok([...run.docker.rows.values()].every((row) => !row.State.Running));
      if (variant === 'late-create' || variant === 'late-start') {
        assert.ok(run.docker.pendingEffect);
        run.docker.pendingEffect();
        assert.ok(
          run.owner.pending !== null || run.owner.resources.some((row) => !row.startConfirmed),
        );
      }
    }
    assert.equal(run.receipt.functional, false);
    assert.notEqual(run.receipt.verdict, 'PASS');
    assert.ok(run.writes.length > 0);
  });

test('original acquisition pin refuses same-content replacement without deleting the replacement', () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'reconcile-lease-'))),
    path = join(root, 'lease');
  const owner = { runId, pid: process.pid, root, project: 'synthetic' };
  const lease = claimReleaseLease(owner, path);
  assert.throws(() => releaseRecordedLease(owner, lease.identity, false, path));
  writeFileSync(path + '.replacement', readFileSync(path), { mode: 0o600 });
  renameSync(path + '.replacement', path);
  assert.throws(() => releaseRecordedLease(owner, lease.identity, true, path), /inode/);
  assert.equal(existsSync(path), true);
});

/** @param {string} variant */
function journalFixture(variant) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'reconcile-journal-')));
  const example = JSON.parse(
    readFileSync(new URL('../scripts/release/mounted-plan.example.json', import.meta.url), 'utf8'),
  );
  const { schemaVersion: _schemaVersion, ...plan } = example;
  plan.contract = root;
  const controller = observeProcess(process.pid);
  assert.ok(controller);
  /** @type {Record<string,unknown>} */
  const journal = {
    schema: 2,
    kind: 'mounted-production-source-client',
    runId,
    project: `mn-passport-joblife-${runId}`,
    plan,
    daemonId: 'synthetic',
    endpoint: 'unix:///synthetic/docker.sock',
    dependencyVolume: { name: plan.linuxDependencies.volume, createdAt: '2026-11-10T00:00:00Z' },
    controller,
    leaseIdentity: { dev: 1, ino: 1, sha256: 'a'.repeat(64) },
    clientLaunch: null,
    resources: [],
    pending: null,
    cleanup: [],
    operations: [],
    receipt: { verdict: 'IN_PROGRESS', functional: false, before: { source: 'fixed' } },
  };
  if (variant === 'legacy') journal.schema = 1;
  if (variant === 'extra') journal.cleanupCommand = 'must never execute';
  if (variant === 'wrong-project') journal.project = 'someone-else';
  if (variant === 'completed') journal.receipt = { verdict: 'PASS' };
  if (variant === 'foreign-client')
    journal.clientLaunch = { directory: '/foreign/client-process', launchSha256: 'a'.repeat(64) };
  if (variant === 'foreign-resource')
    journal.pending = { kind: 'container', name: 'someone-else', image };
  if (variant === 'invalid-lease') journal.leaseIdentity = { dev: 1, ino: 1 };
  if (variant === 'duplicate-resource') {
    const row = {
      kind: 'container',
      name: `passport-${runId}-helper`,
      image,
      id: 'a'.repeat(64),
      createdAt: '',
      startAttempted: false,
      startConfirmed: true,
      startBaseline: '',
    };
    journal.resources = [row, { ...row }];
  }
  saveJournal(root, journal);
  return { root, expected: sha256(readFileSync(join(root, 'journal.json'))) };
}
for (const variant of [
  'valid',
  'legacy',
  'extra',
  'wrong-project',
  'completed',
  'foreign-client',
  'foreign-resource',
  'invalid-lease',
  'duplicate-resource',
])
  test(`original mounted journal is closed and independently pinned: ${variant}`, () => {
    const { root, expected } = journalFixture(variant);
    const before = readFileSync(join(root, 'journal.json'));
    if (variant === 'valid') assert.equal(admitMountedJournal(root, expected).runId, runId);
    else assert.throws(() => admitMountedJournal(root, expected));
    assert.throws(() => admitMountedJournal(root, 'f'.repeat(64)));
    assert.deepEqual(readFileSync(join(root, 'journal.json')), before);
    assert.equal(existsSync(join(root, 'reconciliation')), false);
  });

test('a live original controller refuses before Docker or a reconciliation claim', async () => {
  const { root, expected } = journalFixture('valid');
  await assert.rejects(
    reconcileMounted(root, expected, {
      IN_NIX_SHELL: 'test',
      PASSPORT_RECONCILE_MOUNTED: '1',
      PASSPORT_RC_LOCALNET: '1',
      MN_NETWORK_ID: 'undeployed',
    }),
    /still live/,
  );
  assert.equal(existsSync(join(root, 'reconciliation')), false);
});
