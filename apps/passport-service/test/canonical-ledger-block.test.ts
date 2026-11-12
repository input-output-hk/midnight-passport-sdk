import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { Bytes, Struct, TypeRegistry } from '@polkadot/types';
import type { Header } from '@polkadot/types/interfaces';
import {
  createCanonicalLedgerBlockReader,
  orderedLedgerCalls,
  readCanonicalSystemBytes,
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

test('decodes a pinned canonical block and independently refuses wrong parameters or oversized input', async () => {
  const nodeUrl = 'http://127.0.0.1:19964';
  const indexerUrl = 'http://127.0.0.1:18118/api/v4/graphql';
  // Minimal SCALE Metadata V14 with empty pallets, lookup and signed extensions.
  const metadata = '0x6d6574610e000000040000';
  const metadataSha256 = createHash('sha256')
    .update(Buffer.from(metadata.slice(2), 'hex'))
    .digest('hex');
  const registry = new TypeRegistry();
  const header = (number: number, parentHash: string) =>
    registry.createType<Header>('Header', {
      parentHash,
      number,
      stateRoot: '0x' + '44'.repeat(32),
      extrinsicsRoot: '0x' + '55'.repeat(32),
      digest: { logs: [] },
    });
  const first = header(2, '0x' + '22'.repeat(32));
  const second = header(3, first.hash.toHex());
  let active = first;
  let oversizedBlock = false;
  let metadataReply = metadata;
  let indexerHash = active.hash.toHex().slice(2);
  const read = createCanonicalLedgerBlockReader({
    nodeUrl,
    indexerUrl,
    metadataSha256,
    async fetch(url, init) {
      assert.equal(init?.redirect, 'error');
      assert.equal(typeof init?.body, 'string');
      const request = JSON.parse(String(init?.body));
      if (url === indexerUrl) {
        assert.deepEqual(request.variables, { hash: active.hash.toHex().slice(2) });
        return Response.json({ data: { block: { hash: indexerHash, ledgerParameters: '11' } } });
      }
      assert.equal(url, nodeUrl);
      const reply = (result: unknown) => Response.json({ id: 1, result });
      switch (request.method) {
        case 'chain_getBlock':
          assert.deepEqual(request.params, [active.hash.toHex()]);
          if (oversizedBlock)
            return Response.json({}, { headers: { 'content-length': '10485761' } });
          return reply({
            block: {
              header: {
                parentHash: active.parentHash.toHex(),
                number: '0x' + active.number.toNumber().toString(16),
                stateRoot: active.stateRoot.toHex(),
                extrinsicsRoot: active.extrinsicsRoot.toHex(),
                digest: { logs: [] },
              },
              extrinsics: [],
            },
          });
        case 'state_getMetadata':
          assert.deepEqual(request.params, [active.parentHash.toHex()]);
          return reply(metadataReply);
        case 'state_getStorage':
          return reply(request.params[0].startsWith('0x26aa') ? '0x00' : '0x0100000000000000');
        default:
          return assert.fail('Unexpected node method.');
      }
    },
  });
  const current = () => read(active.hash.toHex().slice(2), new AbortController().signal);
  assert.equal(await read(active.hash.toHex().slice(2), AbortSignal.abort()), undefined);
  assert.deepEqual(await current(), {
    blockHash: first.hash.toHex().slice(2),
    parentHash: first.parentHash.toHex().slice(2),
    height: 2,
    timestamp: 1,
    parentTimestamp: 1,
    transactions: [],
    ledgerParameters: Buffer.of(0x11),
  });
  indexerHash = '66'.repeat(32);
  assert.equal(await current(), undefined);
  indexerHash = first.hash.toHex().slice(2);
  oversizedBlock = true;
  assert.equal(await current(), undefined);
  oversizedBlock = false;
  active = second;
  indexerHash = second.hash.toHex().slice(2);
  metadataReply = '0x00';
  assert.equal(
    await current(),
    undefined,
    'an earlier valid parent cannot authorize another parent',
  );
  metadataReply = metadata;
  assert.equal((await current())?.height, 3);
});

test('extracts only the transaction bytes from the runtime system event struct', () => {
  const registry = new TypeRegistry();
  const bytes = Uint8Array.of(7, 8, 9);
  const wrapped = new Struct(
    registry,
    { hash_: '[u8;32]', serializedSystemTransaction: 'Bytes' },
    {
      hash_: '0x' + '44'.repeat(32),
      serializedSystemTransaction: new Bytes(registry, '0x070809'),
    },
  );
  assert.deepEqual(readCanonicalSystemBytes(wrapped), bytes);
  assert.notDeepEqual(readCanonicalSystemBytes(wrapped), wrapped.toU8a(true));
  assert.throws(() => readCanonicalSystemBytes(new Bytes(registry, '0x070809')), /payload/);
});
