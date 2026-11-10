import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { randomBytes } from 'node:crypto';
import {
  mkdtempSync,
  mkdirSync,
  realpathSync,
  readFileSync,
  existsSync,
  writeFileSync,
  chmodSync,
} from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { sourceProcess } from '../scripts/release/process-client.mjs';
import {
  prepareProcessLaunch,
  readProcessLaunch,
  admitControlSocket,
} from '../scripts/release/process-launch.mjs';
import {
  observeProcess,
  originalProcessAlive,
  birthIdentity,
  groupQuiescent,
} from '../scripts/release/process-identity.mjs';
import { processRecord } from '../scripts/release/process-record.mjs';
import { closeRecordedProcess } from '../scripts/release/process-close.mjs';
import {
  processRequest,
  processProof,
  admitProcessMessage,
} from '../scripts/release/process-protocol.mjs';
import { put, syncDirectory } from '../scripts/release/files.mjs';

const program = fileURLToPath(new URL('./fixtures/process-source.mjs', import.meta.url));
function environment(/** @type {string} */ root, mode = 'wait') {
  return {
    ...process.env,
    PASSPORT_PROCESS_FIXTURE_ROOT: root,
    PASSPORT_PROCESS_FIXTURE_MODE: mode,
  };
}
async function wait(/** @type {()=>boolean} */ predicate) {
  const end = performance.now() + 5_000;
  while (!predicate() && performance.now() < end) await delay(10);
  assert.equal(predicate(), true, 'Owned process deadline expired');
}
/** @param {import('node:test').TestContext} t */
function rootFor(t) {
  assert.ok(t.name);
  const root = mkdtempSync(join(realpathSync('/tmp'), 'mpc-'));
  mkdirSync(join(root, 'ctl'), { mode: 0o700 });
  // Preserve private process/failed-operation records; later hooks must observe
  // worker closure before metadata can be considered disposable.
  return root;
}
/** @param {import('node:test').TestContext} t @param {string} root */
async function readyWorker(t, root) {
  const controller = observeProcess(process.pid);
  assert.ok(controller);
  const prepared = prepareProcessLaunch(
    root,
    'b'.repeat(16),
    program,
    controller,
    join(root, 'ctl'),
  );
  const child = spawn(
    prepared.launch.executable,
    [prepared.launch.worker, '--intent', prepared.directory, '--sha256', prepared.launchSha256],
    { env: environment(root), detached: true, stdio: 'ignore' },
  );
  let closed = false;
  child.once('close', () => {
    closed = true;
  });
  t.after(async () => {
    if (!closed)
      assert.equal(
        (await closeRecordedProcess(prepared.directory, prepared.launchSha256)).closed,
        true,
      );
    await wait(() => closed);
  });
  await wait(
    () =>
      existsSync(join(prepared.directory, 'record.json')) &&
      processRecord(prepared.directory, prepared.launchSha256).phase === 'ready',
  );
  return { ...prepared, child };
}

test('own observation is stable and reused/changed identities never authorize control', () => {
  const current = observeProcess(process.pid);
  assert.ok(current);
  assert.equal(originalProcessAlive(current), true);
  assert.equal(
    originalProcessAlive(current, () => null),
    false,
  );
  assert.equal(
    originalProcessAlive(current, () => ({ ...current, state: 'Z' })),
    false,
  );
  assert.throws(
    () => originalProcessAlive(current, () => ({ ...current, start: current.start + 'different' })),
    /reused/,
  );
  assert.throws(
    () => originalProcessAlive(current, () => ({ ...current, commandSha256: 'a'.repeat(64) })),
    /command/,
  );
  assert.notEqual(birthIdentity(current), birthIdentity({ ...current, boot: 'different' }));
});

