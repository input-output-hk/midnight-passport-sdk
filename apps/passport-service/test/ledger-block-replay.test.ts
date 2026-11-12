import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import * as Ledger from '@midnightntwrk/ledger-v9';
import { replayLedgerTransition, type CanonicalLedgerBlock } from '../src/ledger-block-replay.ts';
import { ledgerStateRootV18 } from '../src/ledger-state-root.ts';
import { createShieldedTransitionSource } from '../src/shielded-transition-source.ts';

const genesis = '11'.repeat(32);
const parentHash = '22'.repeat(32);
const blockHash = '33'.repeat(32);
const timestamp = 1_800_000_000_000;
const nodeUrl = 'http://127.0.0.1:19964';
const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

function setup() {
  const state = Ledger.LedgerState.blank('undeployed');
  const snapshot = state.serialize();
  const date = new Date(timestamp);
  const tx = Ledger.Transaction.fromParts('undeployed').mockProve().bind();
  const strictness = new Ledger.WellFormedStrictness();
  strictness.enforceBalancing = false;
  const context = new Ledger.TransactionContext(state, {
    parentBlockHash: parentHash,
    secondsSinceEpoch: 1_800_000_000n,
    secondsSinceEpochErr: 30,
    lastBlockTime: 1_799_999_999n,
  });
  const [after, result] = state.apply(tx.wellFormed(state, strictness, date), context);
  assert.equal(result.type, 'success');
  const fullness = state.parameters.normalizeFullness(tx.cost(state.parameters, true));
  const end = after.postBlockUpdate(date, fullness, Math.max(...Object.values(fullness)));
  const bytes = tx.serialize();
  const block: CanonicalLedgerBlock = {
    blockHash,
    parentHash,
    height: 2,
    timestamp,
    parentTimestamp: timestamp - 1000,
    transactions: [{ kind: 'regular', bytes }],
    ledgerParameters: end.parameters.serialize(),
  };
  return {
    block,
    tx,
    snapshot,
    roots: { parent: ledgerStateRootV18(snapshot), block: ledgerStateRootV18(end.serialize()) },
    target: { txHash: tx.transactionHash(), bytesSha256: sha(bytes) },
  };
}

test('replays a finalized Ledger 9 transaction and checks both full-state roots', () => {
  const { block, snapshot, roots, target } = setup();
  const signal = new AbortController().signal;
  const replay = (input = block, anchors = roots, identity = target) =>
    replayLedgerTransition(Ledger, input, snapshot, anchors, identity, signal);
  const exact = replay();
  assert.equal(exact?.result.type, 'success');
  assert.ok(exact);
  assert.deepEqual(exact.before.serialize(), snapshot);
  assert.equal(replay(block, { ...roots, parent: roots.block }), undefined);
  assert.equal(replay(block, { ...roots, block: roots.parent }), undefined);
  const wrongParameters = new Uint8Array(block.ledgerParameters);
  wrongParameters.set([(wrongParameters.at(0) ?? 0) ^ 1], 0);
  assert.throws(() => replay({ ...block, ledgerParameters: wrongParameters }));
  assert.equal(replay(block, roots, { ...target, bytesSha256: '44'.repeat(32) }), undefined);
  assert.equal(replay({ ...block, transactions: [] }), undefined);
  assert.equal(
    replay({ ...block, transactions: [...block.transactions, ...block.transactions] }),
    undefined,
  );
  assert.throws(
    () => replay({ ...block, ledgerParameters: new Uint8Array(65_537) }),
    /byte budget/,
  );
  assert.throws(
    () => replayLedgerTransition(Ledger, block, snapshot, roots, target, AbortSignal.abort()),
    /aborted/i,
  );
});

