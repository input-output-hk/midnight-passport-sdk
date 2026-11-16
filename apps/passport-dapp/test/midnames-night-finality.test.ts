import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFinalizedNightLeg } from '../src/midnames/night-finality.js';
import type { NightBridgeTransaction } from '../src/midnames/night-bridge-output.js';

const hash = 'a'.repeat(64);
const firstId = '00' + 'b'.repeat(64);
const ids = [firstId, '01' + 'c'.repeat(64)];
const blockHash = 'd'.repeat(64);
const head = '0x' + 'e'.repeat(64);
const original = { hash, identifiers: ids };
const indexer = {
  data: {
    transactions: [
      {
        __typename: 'RegularTransaction',
        protocolVersion: 2001000,
        hash,
        raw: 'ab',
        identifiers: ids,
        transactionResult: { status: 'SUCCESS' },
        block: { hash: blockHash, height: 42 },
      },
    ],
  },
};

function network(row: unknown = indexer, height = '0x2a', canonical = '0x' + blockHash) {
  const calls: { url: string; body: Record<string, unknown> }[] = [];
  const request = (async (url: string, options: RequestInit) => {
    const body = JSON.parse(String(options.body)) as Record<string, unknown>;
    calls.push({ url, body });
    const answer =
      url === 'http://indexer'
        ? row
        : body.method === 'chain_getFinalizedHead'
          ? { jsonrpc: '2.0', id: 1, result: head }
          : body.method === 'chain_getHeader'
            ? { jsonrpc: '2.0', id: 1, result: { number: height } }
            : { jsonrpc: '2.0', id: 1, result: canonical };
    return new Response(JSON.stringify(answer), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
  return { request, calls };
}

function decoder(actual: Uint8Array): NightBridgeTransaction {
  assert.deepEqual(actual, Uint8Array.of(0xab));
  return { transactionHash: () => hash, identifiers: () => ids, intents: new Map() };
}

test('the exact original is final only after indexer identity and canonical node agreement', async () => {
  const { request, calls } = network();
  const result = await readFinalizedNightLeg(
    'http://indexer',
    'http://node',
    original,
    request,
    decoder,
  );
  assert.equal(result?.blockHash, blockHash);
  assert.equal(result?.blockHeight, 42);
  assert.equal(result?.transaction.transactionHash(), hash);
  assert.deepEqual(
    calls.map((call) => [call.url, call.body.method]),
    [
      ['http://indexer', undefined],
      ['http://node', 'chain_getFinalizedHead'],
      ['http://node', 'chain_getHeader'],
      ['http://node', 'chain_getBlockHash'],
    ],
  );
  assert.deepEqual(calls[0]?.body.variables, { offset: { identifier: ids[0] } });
  assert.deepEqual(calls[3]?.body.params, [42]);
});

test('an included transaction is not final at a shorter or different canonical chain', async () => {
  for (const [height, canonical] of [
    ['0x29', '0x' + blockHash],
    ['0x2a', '0x' + 'f'.repeat(64)],
  ]) {
    const { request } = network(indexer, height, canonical);
    assert.equal(
      await readFinalizedNightLeg('http://indexer', 'http://node', original, request, decoder),
      undefined,
    );
  }
});

test('partial success, changed IDs and a different transaction cannot authorize the deposit', async () => {
  for (const changed of [
    { transactionResult: { status: 'PARTIAL_SUCCESS' } },
    { identifiers: [...ids].reverse() },
    { hash: 'f'.repeat(64) },
    { protocolVersion: 123 },
    { raw: 'not-hex' },
  ]) {
    const candidate = {
      data: { transactions: [{ ...indexer.data.transactions[0], ...changed }] },
    };
    const { request, calls } = network(candidate);
    assert.equal(
      await readFinalizedNightLeg('http://indexer', 'http://node', original, request, decoder),
      undefined,
    );
    assert.equal(calls.length, 1);
  }
  for (const decoded of [
    { transactionHash: () => 'f'.repeat(64), identifiers: () => ids, intents: new Map() },
    { transactionHash: () => hash, identifiers: () => [...ids].reverse(), intents: new Map() },
  ]) {
    const { request, calls } = network();
    assert.equal(
      await readFinalizedNightLeg(
        'http://indexer',
        'http://node',
        original,
        request,
        () => decoded,
      ),
      undefined,
    );
    assert.equal(calls.length, 1);
  }
});

test('malformed original IDs and unavailable network data remain unknown', async () => {
  const { request, calls } = network();
  assert.equal(
    await readFinalizedNightLeg(
      'http://indexer',
      'http://node',
      { hash, identifiers: [firstId, firstId] },
      request,
      decoder,
    ),
    undefined,
  );
  assert.equal(calls.length, 0);
  const unavailable = (async () => {
    throw new Error('indexer offline');
  }) as typeof fetch;
  assert.equal(
    await readFinalizedNightLeg('http://indexer', 'http://node', original, unavailable, decoder),
    undefined,
  );
});
