// Immutable launch admission. Capabilities stay separate from identity records.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, realpathSync, lstatSync } from 'node:fs';
import { dirname, join, isAbsolute, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { nativeLeasePath } from '../qualification/native-lease.mjs';
import { put, sha256, privateDirectory, syncDirectory, object, exact, text } from './files.mjs';
import { readPrivate } from './process-files.mjs';
import { admitProcessIdentity } from './process-identity.mjs';

/** @typedef {{schema:1,runId:string,root:string,nonce:string,program:string,programSha256:string,worker:string,workerSha256:string,executable:string,controller:import('./process-identity.mjs').ProcessIdentity,controlDirectory:string,capabilitySha256:string}} ProcessLaunch */
/** @param {unknown} input @returns {ProcessLaunch} */
function admitLaunch(input) {
  const row = object(input);
  exact(row, [
    'schema',
    'runId',
    'root',
    'nonce',
    'program',
    'programSha256',
    'worker',
    'workerSha256',
    'executable',
    'controller',
    'controlDirectory',
    'capabilitySha256',
  ]);
  assert.equal(row.schema, 1);
  const path = (/** @type {unknown} */ value) => {
    const p = text(value, /^\/[^\r\n]{1,2048}$/);
    assert.ok(isAbsolute(p) && normalize(p) === p);
    return p;
  };
  return {
    schema: 1,
    runId: text(row.runId, /^[a-f0-9]{16}$/),
    root: path(row.root),
    nonce: text(row.nonce, /^[a-f0-9]{64}$/),
    program: path(row.program),
    programSha256: text(row.programSha256, /^[a-f0-9]{64}$/),
    worker: path(row.worker),
    workerSha256: text(row.workerSha256, /^[a-f0-9]{64}$/),
    executable: path(row.executable),
    controller: admitProcessIdentity(row.controller),
    controlDirectory: path(row.controlDirectory),
    capabilitySha256: text(row.capabilitySha256, /^[a-f0-9]{64}$/),
  };
}
/** @param {string} root @param {string} runId @param {string} program @param {import('./process-identity.mjs').ProcessIdentity} controller @param {string} [controlParent] */
export function prepareProcessLaunch(
  root,
  runId,
  program,
  controller,
  controlParent = dirname(nativeLeasePath()),
) {
  privateDirectory(root);
  privateDirectory(controlParent);
  const directory = join(root, 'client-process'),
    controlDirectory = join(controlParent, `ctrl-${runId}`);
  assert.ok(
    Buffer.byteLength(join(controlDirectory, 'c.sock')) <= 100,
    'Unix control path exceeds portable bound',
  );
  mkdirSync(directory, { mode: 0o700 });
  syncDirectory(root);
  mkdirSync(controlDirectory, { mode: 0o700 });
  syncDirectory(controlParent);
  const key = randomBytes(32);
  put(join(directory, 'capability.private'), key);
  const worker = fileURLToPath(new URL('./process-worker.mjs', import.meta.url));
  const launch = admitLaunch({
    schema: 1,
    runId,
    root,
    nonce: randomBytes(32).toString('hex'),
    program: realpathSync(program),
    programSha256: sha256(readFileSync(program)),
    worker: realpathSync(worker),
    workerSha256: sha256(readFileSync(worker)),
    executable: realpathSync(process.execPath),
    controller,
    controlDirectory,
    capabilitySha256: sha256(key),
  });
  const bytes = JSON.stringify(launch, null, 2) + '\n';
  put(join(directory, 'intent.json'), bytes);
  syncDirectory(directory);
  key.fill(0);
  return { directory, launch, launchSha256: sha256(bytes) };
}
/** Shutdown needs the original authenticated capability, not current program bytes.
 * @param {string} directory @param {string} expected @param {boolean} [execution] */
export function readProcessLaunch(directory, expected, execution = true) {
  text(expected, /^[a-f0-9]{64}$/);
  const admitted = readPrivate(join(directory, 'intent.json'));
  assert.equal(admitted.sha256, expected, 'Original process launch differs');
  const launch = admitLaunch(JSON.parse(admitted.bytes.toString('utf8')));
  assert.equal(join(launch.root, 'client-process'), directory);
  if (execution) {
    assert.equal(
      launch.worker,
      realpathSync(fileURLToPath(new URL('./process-worker.mjs', import.meta.url))),
    );
    assert.equal(sha256(readFileSync(launch.worker)), launch.workerSha256);
    assert.equal(sha256(readFileSync(launch.program)), launch.programSha256);
    assert.equal(launch.executable, realpathSync(process.execPath));
  }
  assert.equal(realpathSync(launch.controlDirectory), launch.controlDirectory);
  privateDirectory(launch.controlDirectory);
  const capability = readPrivate(join(directory, 'capability.private'), 32);
  assert.equal(capability.bytes.length, 32);
  assert.equal(capability.sha256, launch.capabilitySha256);
  return { launch, key: capability.bytes, launchSha256: admitted.sha256 };
}
/** @param {ProcessLaunch} launch @param {{dev:number,ino:number}} expected */
export function admitControlSocket(launch, expected) {
  const path = join(launch.controlDirectory, 'c.sock'),
    stat = lstatSync(path);
  assert.ok(stat.isSocket() && !stat.isSymbolicLink() && (stat.mode & 0o077) === 0);
  if (process.getuid) assert.equal(stat.uid, process.getuid());
  assert.equal(stat.dev, expected.dev);
  assert.equal(stat.ino, expected.ino);
  return path;
}