test('control authenticates domain, operation, launch, birth identity and fresh challenge', () => {
  const key = randomBytes(32),
    request = {
      schema: 1,
      action: 'go',
      challenge: 'a'.repeat(64),
      launch: 'b'.repeat(64),
      identity: 'c'.repeat(64),
    };
  const signed = { ...request, proof: processProof(key, 'request', request) };
  assert.equal(admitProcessMessage(key, 'request', signed).action, 'go');
  for (const changed of [
    { ...signed, action: 'shutdown' },
    { ...signed, launch: 'd'.repeat(64) },
    { ...signed, identity: 'd'.repeat(64) },
    { ...signed, challenge: 'd'.repeat(64) },
    { ...signed, extra: 'field' },
  ])
    assert.throws(() => admitProcessMessage(key, 'request', changed));
  assert.throws(() => admitProcessMessage(key, 'reply', { ...signed, phase: 'ready' }));
  key.fill(0);
});

test('worker-ready is not GO; missing durable admission cannot import the client', async (t) => {
  const root = rootFor(t),
    prepared = await readyWorker(t, root);
  const { launch, key } = readProcessLaunch(prepared.directory, prepared.launchSha256);
  t.after(() => key.fill(0));
  const record = processRecord(prepared.directory, prepared.launchSha256);
  assert.ok(record.socket);
  const path = admitControlSocket(launch, record.socket);
  assert.equal(
    (await processRequest(path, key, prepared.launchSha256, record.identitySha256, 'status')).phase,
    'ready',
  );
  await assert.rejects(
    processRequest(path, key, prepared.launchSha256, record.identitySha256, 'go'),
  );
  assert.equal(existsSync(join(root, 'dispatch.log')), false);
  put(
    join(prepared.directory, 'go-intent.json'),
    JSON.stringify({ launchSha256: prepared.launchSha256, identitySha256: record.identitySha256 }) +
      '\n',
  );
  syncDirectory(prepared.directory);
  assert.equal(
    (await processRequest(path, key, prepared.launchSha256, record.identitySha256, 'go')).phase,
    'admitted',
  );
  await wait(() => existsSync(join(root, 'dispatch.log')));
  await assert.rejects(
    processRequest(path, key, prepared.launchSha256, record.identitySha256, 'go'),
  );
  assert.equal(readFileSync(join(root, 'dispatch.log'), 'utf8'), 'dispatch\n');
  const metadata = readFileSync(join(prepared.directory, 'record.json'), 'utf8');
  assert.equal(metadata.includes(key.toString('hex')), false);
  assert.equal(metadata.includes('proof'), false);
});

for (const mode of ['finish', 'wait', 'busy'])
  test(`source controller owns normal/explicit closure: ${mode}`, async (t) => {
    const root = rootFor(t),
      controller = observeProcess(process.pid);
    assert.ok(controller);
    const client = sourceProcess({
      root,
      runId: 'c'.repeat(16),
      program,
      controller,
      env: environment(root, mode),
      check: () => {},
      onLaunch: () => {},
      controlParent: join(root, 'ctl'),
    });
    t.after(async () => {
      if (client.reference) assert.equal(await client.stop(), true);
    });
    await client.start();
    await wait(() => existsSync(join(root, 'dispatch.log')));
    const ref = client.reference;
    assert.ok(ref);
    if (mode === 'finish') {
      await wait(() => client.closed);
      assert.equal(client.exit, 0);
    } else if (mode === 'busy') {
      await wait(() => existsSync(join(root, 'dispatch.log')));
      assert.equal((await closeRecordedProcess(ref.directory, ref.launchSha256, 40)).closed, false);
    }
    assert.equal(await client.stop(), true);
    await wait(() => client.closed);
    assert.equal(readFileSync(join(root, 'dispatch.log'), 'utf8'), 'dispatch\n');
    await assert.rejects(client.start(), /only once/);
  });

