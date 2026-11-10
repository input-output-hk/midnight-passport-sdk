import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readHostConfirmation, type HostConfirmationRuntime } from '../src/host-confirmation.ts';

test('confirmation schema and byte limits refuse malformed observations before decoding a transaction', async () => {
  const identifier = '00' + '22'.repeat(32);
  const hash = '11'.repeat(32);
  const record = {
    __typename: 'RegularTransaction',
    protocolVersion: 2001000,
    transactionResult: { status: 'SUCCESS' },
    identifiers: [identifier],
    hash,
    raw: 'aa',
    block: { height: 0 },
  };
  const step = { tx: 'aa', identifiers: [identifier], phase: 'dispatching' as const };
  let decodes = 0;
  let fetches = 0;
  const runtime: HostConfirmationRuntime = {
    indexerUrl: 'http://fixture',
    versionOfRecord: () => 'v9',
    ledger: {
      Transaction: {
        deserialize() {
          decodes++;
          return { identifiers: () => [identifier], transactionHash: () => hash };
        },
      },
    },
    fetch: async () => {
      fetches++;
      return new Response(JSON.stringify({ data: { transactions: [record] } }));
    },
  };
  assert.deepEqual(await readHostConfirmation(step, runtime), {
    identifier,
    txHash: hash,
    blockHeight: 0,
    succeeded: true,
  });
  assert.equal(decodes, 1);
  for (const value of [
    null,
    [],
    { errors: ['unavailable'], data: { transactions: [record] } },
    { data: { transactions: [record, record] } },
    { data: { transactions: [{ ...record, raw: 'a' }] } },
    { data: { transactions: [{ ...record, hash: 'broken' }] } },
    { data: { transactions: [{ ...record, block: { height: Number.MAX_SAFE_INTEGER + 1 } }] } },
  ]) {
    assert.equal(
      await readHostConfirmation(step, {
        ...runtime,
        fetch: async () => new Response(JSON.stringify(value)),
      }),
      undefined,
    );
  }
  assert.equal(
    await readHostConfirmation(step, {
      ...runtime,
      fetch: async () =>
        new Response(JSON.stringify({ data: { transactions: [record] } }), {
          headers: { 'content-length': String(17 * 1024 * 1024 + 1) },
        }),
    }),
    undefined,
  );
  assert.equal(decodes, 1, 'invalid/oversized observations never enter the ledger decoder');
  assert.equal(await readHostConfirmation({ ...step, identifiers: [] }, runtime), undefined);
  assert.equal(fetches, 1, 'an identity-less observation never invents a watch request');
});
