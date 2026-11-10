// Domain-separated authenticated control. No account payload or capability is logged.
import assert from 'node:assert/strict';
import { createHmac, timingSafeEqual, randomBytes } from 'node:crypto';
import { createConnection } from 'node:net';
import { exact, object, text } from './files.mjs';

/** @param {Buffer} key @param {'request'|'reply'} kind @param {Record<string,unknown>} message */
export function processProof(key, kind, message) {
  assert.equal(key.length, 32);
  return createHmac('sha256', key)
    .update(`passport-source-client-control-v1:${kind}\0`)
    .update(JSON.stringify(message))
    .digest('hex');
}
/** @param {Buffer} key @param {'request'|'reply'} kind @param {unknown} input */
export function admitProcessMessage(key, kind, input) {
  const row = object(input);
  exact(
    row,
    kind === 'request'
      ? ['schema', 'action', 'challenge', 'launch', 'identity', 'proof']
      : ['schema', 'action', 'challenge', 'launch', 'identity', 'phase', 'proof'],
  );
  assert.equal(row.schema, 1);
  text(row.action, /^(?:status|go|shutdown)$/);
  text(row.challenge, /^[a-f0-9]{64}$/);
  text(row.launch, /^[a-f0-9]{64}$/);
  text(row.identity, /^[a-f0-9]{64}$/);
  if (kind === 'reply') text(row.phase, /^(?:ready|admitted|finished|closing)$/);
  const proof = text(row.proof, /^[a-f0-9]{64}$/);
  const message = Object.fromEntries(Object.entries(row).filter(([name]) => name !== 'proof'));
  assert.equal(
    timingSafeEqual(
      Buffer.from(proof, 'hex'),
      Buffer.from(processProof(key, kind, message), 'hex'),
    ),
    true,
    'Process control authentication refused',
  );
  return message;
}
/** @param {string} path @param {Buffer} key @param {string} launch @param {string} identity @param {'status'|'go'|'shutdown'} action @param {number} [timeoutMs] */
export async function processRequest(path, key, launch, identity, action, timeoutMs = 3_000) {
  assert.ok(Number.isFinite(timeoutMs) && timeoutMs > 0 && timeoutMs <= 3_000);
  const request = {
    schema: 1,
    action,
    challenge: randomBytes(32).toString('hex'),
    launch,
    identity,
  };
  return new Promise((resolve, reject) => {
    const socket = createConnection(path);
    let bytes = '';
    const fail = () => {
      clearTimeout(timer);
      socket.destroy();
      reject(Error('Authenticated process control unavailable'));
    };
    const timer = setTimeout(fail, timeoutMs);
    socket.once('error', fail);
    socket.once('connect', () =>
      socket.write(
        JSON.stringify({ ...request, proof: processProof(key, 'request', request) }) + '\n',
      ),
    );
    socket.on('data', (chunk) => {
      bytes += chunk.toString('utf8');
      if (Buffer.byteLength(bytes) > 4096) return fail();
      if (!bytes.includes('\n')) return;
      try {
        assert.ok(bytes.endsWith('\n') && bytes.indexOf('\n') === bytes.length - 1);
        const reply = admitProcessMessage(key, 'reply', JSON.parse(bytes));
        assert.equal(reply.action, request.action);
        assert.equal(reply.challenge, request.challenge);
        assert.equal(reply.launch, request.launch);
        assert.equal(reply.identity, request.identity);
        clearTimeout(timer);
        socket.end();
        resolve(reply);
      } catch {
        fail();
      }
    });
    socket.once('close', () => {
      clearTimeout(timer);
      if (!bytes.endsWith('\n')) reject(Error('Process reply missing'));
    });
  });
}