for (const mode of ['no-go', 'admitted', 'before-claim', 'before-record', 'lost-go-ack'])
  test(`parent SIGKILL keeps original worker recoverable without replay: ${mode}`, async (t) => {
    const root = rootFor(t);
    const parent = spawn(
      process.execPath,
      [fileURLToPath(new URL('./fixtures/process-parent.mjs', import.meta.url))],
      {
        env: { ...environment(root), PASSPORT_PROCESS_PARENT_MODE: mode },
        detached: true,
        stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
      },
    );
    let ready = false,
      closed = false;
    parent.on('message', (value) => {
      ready = value === 'ready';
    });
    const exit = new Promise((resolve) =>
      parent.once('close', (code, signal) => {
        closed = true;
        resolve({ code, signal });
      }),
    );
    t.after(async () => {
      if (!closed) {
        parent.send('kill-self');
        await exit;
      }
      if (existsSync(join(root, 'reference.json'))) {
        const r = JSON.parse(readFileSync(join(root, 'reference.json'), 'utf8'));
        assert.equal((await closeRecordedProcess(r.directory, r.launchSha256)).closed, true);
      }
    });
    await wait(() => ready);
    const reference = JSON.parse(readFileSync(join(root, 'reference.json'), 'utf8'));
    if (mode === 'before-claim' || mode === 'before-record') {
      const boundary = JSON.parse(readFileSync(join(root, 'early-boundary.json'), 'utf8'));
      assert.equal(boundary.record, false);
      assert.equal(boundary.claim, mode === 'before-record');
    }
    if (mode === 'admitted') await wait(() => existsSync(join(root, 'dispatch.log')));
    parent.send('kill-self');
    assert.deepEqual(await exit, { code: null, signal: 'SIGKILL' });
    if (mode === 'before-claim' || mode === 'before-record') {
      const closing = closeRecordedProcess(reference.directory, reference.launchSha256);
      await delay(100);
      writeFileSync(join(root, 'release-startup'), 'release');
      assert.equal((await closing).closed, true);
      assert.equal(existsSync(join(root, 'dispatch.log')), false);
      return;
    }
    const record = processRecord(reference.directory, reference.launchSha256);
    assert.equal(originalProcessAlive(record.identity), true);
    const result = await closeRecordedProcess(reference.directory, reference.launchSha256);
    assert.equal(result.closed, true);
    assert.equal(result.externalSignals, 0);
    assert.equal(groupQuiescent(record.identity), true);
    if (mode === 'lost-go-ack') {
      assert.equal(existsSync(join(reference.directory, 'go-ack.json')), false);
      const calls = existsSync(join(root, 'dispatch.log'))
        ? readFileSync(join(root, 'dispatch.log'), 'utf8')
        : '';
      assert.ok(calls === '' || calls === 'dispatch\n');
    } else
      assert.equal(
        mode === 'no-go'
          ? existsSync(join(root, 'dispatch.log'))
          : readFileSync(join(root, 'dispatch.log'), 'utf8'),
        mode === 'no-go' ? false : 'dispatch\n',
      );
  });

test('identity/capability/file substitutions refuse control while retaining original intent', async (t) => {
  const root = rootFor(t),
    prepared = await readyWorker(t, root),
    path = join(prepared.directory, 'record.json');
  const original = readFileSync(path),
    record = JSON.parse(original.toString('utf8'));
  record.identity.commandSha256 = 'd'.repeat(64);
  writeFileSync(path, JSON.stringify(record));
  await assert.rejects(closeRecordedProcess(prepared.directory, prepared.launchSha256), /replaced/);
  writeFileSync(path, original);
  const capability = join(prepared.directory, 'capability.private');
  chmodSync(capability, 0o644);
  await assert.rejects(closeRecordedProcess(prepared.directory, prepared.launchSha256));
  chmodSync(capability, 0o600);
  await assert.rejects(closeRecordedProcess(prepared.directory, 'e'.repeat(64)));
  assert.equal(existsSync(join(root, 'dispatch.log')), false);
});

test('closing intent and unknown group members cannot be reported as quiescence', async (t) => {
  const root = rootFor(t),
    controller = observeProcess(process.pid);
  assert.ok(controller);
  const client = sourceProcess({
    root,
    runId: 'd'.repeat(16),
    program,
    controller,
    env: environment(root, 'descendant'),
    check: () => {},
    onLaunch: () => {},
    controlParent: join(root, 'ctl'),
  });
  t.after(async () => {
    await delay(800);
    assert.equal(await client.stop(), true);
  });
  await client.start();
  await wait(() => existsSync(join(root, 'dispatch.log')));
  await delay(50);
  const reference = client.reference;
  assert.ok(reference);
  assert.equal(
    (await closeRecordedProcess(reference.directory, reference.launchSha256, 100)).closed,
    false,
  );
});

