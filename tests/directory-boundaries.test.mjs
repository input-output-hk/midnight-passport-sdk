import assert from 'node:assert/strict';
import { test } from 'node:test';
import { boundedJson } from '../packages/adapter-service/dist/bounded-json.js';
import { directoryHint } from '../packages/adapter-service/dist/directory-codec.js';
import { remoteDirectory } from '../packages/adapter-service/dist/index.js';
import { lazyPort } from '../packages/account/dist/lazy-port.js';

const hint = {
  address: 'ab'.repeat(32),
  scheme: 'p256-webauthn',
  publicKey: { x: '1', y: '2' },
  credentialId: '0102',
  salt: 'cd'.repeat(32),
  policy: { rp_id_hash: 'ef'.repeat(32), origin: 'aa'.repeat(21) },
  keyEntries: ['00'.repeat(192)],
  status: 'active',
};

test('directory field bounds apply before hex/BigInt conversion and strip extensions', () => {
  const result = directoryHint({ ...hint, providerSecret: 'discard' });
  assert.deepEqual(result.publicKey, { x: 1n, y: 2n });
  assert.equal(result.credentialId?.length, 2);
  assert.equal(result.keyEntries?.[0]?.length, 192);
  assert.equal('providerSecret' in result, false);
  for (const value of [
    null,
    { ...hint, address: 'x'.repeat(100_000) },
    { ...hint, publicKey: { x: 'f'.repeat(65), y: '2' } },
    { ...hint, credentialId: 'ab'.repeat(1025) },
    { ...hint, salt: 'aa' },
    { ...hint, policy: { ...hint.policy, origin: 'aa'.repeat(1025) } },
    { ...hint, policy: { ...hint.policy, rp_id_hash: 'aa' } },
    { ...hint, keyEntries: Array(17).fill('00'.repeat(192)) },
    { ...hint, credentialId: '1' },
    { ...hint, scheme: 'unknown' },
  ])
    assert.throws(() => directoryHint(value), /Invalid directory hint/);
});

test('native response streams enforce actual bytes even without a trustworthy content length', async () => {
  const text = JSON.stringify({ message: 'résumé' });
  const bytes = new TextEncoder().encode(text);
  const chunks = [bytes.slice(0, 13), bytes.slice(13)];
  let canceled = false,
    released = false,
    reads = 0;
  const response = {
    ok: true,
    status: 200,
    json: async () => {
      throw Error('unbounded json must not run');
    },
    body: {
      getReader: () => ({
        read: async () => {
          reads++;
          const value = chunks.shift();
          return value ? { done: false, value } : { done: true };
        },
        cancel: async () => {
          canceled = true;
        },
        releaseLock: () => {
          released = true;
        },
      }),
    },
  };
  assert.deepEqual(await boundedJson(response, bytes.length), { message: 'résumé' });
  assert.equal(canceled, false);
  assert.equal(released, true);
  assert.equal(reads, 3);
  chunks.push(new Uint8Array(20));
  released = false;
  await assert.rejects(boundedJson(response, 10), /byte limit/);
  assert.equal(canceled, true);
  assert.equal(released, true);
  for (const length of ['1000', 'nonsense', '-1']) {
    await assert.rejects(
      boundedJson({ ...response, headers: { get: () => length } }, 10),
      /byte limit/,
    );
  }
});

test('bounded structural transport refuses oversize/invalid JSON and adapter uses the bound reader', async () => {
  for (const value of ['x'.repeat(100), undefined]) {
    await assert.rejects(
      boundedJson({ ok: true, status: 200, json: async () => value }, 10),
      /byte limit/,
    );
  }
  const key = { kind: /** @type {const} */ ('credential-id'), credentialId: Uint8Array.of(1) };
  const fetch = async () => new Response(JSON.stringify(hint), { status: 200 });
  assert.equal(
    (await remoteDirectory('http://local', { fetch }).get('undeployed', key))?.address,
    hint.address,
  );
  const malformed = async () => new Response('x'.repeat(40_000), { status: 200 });
  await assert.rejects(
    remoteDirectory('http://local', { fetch: malformed }).get('undeployed', key),
    (error) => {
      assert.ok(error instanceof Error && 'code' in error);
      assert.equal(error.code, 'InternalError');
      assert.equal(error.cause, undefined);
      return true;
    },
  );
});

test('lazy adapters share a successful load across concurrent calls and retry rejected loads', async () => {
  let loads = 0;
  const value = { id: 'stable' };
  const read = lazyPort(async () => {
    loads++;
    if (loads === 1) throw Error('not ready');
    return value;
  });
  await assert.rejects(Promise.all([read(), read()]), /not ready/);
  assert.equal(loads, 1);
  const values = await Promise.all([read(), read(), read()]);
  assert.ok(values.every((entry) => entry === value));
  assert.equal(await read(), value);
  assert.equal(loads, 2);
  assert.equal(await lazyPort(value)(), value);
  let synchronous = 0;
  const retry = lazyPort(() => {
    if (++synchronous === 1) throw Error('sync failure');
    return Promise.resolve(value);
  });
  await assert.rejects(retry(), /sync failure/);
  assert.equal(await retry(), value);
});
