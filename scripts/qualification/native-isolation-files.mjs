// Private owned native evidence and exclusive stable lease operations.
import assert from 'node:assert/strict';
import {
  constants,
  openSync,
  closeSync,
  writeFileSync,
  fsyncSync,
  renameSync,
  lstatSync,
  fstatSync,
  readFileSync,
  unlinkSync,
} from 'node:fs';
import { dirname } from 'node:path';
/** @typedef {{runId:string,pid:number,project:string,root:string}} IsolationLeaseOwner */
/** @param {string} path @param {unknown} value */
export function saveIsolationReceipt(path, value) {
  const temporary = path + `.pending-${process.pid}`;
  const fd = openSync(temporary, 'wx', 0o600);
  try {
    writeFileSync(fd, JSON.stringify(value, null, 2) + '\n');
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(temporary, path);
  const directory = openSync(dirname(path), 'r');
  try {
    fsyncSync(directory);
  } finally {
    closeSync(directory);
  }
}
/** @param {string} path @param {IsolationLeaseOwner} owner */
export function claimIsolationLease(path, owner) {
  const fd = openSync(path, 'wx', 0o600);
  try {
    writeFileSync(fd, JSON.stringify(owner));
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}
/** Never clear a stale, substituted or still-active lease.
 * @param {string} path @param {IsolationLeaseOwner} owner @param {boolean} quiescent */
export function releaseIsolationLease(path, owner, quiescent) {
  assert.equal(quiescent, true, 'Unresolved resources retain their lease');
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = fstatSync(fd);
    assert.ok(stat.isFile() && stat.nlink === 1 && (stat.mode & 0o077) === 0 && stat.size <= 4096);
    if (process.getuid) assert.equal(stat.uid, process.getuid());
    assert.deepEqual(JSON.parse(readFileSync(fd, 'utf8')), owner, 'Different native lease owner');
    const current = lstatSync(path);
    assert.ok(
      current.isFile() &&
        !current.isSymbolicLink() &&
        current.dev === stat.dev &&
        current.ino === stat.ino,
    );
    unlinkSync(path);
  } finally {
    closeSync(fd);
  }
}
