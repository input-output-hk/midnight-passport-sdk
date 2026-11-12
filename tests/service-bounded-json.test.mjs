import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fetchJsonBounded } from '../packages/service/dist/finality.js';

test('bounded JSON reads split UTF-8 and rejects malformed or oversized bytes', async () => {
  const bytes = new TextEncoder().encode('{"label":"€"}');
  const response = new Response(
    new ReadableStream({
      start(controller) {
        for (const byte of bytes) controller.enqueue(Uint8Array.of(byte));
        controller.close();
      },
    }),
  );
  /** @param {Response} value */
  const read = (value, maximum = bytes.length) =>
    fetchJsonBounded(
      async () => value,
      'http://fixture',
      { signal: new AbortController().signal },
      maximum,
    );
  assert.deepEqual((await read(response)).value, { label: '€' });
  await assert.rejects(read(new Response(' '.repeat(17)), 16), /byte limit/);
  await assert.rejects(read(new Response('{')), /JSON/);
  await assert.rejects(read(new Response(Uint8Array.of(0xff))), /encoded data/);
});

test('declared oversize and stream oversize cancel only the owned body', async () => {
  for (const declared of [undefined, '999999999999', '100', '-1']) {
    let cancelled = 0;
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(17));
      },
      cancel() {
        cancelled++;
      },
    });
    const response = new Response(body, {
      headers: declared === undefined ? {} : { 'content-length': declared },
    });
    await assert.rejects(
      fetchJsonBounded(
        async () => response,
        'http://fixture',
        { signal: new AbortController().signal },
        16,
      ),
      /byte limit/,
    );
    assert.equal(cancelled, 1);
    assert.equal(body.locked, false);
  }
});

test('abort refuses stalled headers, disposes their late body and makes no replacement fetch', async () => {
  const controller = new AbortController();
  /** @type {(value: Response) => void} */
  let resolve = () => {};
  let calls = 0;
  let cancelled = 0;
  const result = fetchJsonBounded(
    () => {
      calls++;
      return new Promise((done) => {
        resolve = done;
      });
    },
    'http://fixture',
    { signal: controller.signal },
    16,
  );
  controller.abort();
  await assert.rejects(result, /aborted/);
  resolve(
    new Response(
      new ReadableStream({
        cancel() {
          cancelled++;
        },
      }),
    ),
  );
  await new Promise((done) => setImmediate(done));
  assert.equal(calls, 1);
  assert.equal(cancelled, 1);
});

test('abort refuses a stalled decoder and closes its reader', async () => {
  const controller = new AbortController();
  let cancelled = 0;
  const body = new ReadableStream({
    cancel() {
      cancelled++;
    },
  });
  const result = fetchJsonBounded(
    async () => new Response(body),
    'http://fixture',
    { signal: controller.signal },
    16,
  );
  await new Promise((done) => setImmediate(done));
  controller.abort();
  await assert.rejects(result, /aborted/);
  assert.equal(cancelled, 1);
  assert.equal(body.locked, false);
});

test('already-aborted requests and invalid limits perform no network work', async () => {
  let calls = 0;
  const fetcher = async () => {
    calls++;
    return new Response('{}');
  };
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    fetchJsonBounded(fetcher, 'http://fixture', { signal: controller.signal }, 16),
    /aborted/,
  );
  await assert.rejects(
    fetchJsonBounded(fetcher, 'http://fixture', { signal: new AbortController().signal }, 0),
    /limit/,
  );
  assert.equal(calls, 0);
});
