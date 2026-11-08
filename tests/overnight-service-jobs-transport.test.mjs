import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PassportConnectorError } from '../packages/account/dist/errors.js';
import { setTimeout as pause } from 'node:timers/promises';
import { remoteHostJobs, remoteHostJobId } from '../packages/adapter-service/dist/index.js';
import { HOST_JOB_RESPONSE_BYTES_LIMIT } from '../packages/adapter-service/dist/host-job-response-limit.js';
import { hostHash } from '../packages/service/dist/index.js';
import { descriptor, barrier } from './fixtures/host-jobs.mjs';
const d = descriptor(),
  common = {
    pins: d.identity.pins,
    token: 'cd'.repeat(32),
    timeoutMs: 1000,
    requestTimeoutMs: 100,
    pollIntervalMs: 0,
  };
/** @param {import('../packages/adapter-service/dist/index.js').RemoteHostJobIdentity} [identity] */
async function snapshot(identity = d.identity) {
  return {
    jobId: await remoteHostJobId(identity),
    identitySha256: hostHash(identity),
    state: 'queued',
    milestones: { preparedSteps: 0, confirmedSteps: 0 },
    events: [{ sequence: 1, state: 'queued', at: 0, preparedSteps: 0, confirmedSteps: 0 }],
    cursor: '1',
    firstCursor: '0',
  };
}
/** @param {unknown} value */
const bytes = (value) => new TextEncoder().encode(JSON.stringify(value));
/** @param {Response} response @param {()=>Promise<unknown>} json */
const withJson = (response, json) => ({
  ok: response.ok,
  status: response.status,
  headers: response.headers,
  body: response.body,
  json,
});

test('maximum valid 256-event,64-watch snapshot fits its derived compact-wire cap', async () => {
  const identity = { ...d.identity, kind: /** @type {const} */ ('deploy') },
    largest = Number.MAX_SAFE_INTEGER;
  const events = Array.from({ length: 256 }, (_, n) => ({
    sequence: largest - 255 + n,
    state: n === 255 ? 'done' : 'unknown',
    at: largest,
    preparedSteps: 64,
    confirmedSteps: 64,
  }));
  const value = {
    jobId: await remoteHostJobId(identity),
    identitySha256: hostHash(identity),
    state: 'done',
    milestones: { preparedSteps: 64, confirmedSteps: 64 },
    events,
    cursor: String(largest),
    firstCursor: String(largest - 256),
    outcome: {
      kind: 'confirmed',
      digest: identity.intentSha256,
      result: {
        address: 'ab'.repeat(32),
        txIds: Array.from({ length: 64 }, (_, n) => n.toString(16).padStart(66, '0')),
      },
    },
  };
  const payload = bytes(value);
  assert.equal(payload.byteLength, HOST_JOB_RESPONSE_BYTES_LIMIT);
  const client = remoteHostJobs('https://unused.invalid', {
    ...common,
    fetch: async () => new Response(payload),
  });
  const result = await client.get(identity);
  assert.equal(result?.events.length, 256);
  assert.equal(result?.state, 'done');
  assert.deepEqual(result?.outcome, value.outcome);
});

for (const declared of [false, true])
  test(`oversized native JSON cancels before parsing (content-length=${declared})`, async () => {
    let canceled = 0,
      reads = 0;
    const payload = new Uint8Array(HOST_JOB_RESPONSE_BYTES_LIMIT + 1).fill(32);
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(payload);
      },
      cancel() {
        canceled++;
      },
    });
    const response = new Response(stream, {
      headers: declared ? { 'content-length': String(payload.length) } : {},
    });
    const original = response.json.bind(response);
    const observed = withJson(response, () => {
      reads++;
      return original();
    });
    const client = remoteHostJobs('https://unused.invalid', {
      ...common,
      fetch: async () => observed,
    });
    await assert.rejects(client.get(d.identity), { code: 'MutationUnsettled' });
    assert.equal(reads, 0);
    assert.equal(canceled, 1);
    assert.equal(response.body?.locked, false);
  });

