// A recorded exit request is not observed process closure.
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { object, text, exact } from './files.mjs';
import { readPrivate } from './process-files.mjs';
import { admitProcessIdentity, processIdentityHash } from './process-identity.mjs';

/** @param {string} directory @param {string} expected */
export function processRecord(directory, expected) {
  const value = object(
    JSON.parse(readPrivate(join(directory, 'record.json')).bytes.toString('utf8')),
  );
  const keys = ['schema', 'launchSha256', 'identity', 'phase', 'socket'];
  if (Object.hasOwn(value, 'requestedExitCode')) keys.push('requestedExitCode');
  exact(value, keys);
  assert.equal(value.schema, 1);
  assert.equal(value.launchSha256, expected);
  const identity = admitProcessIdentity(value.identity);
  assert.equal(identity.pid, identity.pgid, 'Worker must own its detached process group');
  const phase = text(value.phase, /^(?:starting|ready|admitted|finished|closing)$/);
  const socket = value.socket === null ? null : object(value.socket);
  if (socket) {
    exact(socket, ['dev', 'ino']);
    for (const key of ['dev', 'ino'])
      assert.ok(
        typeof socket[key] === 'number' &&
          Number.isInteger(socket[key]) &&
          Number(socket[key]) >= 0,
      );
  }
  if (Object.hasOwn(value, 'requestedExitCode'))
    assert.ok(
      Number.isInteger(value.requestedExitCode) &&
        Number(value.requestedExitCode) >= 0 &&
        Number(value.requestedExitCode) <= 255,
    );
  return {
    identity,
    identitySha256: processIdentityHash(identity),
    phase,
    socket: socket ? { dev: Number(socket.dev), ino: Number(socket.ino) } : null,
  };
}
/** @param {string} directory @param {string} expected */
export function processClaim(directory, expected) {
  const value = object(
    JSON.parse(readPrivate(join(directory, 'worker-claim.json')).bytes.toString('utf8')),
  );
  exact(value, ['schema', 'launchSha256', 'identity']);
  assert.equal(value.schema, 1);
  assert.equal(value.launchSha256, expected);
  const identity = admitProcessIdentity(value.identity);
  assert.equal(identity.pid, identity.pgid);
  if (existsSync(join(directory, 'record.json'))) {
    const record = processRecord(directory, expected);
    assert.equal(
      record.identitySha256,
      processIdentityHash(identity),
      'Worker identity record replaced',
    );
  }
  return identity;
}
