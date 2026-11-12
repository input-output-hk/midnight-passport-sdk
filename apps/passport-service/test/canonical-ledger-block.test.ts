import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createCanonicalLedgerBlockReader,
  orderedLedgerCalls,
} from '../src/canonical-ledger-block.ts';

const bytes = (value: number) => Uint8Array.of(value);
const regular = { kind: 'regular' as const, bytes: bytes(2) };
const explicitSystem = { kind: 'system' as const, bytes: bytes(3) };

test('preserves initial, extrinsic and final phases without grouping system calls', () => {
  const calls = orderedLedgerCalls(
    [undefined, regular, undefined, explicitSystem, regular],
    [
      { position: 'initialization', bytes: bytes(0) },
      { position: 0, bytes: bytes(1) },
      { position: 2, bytes: bytes(4) },
      { position: 2, bytes: bytes(5) },
      { position: 'finalization', bytes: bytes(6) },
    ],
  );
  assert.deepEqual(
    calls.map(({ kind, bytes: data }) => [kind, data[0]]),
    [
      ['system', 0],
      ['system', 1],
      ['regular', 2],
      ['system', 4],
      ['system', 5],
      ['system', 3],
      ['regular', 2],
      ['system', 6],
    ],
  );
});

test('refuses misordered events and phases shared with explicit ledger calls', () => {
  assert.throws(
    () => orderedLedgerCalls([regular], [{ position: 0, bytes: bytes(1) }]),
    /ambiguous/i,
  );
  assert.throws(
    () => orderedLedgerCalls([explicitSystem], [{ position: 0, bytes: bytes(3) }]),
    /ambiguous/i,
  );
  assert.throws(
    () => orderedLedgerCalls([undefined], [{ position: 1, bytes: bytes(1) }]),
    /ambiguous/i,
  );
  assert.throws(
    () =>
      orderedLedgerCalls(
        [undefined],
        [
          { position: 'finalization', bytes: bytes(1) },
          { position: 0, bytes: bytes(2) },
        ],
      ),
    /ambiguous/i,
  );
});

test('canonical reader pins metadata from the node and fails closed on a different indexer block', async () => {
  const nodeUrl = 'http://127.0.0.1:19964';
  const indexerUrl = 'http://127.0.0.1:18118/api/v4/graphql';
  const blockHash = '11'.repeat(32);
  const parentHash = '22'.repeat(32);
  const calls: string[] = [];
  const read = createCanonicalLedgerBlockReader({
    nodeUrl,
    indexerUrl,
    metadataSha256: '33'.repeat(32),
    async fetch(url, init) {
      assert.equal(init?.redirect, 'error');
      assert.equal(typeof init?.body, 'string');
      const request = JSON.parse(String(init?.body));
      if (url === indexerUrl) {
        assert.deepEqual(request.variables, { hash: blockHash });
        calls.push('indexed');
        return Response.json({ data: { block: { hash: parentHash, ledgerParameters: '11' } } });
      }
      assert.equal(url, nodeUrl);
      calls.push(request.method);
      const reply = (result: unknown) => Response.json({ id: 1, result });
      switch (request.method) {
        case 'chain_getBlock':
          assert.deepEqual(request.params, ['0x' + blockHash]);
          return reply({
            block: {
              header: {
                parentHash: '0x' + parentHash,
                number: '0x2',
                stateRoot: '0x' + '44'.repeat(32),
                extrinsicsRoot: '0x' + '55'.repeat(32),
                digest: { logs: [] },
              },
              extrinsics: [],
            },
          });
        case 'state_getMetadata':
          assert.deepEqual(request.params, ['0x' + parentHash]);
          return reply('0x00');
        case 'state_getStorage':
          return reply('0x00');
        default:
          return assert.fail('Unexpected node method.');
      }
    },
  });
  assert.equal(await read(blockHash, AbortSignal.abort()), undefined);
  assert.deepEqual(calls, []);
  assert.equal(await read(blockHash, new AbortController().signal), undefined);
  assert.deepEqual(calls, [
    'chain_getBlock',
    'state_getMetadata',
    'state_getStorage',
    'state_getStorage',
    'state_getStorage',
    'indexed',
  ]);
});
