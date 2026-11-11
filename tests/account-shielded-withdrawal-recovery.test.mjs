import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  createShieldedWithdrawalJournal,
  recoverShieldedWithdrawal,
} from '../packages/account/dist/index.js';
import { AmountSchema, NetworkIdSchema } from '../packages/account/dist/validation.js';
import { deriveMidnightContractCoinCommitment } from '../packages/adapter-midnight-js/dist/index.js';
import {
  fileMutationByteStore,
  protectedMutationByteStore,
} from '../packages/service/dist/index.js';

const account = '11'.repeat(32);
const coin = { nonce: Buffer.alloc(32, 0x66), color: Buffer.alloc(32, 0x77), value: 12n };
const changeCommitment = deriveMidnightContractCoinCommitment(account, coin);
assert.ok(changeCommitment);
const reservation = {
  requestId: 'C5EAB311-6C1A-4482-BBE6-5CB68CC8B491',
  networkId: NetworkIdSchema.parse('undeployed'),
  bindingId: /** @type {const} */ ('acc-s3r1.1'),
  account,
  circuit: /** @type {const} */ ('withdraw_shielded_with_jubjub'),
  callArgsSha256: '22'.repeat(32),
  heldCoinSha256: '23'.repeat(32),
  inputNullifier: '33'.repeat(32),
  payoutCommitment: '44'.repeat(32),
  changeCommitment,
  change: {
    nonce: coin.nonce.toString('hex'),
    color: coin.color.toString('hex'),
    value: AmountSchema.parse(coin.value.toString()),
  },
};
const dispatch = {
  identity: {
    txHash: '88'.repeat(32),
    bytesSha256: '99'.repeat(32),
    identifiers: ['ab'.repeat(33)],
  },
  callCommitment: '73a86cda1f51e8cb25d19a6f7be6c2bccbe58831fd130a5ddef90df1c00472eb59',
};
/** @type {import('../packages/account/dist/index.js').FinalizedShieldedWithdrawal} */
const observed = {
  dispatch,
  bindingId: reservation.bindingId,
  blockHash: 'bb'.repeat(32),
  blockHeight: 21,
  account: reservation.account,
  circuit: reservation.circuit,
  inputNullifier: reservation.inputNullifier,
  outputCommitments: [reservation.changeCommitment, reservation.payoutCommitment],
  changeOutput: {
    account: reservation.account,
    commitment: reservation.changeCommitment,
    index: 42n,
  },
};

test('original shielded withdrawal CAS admits one dispatch and a fresh process recovers its change', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'passport-shielded-withdrawal-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const fenceRoot = await mkdtemp(join(tmpdir(), 'passport-shielded-withdrawal-fence-'));
  t.after(() => rm(fenceRoot, { recursive: true, force: true }));
  const key = new Uint8Array(32).fill(7);
  const first = protectedMutationByteStore(root, key);
  const parallel = protectedMutationByteStore(root, key);
  t.after(() => {
    first.close();
    parallel.close();
  });
  const journal = createShieldedWithdrawalJournal(first, fileMutationByteStore(fenceRoot));
  const other = createShieldedWithdrawalJournal(parallel, fileMutationByteStore(fenceRoot));
  const id = reservation.requestId;
  const alias = { ...reservation, requestId: id.toLowerCase() };
  assert.equal(await journal.reserve(reservation), true);
  assert.equal(await other.reserve(reservation), false);
  assert.equal(await other.reserve(alias), false);
  assert.equal((await other.read(alias.requestId))?.reservation.requestId, id);
  assert.deepEqual(
    await recoverShieldedWithdrawal(id, {
      journal,
      deriveChangeCommitment: deriveMidnightContractCoinCommitment,
      finality: {
        networkId: reservation.networkId,
        bindingId: reservation.bindingId,
        readFinalized: async () => assert.fail('An unstaged withdrawal cannot be observed.'),
      },
    }),
    { kind: 'unknown' },
  );
  await assert.rejects(
    journal.stageDispatch({ ...reservation, callArgsSha256: 'fe'.repeat(32) }, dispatch),
    { code: 'MutationUnsettled' },
  );
  const conflict = {
    ...dispatch,
    identity: { ...dispatch.identity, txHash: 'cc'.repeat(32) },
  };
  const [won, lost] = await Promise.all([
    journal.stageDispatch(alias, dispatch),
    other.stageDispatch(alias, conflict),
  ]);
  assert.notEqual(won, lost);
  const original = won ? dispatch : conflict;
  assert.deepEqual((await journal.read(id))?.dispatch, original);
  assert.equal(await journal.stageDispatch(reservation, original), false);
  first.close();
  parallel.close();

  for (const name of await readdir(root)) {
    const content = await readFile(join(root, name), 'utf8');
    assert.ok(!content.includes(reservation.change.nonce));
    assert.ok(!content.includes(reservation.change.color));
  }

  const child = `
    import assert from 'node:assert/strict';
    import { readFileSync } from 'node:fs';
    import { createShieldedWithdrawalJournal, recoverShieldedWithdrawal }
      from ${JSON.stringify(new URL('../packages/account/dist/index.js', import.meta.url).href)};
    import { fileMutationByteStore, protectedMutationByteStore }
      from ${JSON.stringify(new URL('../packages/service/dist/index.js', import.meta.url).href)};
    import { deriveMidnightContractCoinCommitment }
      from ${JSON.stringify(new URL('../packages/adapter-midnight-js/dist/index.js', import.meta.url).href)};
    const args = JSON.parse(readFileSync(0, 'utf8'));
    const store = protectedMutationByteStore(args.root, new Uint8Array(args.key));
    const journal = createShieldedWithdrawalJournal(store, fileMutationByteStore(args.fenceRoot));
    const value = await recoverShieldedWithdrawal(args.id.toLowerCase(), {
      journal,
      deriveChangeCommitment: deriveMidnightContractCoinCommitment,
      finality: {
        networkId: 'undeployed',
        bindingId: 'acc-s3r1.1',
        async readFinalized(identity) {
          assert.deepEqual(identity, args.evidence.dispatch.identity);
          const changeOutput = { ...args.evidence.changeOutput, index: 42n };
          return { ...args.evidence, changeOutput };
        },
      },
    });
    assert.equal(value.kind, 'change-found');
    assert.equal(value.requestId, args.id);
    assert.equal(value.txHash, args.evidence.dispatch.identity.txHash);
    assert.equal(value.change.mt_index, 42n);
    assert.equal(value.change.value, 12n);
    assert.equal(Buffer.from(value.change.nonce).toString('hex'), args.expectedNonce);
    store.close();
    process.stdout.write('original change recovered');
  `;
  const evidence = {
    ...observed,
    dispatch: original,
    changeOutput: { ...observed.changeOutput, index: null },
  };
  assert.equal(
    execFileSync(process.execPath, ['--input-type=module', '-e', child], {
      input: JSON.stringify({
        root,
        fenceRoot,
        key: [...key],
        id,
        evidence,
        expectedNonce: reservation.change.nonce,
      }),
      encoding: 'utf8',
      timeout: 10_000,
    }),
    'original change recovered',
  );
  const emptyRoot = await mkdtemp(join(tmpdir(), 'passport-shielded-withdrawal-lost-'));
  t.after(() => rm(emptyRoot, { recursive: true, force: true }));
  const empty = protectedMutationByteStore(emptyRoot, key);
  t.after(() => empty.close());
  const missing = createShieldedWithdrawalJournal(empty, fileMutationByteStore(fenceRoot));
  assert.equal(await missing.read(id), undefined);
  assert.equal(await missing.reserve(reservation), false);
});

