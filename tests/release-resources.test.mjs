import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawn } from 'node:child_process';
import {
  mkdtempSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ResourceOwner, claimReleaseLease } from '../scripts/release/resources.mjs';
import { mountedInterval } from '../scripts/release/mounted-interval.mjs';
import { freshRoot, saveJournal } from '../scripts/release/files.mjs';
import { isolatedProcesses } from '../scripts/qualification/native-isolation-control.mjs';
import { FakeDocker } from './fixtures/release-docker.mjs';

const image = 'sha256:' + 'a'.repeat(64);
const runId = 'a'.repeat(16);
function setup() {
  const docker = new FakeDocker();
  /** @type {unknown[]} */ const writes = [];
  const owner = new ResourceOwner(runId, docker.run, () =>
    writes.push(structuredClone({ pending: owner.pending, resources: owner.resources })),
  );
  const create = () => owner.create('container', 'passport-test-helper', [image], image);
  return { owner, docker, writes, create };
}

test('lost create reply persists intent, blocks all helpers/volumes and reconciles only owned exact object', () => {
  const { owner, docker, create, writes } = setup();
  docker.fault = 'create';
  assert.throws(create, /Lost create reply/);
  assert.deepEqual(writes[0], {
    pending: { kind: 'container', name: 'passport-test-helper', image },
    resources: [],
  });
  assert.throws(() => owner.create('volume', 'passport-another', []), /Unresolved allocation/);
  assert.equal(owner.cleanup(), false);
  const row = owner.reconcile();
  assert.equal(owner.pending, null);
  assert.equal(row.name, 'passport-test-helper');
  assert.equal(owner.cleanup(), true);
  assert.equal(owner.resources.length, 1);
});

test('not-found cannot clear a still-in-flight create; late side effect remains discoverable', () => {
  const { owner, docker, create } = setup();
  docker.late = true;
  assert.throws(create, /pending/);
  assert.throws(() => owner.reconcile());
  assert.ok(owner.pending);
  assert.equal(owner.cleanup(), false);
  docker.pendingEffect?.();
  docker.late = false;
  const row = owner.reconcile();
  owner.start(row);
  assert.equal(owner.cleanup(), true);
});

test('uncertain helper start is recorded before dispatch and prevents new allocation until quiescence', () => {
  const { owner, docker, create, writes } = setup();
  const row = create();
  docker.fault = 'start';
  assert.throws(() => owner.start(row), /Lost start reply/);
  const last = /** @type {{resources:Array<{startAttempted:boolean,startConfirmed:boolean}>}} */ (
    writes.at(-1)
  );
  assert.equal(last.resources[0]?.startAttempted, true);
  assert.equal(last.resources[0]?.startConfirmed, false);
  assert.equal(docker.rows.get(row.name)?.State.Running, true);
  assert.throws(() => owner.create('volume', 'passport-new-state', []), /Unresolved start/);
  assert.equal(owner.cleanup(), true);
  assert.equal(docker.rows.get(row.name)?.State.Running, false);
  owner.create('volume', 'passport-new-state', []);
});

test('late start side effect cannot follow a falsely completed cleanup', () => {
  const { owner, docker, create } = setup();
  const row = create();
  docker.lateStart = true;
  assert.throws(() => owner.start(row), /still pending/);
  assert.equal(docker.rows.get(row.name)?.State.Running, false);
  assert.equal(owner.cleanup(), false, 'A pre-start snapshot does not resolve an in-flight start');
  assert.equal(row.startConfirmed, false);
  assert.throws(() => owner.start(row), /Unresolved start/);
  docker.pendingEffect?.();
  docker.lateStart = false;
  assert.equal(owner.cleanup(), true);
  assert.equal(docker.rows.get(row.name)?.State.Running, false);
});

for (const fault of ['stop', 'inspect'])
  test(`fresh cleanup ${fault} failure cannot reuse a prior stopped flag`, () => {
    const { owner, docker, create } = setup();
    const row = create();
    owner.start(row);
    assert.equal(owner.cleanup(), true);
    if (fault === 'stop') owner.start(row);
    docker.fault = fault;
    assert.equal(owner.cleanup(), false);
    assert.ok(owner.cleanupChecks.some((check) => !check.ok));
  });

test('unowned IDs, wrong images and substituted state volumes refuse before control', () => {
  const { owner, docker, create } = setup();
  const row = create();
  assert.throws(() => owner.stop({ ...row }), /not allocated/);
  const object = docker.rows.get(row.name);
  assert.ok(object);
  object.Image = 'sha256:' + 'b'.repeat(64);
  assert.throws(() => owner.start(row), /image changed/);
  assert.equal(docker.calls.filter((args) => args[0] === 'start').length, 0);
  const volume = owner.create('volume', 'passport-state', []),
    current = docker.rows.get(volume.name);
  assert.ok(current);
  current.CreatedAt = 'later';
  assert.equal(owner.cleanup(), false);
});

