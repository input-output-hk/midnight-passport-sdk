import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import {
  createAgentGrantSpendJournal,
  createP256GrantSpendJournal,
} from '../packages/account/dist/index.js';
import { fileMutationByteStore } from '../packages/service/dist/index.js';

test('agent spend reservation and exact finalized identity survive a hard process kill', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'passport-agent-spend-kill-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const reservation = {
    requestId: randomUUID(),
    circuit: 'withdraw_unshielded_with_grant_jubjub',
    intentSha256: '12'.repeat(32),
    networkId: 'undeployed',
    account: '23'.repeat(32),
    grantId: '34'.repeat(32),
    color: '00'.repeat(32),
    amount: '1',
    recipient: '45'.repeat(32),
    issuedAt: '1',
    epoch: '0',
    generation: '1',
    previousNonce: '0',
    validUntilSeconds: 1800000000,
    expectedSpentCommit: '56'.repeat(32),
    callArgsSha256: '67'.repeat(32),
  };
  const transaction = {
    txHash: '78'.repeat(32),
    bytesSha256: '89'.repeat(32),
    identifiers: ['90'.repeat(33)],
  };
  const worker = fileURLToPath(
    new URL('./fixtures/agent-grant-spend-journal-child.mjs', import.meta.url),
  );
  await assert.rejects(
    promisify(execFile)(
      process.execPath,
      [worker, directory, JSON.stringify(reservation), JSON.stringify(transaction)],
      { timeout: 10000 },
    ),
    { signal: 'SIGKILL' },
  );
  const bytes = fileMutationByteStore(directory);
  const journal = createAgentGrantSpendJournal(bytes);
  const record = await journal.readRecord(reservation.requestId);
  assert.deepEqual(record, { reservation, transaction });
  assert.ok(record);
  assert.equal(await journal.reserve({ ...record.reservation, requestId: randomUUID() }), false);
  assert.equal(await journal.stageTransaction(record.reservation, transaction), false);
  assert.equal(
    await createP256GrantSpendJournal(bytes).readRecord(reservation.requestId),
    undefined,
  );
});