test('recovery requires the original call, exact effects and a matching indexed change', async () => {
  const id = reservation.requestId;
  const journal = { read: async () => ({ reservation, dispatch }) };
  const source = {
    networkId: reservation.networkId,
    bindingId: reservation.bindingId,
    readFinalized: async () => observed,
  };
  const ports = {
    journal,
    deriveChangeCommitment: deriveMidnightContractCoinCommitment,
    finality: source,
  };
  assert.equal((await recoverShieldedWithdrawal(id, ports)).kind, 'change-found');
  for (const evidence of [
    undefined,
    { ...observed, blockHeight: 0 },
    { ...observed, dispatch: { ...dispatch, callCommitment: 'dd'.repeat(32) } },
    {
      ...observed,
      dispatch: { ...dispatch, identity: { ...dispatch.identity, bytesSha256: 'dd'.repeat(32) } },
    },
    { ...observed, circuit: /** @type {const} */ ('withdraw_shielded_with_p256') },
    { ...observed, inputNullifier: 'dd'.repeat(32) },
    {
      ...observed,
      outputCommitments: [reservation.changeCommitment, reservation.changeCommitment],
    },
    { ...observed, changeOutput: { ...observed.changeOutput, account: 'dd'.repeat(32) } },
    {
      ...observed,
      changeOutput: { ...observed.changeOutput, commitment: reservation.payoutCommitment },
    },
    { ...observed, changeOutput: { ...observed.changeOutput, index: 1n << 64n } },
  ]) {
    assert.deepEqual(
      await recoverShieldedWithdrawal(id, {
        ...ports,
        finality: {
          ...source,
          readFinalized: async () => /** @type {typeof observed | undefined} */ (evidence),
        },
      }),
      { kind: 'unknown' },
    );
  }
  await assert.rejects(
    recoverShieldedWithdrawal(id, {
      ...ports,
      finality: {
        ...source,
        networkId: 'preview',
        readFinalized: async () => assert.fail('Wrong network must refuse before observation.'),
      },
    }),
    { code: 'NetworkMismatch' },
  );
  const changed = { ...reservation, change: { ...reservation.change, nonce: 'dd'.repeat(32) } };
  assert.deepEqual(
    await recoverShieldedWithdrawal(id, {
      ...ports,
      journal: { read: async () => ({ reservation: changed, dispatch }) },
      finality: {
        ...source,
        readFinalized: async () =>
          assert.fail('The mismatched coin must refuse before observation.'),
      },
    }),
    { kind: 'unknown' },
  );
});

test('a prior staged receipt remains recoverable without a held-coin admission digest', async () => {
  const { heldCoinSha256: _digest, ...legacy } = reservation;
  const bytes = Buffer.from(JSON.stringify({ version: 1, reservation: legacy, dispatch }));
  const readOnly = {
    read: async () => ({ revision: 1, bytes: new Uint8Array(bytes) }),
    compareAndSwap: async () => assert.fail('Recovery is read only.'),
  };
  const journal = createShieldedWithdrawalJournal(readOnly, { ...readOnly });
  const result = await recoverShieldedWithdrawal(reservation.requestId, {
    journal,
    deriveChangeCommitment: deriveMidnightContractCoinCommitment,
    finality: {
      networkId: reservation.networkId,
      bindingId: reservation.bindingId,
      readFinalized: async () => observed,
    },
  });
  assert.equal(result.kind, 'change-found');
});