for (const status of [404, 503])
  test(`discarded HTTP ${status} body is canceled without exposing or reading it`, async () => {
    let canceled = 0,
      jsonReads = 0;
    const response = new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(Uint8Array.of(1));
        },
        cancel() {
          canceled++;
        },
      }),
      { status },
    );
    const observed = withJson(response, async () => {
      jsonReads++;
      throw Error('protected diagnostic');
    });
    const client = remoteHostJobs('https://unused.invalid', {
      ...common,
      fetch: async () => observed,
    });
    if (status === 404) assert.equal(await client.get(d.identity), undefined);
    else await assert.rejects(client.get(d.identity), { code: 'MutationUnsettled' });
    assert.equal(canceled, 1);
    assert.equal(jsonReads, 0);
    assert.equal(response.body?.locked, false);
  });

test('late custom headers cancel their newly arrived body and never read it', async () => {
  const entered = barrier(),
    release = barrier();
  let canceled = 0,
    jsonReads = 0;
  const response = new Response(
    new ReadableStream({
      cancel() {
        canceled++;
      },
    }),
  );
  const observed = withJson(response, async () => {
    jsonReads++;
    return {};
  });
  const client = remoteHostJobs('https://unused.invalid', {
    ...common,
    requestTimeoutMs: 15,
    fetch: async () => {
      entered.release();
      await release.promise;
      return observed;
    },
  });
  const operation = client.get(d.identity),
    refused = assert.rejects(operation, { code: 'MutationUnsettled' });
  try {
    await entered.promise;
    await refused;
  } finally {
    release.release();
  }
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(canceled, 1);
  assert.equal(jsonReads, 0);
  assert.equal(response.body?.locked, false);
});

test('stalled native body is canceled on request deadline with no held reader', async () => {
  let canceled = 0;
  const response = new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{'));
      },
      cancel() {
        canceled++;
      },
    }),
  );
  const client = remoteHostJobs('https://unused.invalid', {
    ...common,
    requestTimeoutMs: 15,
    fetch: async () => response,
  });
  await assert.rejects(client.get(d.identity), { code: 'MutationUnsettled' });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(canceled, 1);
  assert.equal(response.body?.locked, false);
});

test('malformed native JSON fails sanitized after releasing the consumed reader', async () => {
  const response = new Response('{protected-invalid');
  const client = remoteHostJobs('https://unused.invalid', {
    ...common,
    fetch: async () => response,
  });
  await assert.rejects(client.get(d.identity), (error) => {
    assert.ok(error instanceof PassportConnectorError);
    assert.equal(error.code, 'MutationUnsettled');
    assert.doesNotMatch(error.message, /protected-invalid/);
    return true;
  });
  assert.equal(response.body?.locked, false);
});

test('structural json-only transport remains compatible but cannot bypass post-parse admission', async () => {
  const valid = await snapshot();
  const client = remoteHostJobs('https://unused.invalid', {
    ...common,
    fetch: async () => ({ ok: true, status: 200, json: async () => valid }),
  });
  assert.equal((await client.get(d.identity))?.state, 'queued');
  const overflow = remoteHostJobs('https://unused.invalid', {
    ...common,
    fetch: async () => ({
      ok: true,
      status: 200,
      json: async () => ({ padding: 'x'.repeat(HOST_JOB_RESPONSE_BYTES_LIMIT) }),
    }),
  });
  await assert.rejects(overflow.get(d.identity), { code: 'MutationUnsettled' });
});

test('hanging custom cancellation never extends the caller request budget', async () => {
  let canceled = 0,
    released = 0;
  const client = remoteHostJobs('https://unused.invalid', {
    ...common,
    requestTimeoutMs: 15,
    fetch: async () => ({
      ok: true,
      status: 200,
      json: async () => ({}),
      body: {
        getReader: () => ({
          read: async () => new Promise(() => {}),
          cancel: () => {
            canceled++;
            return new Promise(() => {});
          },
          releaseLock() {
            released++;
          },
        }),
      },
    }),
  });
  await assert.rejects(client.get(d.identity), { code: 'MutationUnsettled' });
  assert.ok(canceled > 0);
  assert.ok(released > 0);
  await pause(1);
});
