import assert from 'node:assert/strict';
import test from 'node:test';
import { createMidnamesNodeFinality } from '../src/midnames/chain-finality.js';

const pin = {
  nodeUrl: 'https://node.example.test/rpc',
  anchorHeight: 100,
  anchorHash: '11'.repeat(32),
};
const block = { height: 120, hash: '22'.repeat(32) };
const finalizedHash = `0x${'33'.repeat(32)}`;

function node(override: Partial<Record<string, unknown>> = {}, calls: string[] = []): typeof fetch {
  return async (_url, init) => {
    const body = JSON.parse(String(init?.body)) as { method: string; params: unknown[] };
    calls.push(`${body.method}:${JSON.stringify(body.params)}`);
    const key = `${body.method}:${JSON.stringify(body.params)}`;
    const defaults: Record<string, unknown> = {
      'chain_getBlockHash:[100]': `0x${pin.anchorHash}`,
      'chain_getFinalizedHead:[]': finalizedHash,
      [`chain_getHeader:["${finalizedHash}"]`]: { number: '0x96' },
      'chain_getBlockHash:[120]': `0x${block.hash}`,
    };
    return new Response(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        result: Object.hasOwn(override, key) ? override[key] : defaults[key],
      }),
      { headers: { 'content-type': 'application/json' } },
    );
  };
}

test('a known chain block and finalized canonical node block admit an indexer snapshot', async () => {
  const calls: string[] = [];
  await createMidnamesNodeFinality(pin, node({}, calls))(block);
  assert.deepEqual(calls, [
    'chain_getBlockHash:[100]',
    'chain_getFinalizedHead:[]',
    `chain_getHeader:["${finalizedHash}"]`,
    'chain_getBlockHash:[120]',
  ]);
});

test('wrong chain, unfinalized tip and a noncanonical indexer block refuse', async () => {
  for (const override of [
    { 'chain_getBlockHash:[100]': `0x${'44'.repeat(32)}` },
    { [`chain_getHeader:["${finalizedHash}"]`]: { number: '0x77' } },
    { 'chain_getBlockHash:[120]': `0x${'55'.repeat(32)}` },
  ])
    await assert.rejects(createMidnamesNodeFinality(pin, node(override))(block), {
      code: 'Unavailable',
    });
});

test('malformed pins and indexer blocks refuse before a node request', async () => {
  const request = node();
  for (const bad of [
    { ...pin, nodeUrl: 'http://node.example.test/rpc' },
    { ...pin, anchorHeight: 0 },
    { ...pin, anchorHash: '0x' + pin.anchorHash },
  ])
    assert.throws(() => createMidnamesNodeFinality(bad, request), { code: 'InvalidQuery' });
  const verify = createMidnamesNodeFinality(pin, request);
  for (const bad of [
    { ...block, height: 99 },
    { ...block, hash: '0x' + block.hash },
  ])
    await assert.rejects(verify(bad), { code: 'InvalidRecord' });
});

test('an unavailable or oversized node reply cannot authenticate an indexer read', async () => {
  await assert.rejects(
    createMidnamesNodeFinality(pin, async () => {
      throw new Error('private node error');
    })(block),
    { code: 'Unavailable' },
  );
  await assert.rejects(
    createMidnamesNodeFinality(pin, async () => new Response('x'.repeat(17_000)))(block),
    { code: 'Unavailable' },
  );
});
