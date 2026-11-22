#!/usr/bin/env node
// Generate a private, independent Indexer API v4 credential file once.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import {
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  realpathSync,
  statSync,
  writeSync,
} from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const destination = process.argv[2];
if (!process.env.IN_NIX_SHELL || !destination || !isAbsolute(destination))
  throw new Error('Run through Nix with an absolute private env-file path.');
const path = resolve(destination);
assert.ok(!path.startsWith(`${root}/`), 'Keep witness credentials outside Git.');
const parent = dirname(path);
mkdirSync(parent, { recursive: true, mode: 0o700 });
assert.equal(realpathSync(parent), parent, 'Use a canonical private directory.');
const directory = statSync(parent);
assert.ok(
  directory.isDirectory() && (directory.mode & 0o077) === 0,
  'Private directory must be mode 0700.',
);
if (process.getuid)
  assert.equal(directory.uid, process.getuid(), 'Private directory owner differs.');

const keys = [
  'APP__INFRA__STORAGE__PASSWORD',
  'APP__INFRA__PUB_SUB__PASSWORD',
  'APP__INFRA__LEDGER_STATE_STORAGE__PASSWORD',
  'APP__INFRA__SECRET',
];
const contents = keys.map((key) => `${key}=${randomBytes(32).toString('hex')}\n`).join('');
const fd = openSync(path, 'wx', 0o600);
try {
  writeSync(fd, contents);
  fsyncSync(fd);
} finally {
  closeSync(fd);
}
console.log(`Created private witness credentials at ${path}. Keep them for the retained volume.`);