test('reflected request MAC is not an authenticated reply', async (t) => {
  const root = rootFor(t),
    path = join(root, 'reflection.sock'),
    server = createServer((socket) =>
      socket.once('data', (bytes) => {
        const request = JSON.parse(bytes.toString());
        socket.end(JSON.stringify({ ...request, phase: 'ready' }) + '\n');
      }),
    );
  await new Promise((resolve) => server.listen(path, () => resolve(undefined)));
  t.after(() => new Promise((resolve) => server.close(() => resolve(undefined))));
  await assert.rejects(
    processRequest(path, randomBytes(32), 'a'.repeat(64), 'b'.repeat(64), 'status'),
  );
});

test('async controller persistence is awaited before any worker dispatch', async (t) => {
  const root = rootFor(t),
    controller = observeProcess(process.pid);
  assert.ok(controller);
  let release = () => {};
  /** @type {Promise<void>} */ const persisted = new Promise((resolve) => {
    release = () => resolve();
  });
  /** @type {import('../scripts/release/process-client.mjs').ProcessReference|undefined} */ let reference;
  const client = sourceProcess({
    root,
    runId: 'e'.repeat(16),
    program,
    controller,
    env: environment(root),
    check: () => {},
    onLaunch: async (value) => {
      reference = value;
      await persisted;
    },
    controlParent: join(root, 'ctl'),
  });
  t.after(async () => {
    release();
    await starting.catch(() => {});
    assert.equal(await client.stop(), true);
  });
  const starting = client.start();
  await wait(() => reference !== undefined);
  assert.ok(reference);
  assert.equal(existsSync(join(reference.directory, 'dispatch-pending.json')), false);
  assert.equal(existsSync(join(reference.directory, 'worker-claim.json')), false);
  assert.equal(existsSync(join(root, 'dispatch.log')), false);
  release();
  await starting;
});

test('failed controller journal persistence never dispatches a worker', async (t) => {
  const root = rootFor(t),
    controller = observeProcess(process.pid);
  assert.ok(controller);
  const client = sourceProcess({
    root,
    runId: 'f'.repeat(16),
    program,
    controller,
    env: environment(root),
    check: () => {},
    onLaunch: async () => {
      throw Error('journal fsync failed');
    },
    controlParent: join(root, 'ctl'),
  });
  await assert.rejects(client.start(), /journal fsync failed/);
  assert.equal(await client.stop(), true);
  assert.equal(existsSync(join(root, 'dispatch.log')), false);
  assert.equal(existsSync(join(root, 'client-process/dispatch-pending.json')), false);
});

test('worker bootstrap record-write failure cannot cross GO or become an unknown live PID', async (t) => {
  const root = rootFor(t),
    controller = observeProcess(process.pid);
  assert.ok(controller);
  const prepared = prepareProcessLaunch(
    root,
    '1'.repeat(16),
    program,
    controller,
    join(root, 'ctl'),
  );
  put(join(prepared.directory, 'record.next'), 'retained failed atomic write');
  const child = spawn(
    prepared.launch.executable,
    [prepared.launch.worker, '--intent', prepared.directory, '--sha256', prepared.launchSha256],
    { env: environment(root), detached: true, stdio: 'ignore' },
  );
  const code = await new Promise((resolve) => child.once('close', (exit) => resolve(exit)));
  assert.equal(code, 1);
  assert.equal(existsSync(join(root, 'dispatch.log')), false);
  assert.equal(existsSync(join(prepared.directory, 'record.json')), false);
  assert.equal(
    (await closeRecordedProcess(prepared.directory, prepared.launchSha256)).closed,
    true,
  );
});