function setupSource(f: Pick<ReturnType<typeof setup>, 'block' | 'snapshot' | 'roots'>) {
  const state = {
    specVersion: 2_001_000,
    finalizedHeight: '0x2',
    chainGenesis: genesis,
    chainHash: blockHash,
    reads: 0,
  };
  const source = createShieldedTransitionSource({
    genesisHash: genesis,
    nodeUrl,
    ledger: Ledger,
    async fetch(url, init) {
      assert.equal(url, nodeUrl);
      assert.equal(init?.redirect, 'error');
      assert.equal(typeof init?.body, 'string');
      const { method, params } = JSON.parse(String(init?.body));
      switch (method) {
        case 'chain_getBlockHash':
          return Response.json({
            id: 1,
            result: '0x' + (params[0] === 0 ? state.chainGenesis : state.chainHash),
          });
        case 'chain_getFinalizedHead':
          return Response.json({ id: 1, result: '0x' + blockHash });
        case 'chain_getHeader':
          return Response.json({
            id: 1,
            result: { number: state.finalizedHeight, parentHash: '0x' + parentHash },
          });
        case 'state_getRuntimeVersion':
          assert.ok(['0x' + parentHash, '0x' + blockHash].includes(params[0]));
          return Response.json({ id: 1, result: { specVersion: state.specVersion } });
        case 'midnight_ledgerStateRoot': {
          const expected = params[0] === '0x' + parentHash ? f.roots.parent : f.roots.block;
          return Response.json({ id: 1, result: [...Buffer.from(expected, 'hex')] });
        }
        default:
          throw new Error('Unexpected RPC method.');
      }
    },
    async readCanonicalBlock(hash) {
      assert.equal(hash, blockHash);
      state.reads++;
      return f.block;
    },
    async readLedgerSnapshot(hash) {
      assert.equal(hash, parentHash);
      return f.snapshot;
    },
  });
  return { source, state };
}

test('only a canonical finalized block on the pinned runtime reaches the ordered replay input', async () => {
  const f = setup();
  const { source, state } = setupSource(f);
  const signal = new AbortController().signal;
  const query = {
    ...f.target,
    blockHash,
    blockHeight: 2,
    account: '55'.repeat(32),
    commitment: '66'.repeat(32),
    index: 1n,
  };
  const verify = () => source.verifyInsertion(query, signal);

  state.finalizedHeight = '0x1';
  assert.equal(await verify(), false);
  assert.equal(state.reads, 0);
  state.finalizedHeight = '0x2';
  state.chainGenesis = '77'.repeat(32);
  assert.equal(await verify(), false);
  assert.equal(state.reads, 0);
  state.chainGenesis = genesis;
  state.chainHash = '88'.repeat(32);
  assert.equal(await verify(), false);
  assert.equal(state.reads, 0);
  state.chainHash = blockHash;
  state.specVersion++;
  assert.equal(await verify(), false);
  assert.equal(state.reads, 1);
  state.specVersion--;
  assert.equal(await verify(), false, 'a confirmed transaction without this output cannot qualify');
  assert.equal(state.reads, 2);
});

test('keeps the exact pre/post transaction state between system calls in the same block', () => {
  const { block, tx, target } = setup();
  const locked = 10_000_000_000_000_000n;
  const state = Ledger.LedgerState.testingFromGenesis(
    'undeployed',
    locked,
    locked,
    4_000_000_000_000_000n,
  );
  const date = new Date(timestamp);
  // Ledger 9 tag, UnlockToTreasury enum variant, then a SCALE compact amount.
  const unlock = (amount: number) => ({
    kind: 'system' as const,
    bytes: Buffer.concat([
      Buffer.from('midnight:system-transaction[v9]:'),
      Buffer.of(7, amount << 2),
    ]),
  });
  const before = state.testingUnlockToTreasury(10n, date);
  const strictness = new Ledger.WellFormedStrictness();
  strictness.enforceBalancing = false;
  const context = new Ledger.TransactionContext(before, {
    parentBlockHash: parentHash,
    secondsSinceEpoch: 1_800_000_000n,
    secondsSinceEpochErr: 30,
    lastBlockTime: 1_799_999_999n,
  });
  const [after] = before.apply(tx.wellFormed(before, strictness, date), context);
  const fullness = before.parameters.normalizeFullness(tx.cost(before.parameters, true));
  const end = after
    .testingUnlockToTreasury(20n, date)
    .postBlockUpdate(date, fullness, Math.max(...Object.values(fullness)));
  const input = {
    ...block,
    transactions: [unlock(10), ...block.transactions, unlock(20)],
    ledgerParameters: end.parameters.serialize(),
  };
  const snapshot = state.serialize();
  const roots = {
    parent: ledgerStateRootV18(snapshot),
    block: ledgerStateRootV18(end.serialize()),
  };
  const signal = new AbortController().signal;
  const exact = replayLedgerTransition(Ledger, input, snapshot, roots, target, signal);
  assert.ok(exact);
  assert.deepEqual(exact.before.serialize(), before.serialize());
  assert.deepEqual(exact.after.serialize(), after.serialize());
  assert.equal(exact.before.lockedPool, locked - 10n);
  assert.equal(exact.after.lockedPool, locked - 10n);
  assert.equal(end.lockedPool, locked - 30n);
  const missingSuffix = { ...input, transactions: input.transactions.slice(0, -1) };
  assert.equal(
    replayLedgerTransition(Ledger, missingSuffix, snapshot, roots, target, signal),
    undefined,
  );
});

