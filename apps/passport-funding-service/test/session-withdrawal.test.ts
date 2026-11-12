import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';
import {
  createAgentGrantSpendJournal,
  grantOriginHash,
  mutationDigest,
} from '@input-output-hk/mn-passport-account';
import type { LiveP256GrantSpendContext } from '@input-output-hk/mn-passport-account/ports';
import { pureCircuits as pure } from '@input-output-hk/mn-passport-contract/bindings/acc-s3r1.1';
import { createServer, fileMutationByteStore } from '@input-output-hk/mn-passport-service';
import { signJubjubChallenge } from '../../../packages/keys/dist/jubjub-signing.js';
import { submitSessionWithdrawal } from '../src/session-withdrawal.ts';
import { sessionWithdrawalRecoveryRoute } from '../src/session-withdrawal-recovery.ts';

const txHash = 'be'.repeat(32);
const now = 1_800_000_000;
const account = '31'.repeat(32);
const color = new Uint8Array(32);
const recipient = { bytes: new Uint8Array(32).fill(7) };
const self = { bytes: Uint8Array.from(Buffer.from(account, 'hex')) };
const origin = grantOriginHash('localhost');
const salt = new Uint8Array(32).fill(8);
const slot = 9n;
const grantee = pure.compute_public_point_with_jubjub(7n);
const grant = pure.derive_grant_id_with_jubjub(self, grantee, origin, slot);
const grantId = Buffer.from(grant).toString('hex');
const amount = 1n;
const maxCoin = 10n;
const issue = 5n;
const signature = signJubjubChallenge(
  pure,
  7n,
  (r, grindNonce) =>
    pure.challenge_withdraw_unshielded_with_grant_jubjub(
      self,
      r,
      grantee,
      grant,
      issue,
      color,
      amount,
      recipient,
      0n,
      grindNonce,
    ),
  0n,
  11n,
);
const args = [
  color,
  amount,
  recipient,
  grantee,
  origin,
  slot,
  salt,
  1n,
  recipient.bytes,
  maxCoin,
  0n,
  signature.sigR,
  signature.sigS,
  signature.grindNonce,
];

async function fixture(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), 'passport-session-withdrawal-'));
  t.after(() => rm(directory, { force: true, recursive: true }));
  const file = join(directory, 'funding.json');
  const bytes = fileMutationByteStore(`${file}.session-spends`);
  const receipts = createAgentGrantSpendJournal(bytes);
  const live: { -readonly [K in keyof LiveP256GrantSpendContext]: LiveP256GrantSpendContext[K] } = {
    active: true,
    issuedAt: issue,
    nonce: 0n,
    grantEpoch: 2n,
    deviceEpoch: 2n,
    grantGeneration: 3n,
    generation: 3n,
    objectCommit: pure.derive_grant_object_commit(salt, color, 1n, recipient.bytes, maxCoin),
    spentCommit: pure.derive_grant_spent_commit(salt, 0n),
    rpCommit: pure.derive_grant_rp_commit(salt, new Uint8Array(32)),
    callerCommit: new Uint8Array(32),
    read: false,
    withdrawShielded: false,
    withdrawShieldedToContract: false,
    withdrawUnshielded: true,
    perCallCap: 2n,
    cap: 5n,
    expiresAt: BigInt(now + 30),
  };
  let sends = 0;
  const ports: Parameters<typeof submitSessionWithdrawal>[1] = {
    receipts,
    networkId: 'undeployed',
    pure,
    nowSeconds: () => now,
    grants: {
      networkId: 'undeployed',
      bindingId: 'acc-s3r1.1',
      async readP256GrantSpendContext(address, id) {
        assert.equal(address, account);
        assert.equal(id, grantId);
        return { ...live };
      },
    },
    chain: {
      networkId: 'undeployed',
      bindingId: 'acc-s3r1.1',
      async readAccount() {
        return undefined;
      },
      async call() {
        return assert.fail('Session withdrawal took the legacy chain route.');
      },
      async submitDurableAgentGrantSpend(call) {
        sends++;
        const row = await receipts.readRecord(call.mutation.requestId);
        assert.ok(row);
        assert.equal(row.reservation.grantId, grantId);
        assert.equal(row.reservation.callArgsSha256, mutationDigest(call.args));
        assert.equal(row.reservation.intentSha256, call.mutation.intentSha256);
        assert.equal(call.mutation.validUntilSeconds, now + 29);
        assert.equal(
          await receipts.stageTransaction(row.reservation, {
            txHash,
            bytesSha256: 'ad'.repeat(32),
            identifiers: ['0a'.repeat(33)],
          }),
          true,
        );
        return { txHash, blockHeight: 7 };
      },
    },
  };
  return { live, ports, bytes, file, sends: () => sends };
}

test('session host verifies the real Compact signature before reserving the browser UUID and grant nonce', async (t) => {
  const f = await fixture(t);
  const requestId = randomUUID();
  const forged = [...args];
  forged[12] = signature.sigS + 1n;
  await assert.rejects(
    submitSessionWithdrawal({ requestId, account, args: forged }, f.ports),
    /Invalid or stale signed session withdrawal/,
  );
  assert.equal(await f.ports.receipts.readRecord(requestId), undefined);
  assert.equal(f.sends(), 0);
  assert.deepEqual(await submitSessionWithdrawal({ requestId, account, args }, f.ports), {
    txHash,
    blockHeight: 7,
  });
  const reopened = createAgentGrantSpendJournal(f.bytes);
  assert.equal((await reopened.readRecord(requestId))?.acknowledgedHash, txHash);
  for (const duplicate of [requestId, randomUUID()]) {
    await assert.rejects(
      submitSessionWithdrawal(
        { requestId: duplicate, account, args },
        {
          ...f.ports,
          receipts: reopened,
        },
      ),
      /Reconcile the original session withdrawal/,
    );
  }
  assert.equal(f.sends(), 1);
});

