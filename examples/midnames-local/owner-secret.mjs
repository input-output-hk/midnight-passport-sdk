// Private, persistent naming authority for the standalone local claim fixture.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import {
  closeSync,
  constants,
  fstatSync,
  fsyncSync,
  lstatSync,
  openSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, isAbsolute, join } from 'node:path';

/** @param {string} path */
export function loadOrCreateOwnerSecret(path, { create = true } = {}) {
  assert.ok(isAbsolute(path), 'Use an absolute naming-secret path.');
  const parent = realpathSync(dirname(path));
  assert.equal(join(parent, basename(path)), path, 'Use a canonical private path.');
  const directory = lstatSync(parent);
  assert.ok(directory.isDirectory() && !directory.isSymbolicLink());
  assert.equal(directory.mode & 0o077, 0, 'Naming-secret directory must be private.');
  if (process.getuid) assert.equal(directory.uid, process.getuid());

  let created = false;
  let fd;
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
    if (!create) throw new Error('Existing owner secret required.');
    const secret = randomBytes(32);
    try {
      fd = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
      writeFileSync(fd, secret);
      fsyncSync(fd);
      created = true;
    } finally {
      secret.fill(0);
      if (fd !== undefined) closeSync(fd);
    }
    const parentFd = openSync(parent, constants.O_RDONLY);
    try {
      fsyncSync(parentFd);
    } finally {
      closeSync(parentFd);
    }
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  }
  try {
    const stat = fstatSync(fd);
    assert.ok(stat.isFile() && stat.nlink === 1 && stat.size === 32);
    assert.equal(stat.mode & 0o077, 0, 'Naming secret must be mode 0600.');
    if (process.getuid) assert.equal(stat.uid, process.getuid());
    const current = lstatSync(path);
    assert.ok(current.isFile() && !current.isSymbolicLink());
    assert.equal(current.dev, stat.dev);
    assert.equal(current.ino, stat.ino);
    return { secret: new Uint8Array(readFileSync(fd)), created };
  } finally {
    closeSync(fd);
  }
}
