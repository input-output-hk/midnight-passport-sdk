import assert from 'node:assert/strict';
import { test } from 'node:test';
import { shutdownHandler } from '../src/shutdown.ts';

test('repeated signals invoke one drain and one successful exit', async () => {
  let release = () => {},
    calls = 0;
  const exits: number[] = [],
    messages: string[] = [];
  const wait = new Promise<void>((r) => {
    release = r;
  });
  const handler = shutdownHandler(
    async () => {
      calls++;
      await wait;
    },
    {
      deadlineMs: 1000,
      exit: (code) => {
        exits.push(code);
      },
      log: (m) => messages.push(m),
    },
  );
  handler();
  handler();
  await new Promise<void>((r) => setImmediate(r));
  assert.equal(calls, 1);
  assert.deepEqual(exits, []);
  release();
  await new Promise<void>((r) => setImmediate(r));
  assert.deepEqual(exits, [0]);
  assert.equal(messages.length, 1);
});
test('a refused drain exits failure without disclosing backend diagnostics', async () => {
  const exits: number[] = [],
    messages: string[] = [];
  shutdownHandler(
    async () => {
      throw new Error('private journal failure');
    },
    { exit: (c) => exits.push(c), log: (m) => messages.push(m) },
  )();
  await new Promise<void>((r) => setImmediate(r));
  assert.deepEqual(exits, [1]);
  assert.ok(messages.at(-1)?.includes('retain original IDs'));
  assert.ok(!messages.join('\n').includes('private'));
});
test(
  'a hung drain has a bounded failed exit and never claims cancellation',
  { timeout: 1000 },
  async () => {
    const messages: string[] = [];
    let handler = () => {},
      finished = () => {};
    const exited = new Promise<void>((r) => {
      finished = r;
    });
    handler = shutdownHandler(() => new Promise(() => {}), {
      deadlineMs: 15,
      exit: (code) => {
        assert.equal(code, 1);
        finished();
      },
      log: (m) => messages.push(m),
    });
    handler();
    handler();
    await exited;
    assert.ok(messages.at(-1)?.includes('outcome may be unknown'));
    assert.equal(messages.length, 2);
  },
);