test('uses the original successful replay event and the exact account states in a mixed block', async (t) => {
  const { block, tx, target } = setup();
  const account = '55'.repeat(32);
  const commitment = '66'.repeat(32);
  const date = new Date(timestamp);
  const locked = 10_000_000_000_000_000n;
  const parent = Ledger.LedgerState.testingFromGenesis(
    'undeployed',
    locked,
    locked,
    4_000_000_000_000_000n,
  ).updateIndex(account, new Ledger.ChargedState(Ledger.StateValue.newNull()), new Map());
  const system = Ledger.SystemTransaction.deserialize(
    Buffer.concat([Buffer.from('midnight:system-transaction[v9]:'), Buffer.of(7, 4)]),
  );
  const before = parent.applySystemTx(system, date)[0];
  const nextData = new Ledger.ChargedState(
    Ledger.StateValue.newArray().arrayPush(Ledger.StateValue.newNull()),
  );
  const after = before.updateIndex(account, nextData, new Map());
  const fullness = before.parameters.normalizeFullness(tx.cost(before.parameters, true));
  const end = after
    .applySystemTx(system, date)[0]
    .postBlockUpdate(date, fullness, Math.max(...Object.values(fullness)));
  const snapshot = parent.serialize();
  const systemCall = { kind: 'system' as const, bytes: system.serialize() };
  const { source } = setupSource({
    block: {
      ...block,
      transactions: [systemCall, ...block.transactions, systemCall],
      ledgerParameters: end.parameters.serialize(),
    },
    snapshot,
    roots: { parent: ledgerStateRootV18(snapshot), block: ledgerStateRootV18(end.serialize()) },
  });
  const event = {
    source: { transactionHash: target.txHash },
    content: { tag: 'zswapOutput', contract: account, commitment, mtIndex: 1n },
  };
  let events = [event];
  let type: Ledger.TransactionResult['type'] = 'success';
  // Replace only the regular call effects. Actual WASM decodes the transaction
  // and executes both system calls, and real ledger roots bind the state changes.
  const apply = Ledger.LedgerState.prototype.apply;
  t.mock.method(
    Ledger.LedgerState.prototype,
    'apply',
    function (this: Ledger.LedgerState, ...args: Parameters<typeof apply>) {
      assert.equal(this.lockedPool, locked - 1n);
      const [state, result] = apply.call(this, ...args);
      Object.defineProperties(result, { events: { value: events }, type: { value: type } });
      return [state.updateIndex(account, nextData, new Map()), result];
    },
  );
  const signal = new AbortController().signal;
  const request = { blockHash, blockHeight: block.height, account };
  const insertion = { ...request, ...target, commitment, index: 1n };
  const append = { ...request, identity: target };
  assert.equal(await source.verifyInsertion(insertion, signal), true);
  const transition = await source.readAuthenticatedTransition(append, signal);
  assert.ok(transition);
  assert.deepEqual(transition.before.serialize(), before.index(account)?.serialize());
  assert.deepEqual(transition.after.serialize(), after.index(account)?.serialize());
  assert.equal(await source.verifyInsertion({ ...insertion, index: 2n }, signal), false);
  events = [event, { ...event, content: { ...event.content, mtIndex: 2n } }];
  assert.equal(await source.verifyInsertion(insertion, signal), false);
  events = [event];
  type = 'partialSuccess';
  assert.equal(await source.verifyInsertion(insertion, signal), false);
  assert.equal(await source.readAuthenticatedTransition(append, signal), undefined);
});
