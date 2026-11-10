// Observational process identity. Never authorizes an OS PID/PGID signal.
import assert from 'node:assert/strict';
import { readFileSync, readlinkSync } from 'node:fs';
import { command } from './process.mjs';
import { sha256, object, exact, text } from './files.mjs';

/** @typedef {{platform:'linux'|'darwin',pid:number,uid:number,pgid:number,start:string,boot:string,executable:string,commandSha256:string,state:string}} ProcessIdentity */
/** @param {unknown} input @returns {ProcessIdentity} */
export function admitProcessIdentity(input) {
  const row = object(input);
  exact(row, [
    'platform',
    'pid',
    'uid',
    'pgid',
    'start',
    'boot',
    'executable',
    'commandSha256',
    'state',
  ]);
  const platform = row.platform;
  assert.ok(platform === 'linux' || platform === 'darwin');
  for (const field of ['pid', 'uid', 'pgid'])
    assert.ok(
      typeof row[field] === 'number' &&
        Number.isSafeInteger(row[field]) &&
        Number(row[field]) >= (field === 'uid' ? 0 : 2),
    );
  return {
    platform,
    pid: Number(row.pid),
    uid: Number(row.uid),
    pgid: Number(row.pgid),
    start: text(row.start, /^[^\r\n]{1,128}$/),
    boot: text(row.boot, /^[a-f0-9-]{0,36}$/),
    executable: text(row.executable, /^[^\r\n]{1,2048}$/),
    commandSha256: text(row.commandSha256, /^[a-f0-9]{64}$/),
    state: text(row.state, /^[A-Za-z+<NsLWXsl-]{1,16}$/),
  };
}
/** @param {string} stat */
function linuxStat(stat) {
  const close = stat.lastIndexOf(')');
  assert.ok(close > 0);
  const fields = stat
    .slice(close + 2)
    .trim()
    .split(/\s+/);
  assert.ok(fields.length >= 20);
  const pgid = Number(fields[2]),
    start = fields[19],
    state = fields[0];
  assert.ok(Number.isSafeInteger(pgid) && pgid > 0 && start && /^\d+$/.test(start) && state);
  return { pgid, start, state };
}
/** @param {number} pid @returns {ProcessIdentity|null} */
function linuxIdentity(pid) {
  const boot = readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim();
  assert.match(boot, /^[a-f0-9-]{36}$/);
  try {
    const first = linuxStat(readFileSync(`/proc/${pid}/stat`, 'utf8'));
    const status = readFileSync(`/proc/${pid}/status`, 'utf8');
    const uid = Number(status.match(/^Uid:\s+(\d+)/m)?.[1]);
    assert.ok(Number.isSafeInteger(uid) && uid >= 0);
    // Zombie processes cannot compute; /proc no longer exposes their executable.
    const executable = first.state === 'Z' ? '' : readlinkSync(`/proc/${pid}/exe`);
    const args = readFileSync(`/proc/${pid}/cmdline`);
    const second = linuxStat(readFileSync(`/proc/${pid}/stat`, 'utf8'));
    assert.equal(second.start, first.start, 'Process changed during observation');
    return {
      platform: 'linux',
      pid,
      uid,
      pgid: first.pgid,
      start: first.start,
      state: second.state,
      boot,
      executable,
      commandSha256: sha256(args),
    };
  } catch (error) {
    if (/** @type {NodeJS.ErrnoException} */ (error).code === 'ENOENT') return null;
    throw error;
  }
}
/** @param {number} pid @returns {ProcessIdentity|null} */
function darwinIdentity(pid) {
  const result = command(
    'ps',
    ['-p', String(pid), '-o', 'pid=,pgid=,uid=,lstart=,stat=,comm=,args='],
    { timeout: 3_000, allowFailure: true },
  );
  if (result.status === 1 && !result.stdout.trim() && !result.stderr.trim()) return null;
  assert.equal(result.status, 0, 'Process observation failed');
  const row = result.stdout
    .trim()
    .match(
      /^(\d+)\s+(\d+)\s+(\d+)\s+([A-Za-z]{3}\s+[A-Za-z]{3}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2}\s+\d{4})\s+(\S+)\s+(\S+)\s+(.+)$/,
    );
  assert.ok(row, 'Unsupported ps identity');
  const [pidText, group, user, start, state, executable, args] = row.slice(1);
  assert.ok(start && state && executable && args && Number(pidText) === pid);
  return {
    platform: 'darwin',
    pid,
    pgid: Number(group),
    uid: Number(user),
    start: start.replace(/\s+/g, ' '),
    state,
    executable,
    commandSha256: sha256(args),
    boot: '',
  };
}
/** @param {number} pid @returns {ProcessIdentity|null} */
export function observeProcess(pid) {
  assert.ok(Number.isSafeInteger(pid) && pid > 1);
  if (process.platform === 'linux') return linuxIdentity(pid);
  assert.equal(
    process.platform,
    'darwin',
    'Qualification process control supports Linux/macOS only',
  );
  return darwinIdentity(pid);
}
/** Kernel birth identity is separate from volatile state and zombie command erasure.
 * @param {ProcessIdentity} value */
export function birthIdentity(value) {
  return sha256(
    JSON.stringify({
      platform: value.platform,
      pid: value.pid,
      uid: value.uid,
      pgid: value.pgid,
      start: value.start,
      boot: value.boot,
    }),
  );
}
/** @param {ProcessIdentity} value */
export function processIdentityHash(value) {
  return sha256(
    JSON.stringify({
      birth: birthIdentity(value),
      executable: value.executable,
      commandSha256: value.commandSha256,
    }),
  );
}
/** @param {ProcessIdentity} original @param {typeof observeProcess} [observe] */
export function originalProcessAlive(original, observe = observeProcess) {
  const current = observe(original.pid);
  if (!current) return false;
  assert.equal(
    birthIdentity(current),
    birthIdentity(original),
    'PID was reused; never control its replacement',
  );
  if (current.state.startsWith('Z')) return false;
  assert.equal(
    processIdentityHash(current),
    processIdentityHash(original),
    'Process command changed',
  );
  return true;
}
/** @param {ProcessIdentity} original */
export function groupQuiescent(original) {
  const result = command('ps', ['-A', '-o', 'pid=,pgid=,uid=,stat='], { timeout: 3_000 });
  return result.stdout
    .trim()
    .split('\n')
    .filter(Boolean)
    .every((line) => {
      const row = line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(\S+)$/);
      assert.ok(row, 'Process group observation failed');
      return (
        Number(row[2]) !== original.pgid ||
        (Number(row[1]) === original.pid && String(row[4]).startsWith('Z'))
      );
    });
}