test('session host rereads the signed grant after reserving and retains a stale original', async (t) => {
  const f = await fixture(t);
  const requestId = randomUUID();
  const original = f.ports.receipts;
  const receipts = {
    ...original,
    async reserve(reservation: Parameters<typeof original.reserve>[0]) {
      const saved = await original.reserve(reservation);
      f.live.nonce++;
      return saved;
    },
  };
  await assert.rejects(
    submitSessionWithdrawal(
      { requestId, account, args },
      {
        ...f.ports,
        receipts,
      },
    ),
    /Invalid or stale signed session withdrawal/,
  );
  assert.equal(f.sends(), 0);
  const row = await original.readRecord(requestId);
  assert.equal(row?.reservation.previousNonce, '0');
  assert.equal(row?.transaction, undefined);
});

test('operator inspection returns the original session receipt without submitting or clearing it', async (t) => {
  const f = await fixture(t);
  const requestId = randomUUID();
  const run = () =>
    promisify(execFile)(
      process.execPath,
      [
        '--import',
        'tsx',
        fileURLToPath(new URL('../src/inspect.ts', import.meta.url)),
        '--file',
        f.file,
        '--session-spend',
        '--request-id',
        requestId,
      ],
      { timeout: 10000 },
    );
  assert.equal(JSON.parse((await run()).stdout).state, 'unknown');
  await submitSessionWithdrawal({ requestId, account, args }, f.ports);
  const inspected = JSON.parse((await run()).stdout);
  assert.equal(inspected.state, 'acknowledged');
  assert.equal(inspected.original.transaction.txHash, txHash);
  assert.equal(inspected.requestId, requestId);
  assert.deepEqual(inspected.original, await f.ports.receipts.readRecord(requestId));
  assert.equal(f.sends(), 1);
});

test('withdrawal recovery only observes the original staged transaction and exact grant spend state', async (t) => {
  const f = await fixture(t);
  const requestId = randomUUID();
  const transportLost = {
    ...f.ports,
    chain: {
      ...f.ports.chain,
      async submitDurableAgentGrantSpend(
        call: Parameters<typeof f.ports.chain.submitDurableAgentGrantSpend>[0],
      ) {
        await f.ports.chain.submitDurableAgentGrantSpend(call);
        throw new Error('response lost');
      },
    },
  };
  await assert.rejects(
    submitSessionWithdrawal({ requestId, account, args }, transportLost),
    /response lost/,
  );
  const record = await f.ports.receipts.readRecord(requestId);
  assert.ok(record?.transaction);
  assert.equal(record.acknowledgedHash, undefined);
  let observations = 0;
  let finality: 'unknown' | 'different-bytes' | 'confirmed' = 'unknown';
  const route = sessionWithdrawalRecoveryRoute({
    receipts: createAgentGrantSpendJournal(f.bytes),
    grants: f.ports.grants,
    finality: {
      networkId: 'undeployed',
      async readFinalized(transaction) {
        observations++;
        assert.deepEqual(transaction, record.transaction);
        if (finality === 'unknown') return undefined;
        return {
          ...transaction,
          bytesSha256: finality === 'different-bytes' ? 'ff'.repeat(32) : transaction.bytesSha256,
          blockHeight: 7,
        };
      },
    },
    eligible: (address) => [account, 'ff'.repeat(32)].includes(address),
    authorize: (header) => header === 'Bearer test-only',
  });
  const server = createServer({ host: '127.0.0.1', corsOrigin: 'http://localhost:5173' }, [route]);
  t.after(() => server.close());
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const original = { accountAddress: account, requestId, grantId, amount: '1' };
  const observe = (patch = {}, token = 'Bearer test-only') =>
    fetch(`http://127.0.0.1:${address.port}/v1/session-withdrawal/recover`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: token },
      body: JSON.stringify({ ...original, ...patch }),
    });
  assert.equal((await observe({}, 'Bearer wrong')).status, 403);
  for (const patch of [
    { requestId: randomUUID() },
    { accountAddress: 'ff'.repeat(32) },
    { grantId: 'ff'.repeat(32) },
    { amount: '2' },
  ])
    assert.deepEqual(await (await observe(patch)).json(), { kind: 'unknown' });
  assert.equal(observations, 0);
  assert.deepEqual(await (await observe()).json(), { kind: 'unknown' });
  finality = 'different-bytes';
  assert.deepEqual(await (await observe()).json(), { kind: 'unknown' });
  finality = 'confirmed';
  f.live.nonce++;
  assert.deepEqual(await (await observe()).json(), { kind: 'unknown' });
  f.live.spentCommit = pure.derive_grant_spent_commit(salt, 1n);
  f.live.active = false;
  f.live.expiresAt = BigInt(now - 1);
  assert.deepEqual(await (await observe()).json(), {
    kind: 'confirmed',
    ...original,
    txHash,
    blockHeight: 7,
  });
  assert.deepEqual(await f.ports.receipts.readRecord(requestId), record);
  assert.equal(f.sends(), 1);
});
