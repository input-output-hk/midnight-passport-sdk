import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileMutationByteStore } from '@input-output-hk/mn-passport-service';
import {
  createP256GrantSpendJournal,
  recoverP256GrantSpend,
} from '../../../packages/account/dist/index.js';
import { createP256GrantFinality } from '../src/p256-grant-finality.ts';

const requestId = '549bd843-0a8f-40af-9b6f-d9eb8cf48871';
const reservation = {
  requestId,
  networkId: 'undeployed',
  account: '11'.repeat(32),
  grantId: '22'.repeat(32),
  issuedAt: '3',
  previousNonce: '0',
  expectedSpentCommit: '33'.repeat(32),
  intentSha256: '44'.repeat(32),
};
const originalBytes = Buffer.from('abce', 'hex');
const transaction = {
  txHash: '55'.repeat(32),
  bytesSha256: createHash('sha256').update(originalBytes).digest('hex'),
  identifiers: ['6600' + '66'.repeat(31), '77'.repeat(32)],
};
const block = '88'.repeat(32);
const nodeUrl = 'http://localhost:19964';
const indexerUrl = 'http://localhost:18108/api/v4/graphql';

test('a new host confirms the original fenced grant call with no acknowledgement', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'passport-grant-recovery-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const first = createP256GrantSpendJournal(fileMutationByteStore(root));
  const parallel = createP256GrantSpendJournal(fileMutationByteStore(root));
  assert.equal(
    (await Promise.all([first.reserve(reservation), parallel.reserve(reservation)])).filter(Boolean)
      .length,
    1,
  );
  assert.deepEqual(await first.read(requestId), {});
  await assert.rejects(
    parallel.stageTransaction({ ...reservation, intentSha256: '00'.repeat(32) }, transaction),
    { code: 'MutationUnsettled' },
  );
  assert.equal(
    (
      await Promise.all([
        first.stageTransaction(reservation, transaction),
        parallel.stageTransaction(reservation, transaction),
      ])
    ).filter(Boolean).length,
    1,
  );

  const restarted = createP256GrantSpendJournal(fileMutationByteStore(root));
  assert.deepEqual(await restarted.readRecord(requestId), { reservation, transaction });
  assert.equal(await restarted.reserve(reservation), false);
  assert.equal(
    await restarted.stageTransaction(reservation, { ...transaction, txHash: '00'.repeat(32) }),
    false,
  );
  await assert.rejects(restarted.recordTransaction(reservation, '00'.repeat(32)), {
    code: 'MutationUnsettled',
  });

  const queries: string[] = [];
  let indexedBytes = originalBytes.toString('hex');
  let finalizedHeight = '0x14';
  let canonicalBlock = block;
  const finality = createP256GrantFinality({
    nodeUrl,
    indexerUrl,
    networkId: reservation.networkId,
    versionOfRecord: () => 'v9',
    ledger: {
      Transaction: {
        deserialize(_s, _p, _b, raw) {
          assert.deepEqual(Buffer.from(raw), originalBytes);
          return {
            identifiers: () => transaction.identifiers,
            transactionHash: () => transaction.txHash,
          };
        },
      },
    },
    async fetch(url, init) {
      assert.equal(init?.method, 'POST');
      assert.equal(init?.redirect, 'error');
      assert.ok(typeof init?.body === 'string');
      const body = JSON.parse(init.body);
      if (url === indexerUrl) {
        queries.push('indexer');
        assert.deepEqual(body.variables, { offset: { identifier: transaction.identifiers[0] } });
        return Response.json({
          data: {
            transactions: [
              {
                __typename: 'RegularTransaction',
                protocolVersion: 2001000,
                raw: indexedBytes,
                hash: transaction.txHash,
                identifiers: transaction.identifiers,
                block: { hash: block, height: 10 },
                transactionResult: { status: 'SUCCESS' },
              },
            ],
          },
        });
      }
      assert.equal(url, nodeUrl);
      queries.push(body.method);
      switch (body.method) {
        case 'chain_getFinalizedHead':
          return Response.json({ id: 1, result: '0x' + '99'.repeat(32) });
        case 'chain_getHeader':
          assert.deepEqual(body.params, ['0x' + '99'.repeat(32)]);
          return Response.json({ id: 1, result: { number: finalizedHeight } });
        case 'chain_getBlockHash':
          assert.deepEqual(body.params, [10]);
          return Response.json({ id: 1, result: '0x' + canonicalBlock });
        default:
          return assert.fail('Only observation methods are allowed.');
      }
    },
  });
  const recover = () => recoverP256GrantSpend(requestId, restarted, finality);
  indexedBytes = 'abcd';
  assert.deepEqual(await recover(), { kind: 'unknown' });
  assert.deepEqual(queries.splice(0), ['indexer']);
  indexedBytes = originalBytes.toString('hex');
  finalizedHeight = '0x9';
  assert.deepEqual(await recover(), { kind: 'unknown' });
  assert.deepEqual(queries.splice(0), ['indexer', 'chain_getFinalizedHead', 'chain_getHeader']);
  finalizedHeight = '0x14';
  canonicalBlock = 'aa'.repeat(32);
  assert.deepEqual(await recover(), { kind: 'unknown' });
  assert.equal(queries.pop(), 'chain_getBlockHash');
  canonicalBlock = block;
  assert.deepEqual(await recover(), {
    kind: 'confirmed',
    requestId,
    intentSha256: reservation.intentSha256,
    txHash: transaction.txHash,
    blockHeight: 10,
  });
  assert.deepEqual(await restarted.readRecord(requestId), { reservation, transaction });
  await restarted.recordTransaction(reservation, transaction.txHash);
  assert.deepEqual(await first.read(requestId), { txHash: transaction.txHash });
});