test('occupied evidence root and durable journal preserve earlier attempt bytes', () => {
  const parent = realpathSync(mkdtempSync(join(tmpdir(), 'release-evidence-'))),
    root = join(parent, 'attempt');
  try {
    freshRoot(root);
    saveJournal(root, { requestId: 'original', pending: 'create' });
    const before = readFileSync(join(root, 'journal.json'));
    assert.throws(() => freshRoot(root), /EEXIST/);
    assert.ok(before.equals(readFileSync(join(root, 'journal.json'))));
  } finally {
    rmSync(parent, { recursive: true });
  }
});

test('identical-content substituted lease is refused; original own lease releases only after quiescence', () => {
  const root = mkdtempSync(join(tmpdir(), 'release-lease-')),
    path = join(root, 'lease');
  const owner = { runId, pid: process.pid, project: 'test', root };
  try {
    const lease = claimReleaseLease(owner, path);
    assert.throws(() => lease.release(false), /retain/);
    writeFileSync(path + '.replacement', readFileSync(path), { mode: 0o600 });
    renameSync(path + '.replacement', path);
    assert.throws(() => lease.release(true), /substituted/);
    assert.ok(readFileSync(path).length > 0);
  } finally {
    rmSync(root, { recursive: true });
  }
});

/** @param {{drift?:string,cleanupFailure?:boolean,processFailure?:boolean,leaseFailure?:boolean,executeFailure?:boolean}} [options] */
async function interval(options = {}) {
  const { owner, docker, create } = setup();
  let capture = 0,
    released = false;
  /** @type {import('../scripts/release/mounted-interval.mjs').IntervalReceipt} */ const receipt = {
    verdict: 'IN_PROGRESS',
    functional: false,
    inputsUnchanged: false,
    quiescent: false,
    leaseReleased: false,
  };
  const base = {
    source: 'source',
    dist: 'dist',
    linuxDependencies: 'deps',
    reference: 'reference',
    streamedKeys: 'keys',
  };
  const run = mountedInterval({
    owner,
    receipt,
    save() {},
    verifyDaemon() {},
    stopProcesses: async () => !options.processFailure,
    capture: async () => {
      createHelper();
      return { ...base, ...(capture++ && options.drift ? { [options.drift]: 'changed' } : {}) };
    },
    execute: async () => {
      const row = create();
      owner.start(row);
      if (options.executeFailure) throw Error('partial setup');
      if (options.cleanupFailure) docker.fault = 'inspect';
      return { declaredCasesPassed: true };
    },
    releaseLease(ok) {
      assert.equal(ok, true);
      if (options.leaseFailure) throw Error('substituted');
      released = true;
    },
  });
  function createHelper() {
    const helper = owner.create('container', 'passport-fingerprint-' + capture, [image], image);
    owner.start(helper, { attach: true });
  }
  return { run, receipt, released: () => released, owner };
}

test('production coordinator includes final fingerprint helper cleanup before PASS/release', async () => {
  const state = await interval();
  assert.equal((await state.run).verdict, 'PASS');
  assert.equal(state.released(), true);
  assert.equal(state.owner.resources.length, 3);
  assert.ok(state.owner.cleanupChecks.every((row) => row.ok));
});
for (const drift of ['source', 'dist', 'linuxDependencies', 'reference', 'streamedKeys'])
  test(`production coordinator refuses ${drift} drift`, async () => {
    const state = await interval({ drift });
    await assert.rejects(state.run, /failed/);
    assert.equal(state.receipt.inputsUnchanged, false);
    assert.equal(state.receipt.verdict, 'FAIL');
    assert.equal(state.released(), false, 'Input drift retains the lease for reconciliation');
  });
for (const failure of ['cleanupFailure', 'processFailure', 'leaseFailure', 'executeFailure'])
  test(`production coordinator cannot pass after ${failure}`, async () => {
    const state = await interval({ [failure]: true });
    await assert.rejects(state.run, /failed/);
    assert.equal(state.receipt.verdict, 'FAIL');
    if (failure === 'cleanupFailure' || failure === 'processFailure')
      assert.equal(state.released(), false);
  });

test('actual owned subprocess is observed closed before coordinator cleanup may complete', async () => {
  const processes = isolatedProcesses();
  const child = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], {
    detached: true,
    stdio: 'ignore',
  });
  processes.register(child);
  const result = await processes.stop(8_000);
  assert.equal(result.incomplete, false);
  assert.equal(result.owned, 1);
  assert.notEqual(child.exitCode === null && child.signalCode === null, true);
});
