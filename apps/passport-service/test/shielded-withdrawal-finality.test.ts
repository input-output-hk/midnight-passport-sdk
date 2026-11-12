import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import * as Ledger from '@midnightntwrk/ledger-v9';
import { createShieldedWithdrawalFinality } from '../src/shielded-withdrawal-finality.ts';
import { verifyShieldedInsertionByReplay } from '../src/shielded-withdrawal-replay.ts';

const account = 'ab'.repeat(32);
const block = '11'.repeat(32);
const nodeUrl = 'http://localhost:19964';
const indexerUrl = 'http://localhost:18108/api/v4/graphql';
const circuit = 'withdraw_shielded_with_jubjub';

function fixture() {
  const inputCoin = { type: '22'.repeat(32), nonce: '33'.repeat(32), value: 17n, mt_index: 0n };
  const old = Ledger.ZswapOutput.newContractOwned(inputCoin, undefined, account);
  const [unhashed] = new Ledger.ZswapChainState().tryApply(Ledger.ZswapOffer.fromOutput(old));
  const state = unhashed.postBlockUpdate(new Date(), 3600n);
  const input = Ledger.ZswapInput.newContractOwned(inputCoin, undefined, account, state);
  const payout = Ledger.ZswapOutput.new(
    { ...inputCoin, nonce: '44'.repeat(32), value: 5n },
    undefined,
    Ledger.sampleCoinPublicKey(),
    Ledger.sampleEncryptionPublicKey(),
  );
  const change = Ledger.ZswapOutput.newContractOwned(
    { ...inputCoin, nonce: '55'.repeat(32), value: 12n },
    undefined,
    account,
  );
  const effects: Ledger.Effects = {
    claimedNullifiers: [input.nullifier],
    claimedShieldedSpends: [payout.commitment, change.commitment],
    claimedShieldedReceives: [change.commitment],
    claimedContractCalls: [],
    shieldedMints: new Map(),
    unshieldedMints: new Map(),
    unshieldedInputs: new Map(),
    unshieldedOutputs: new Map(),
    claimedUnshieldedSpends: new Map(),
  };
  const transcript: Ledger.Transcript<Ledger.AlignedValue> = {
    effects,
    gas: { readTime: 0n, computeTime: 0n, bytesWritten: 0n, bytesDeleted: 0n },
    program: [],
  };
  const empty = { value: [], alignment: [] };
  const random = Ledger.communicationCommitmentRandomness();
  const call = new Ledger.ContractCallPrototype(
    account,
    circuit,
    new Ledger.ContractOperation(),
    transcript,
    undefined,
    [],
    empty,
    empty,
    random,
    'fixture',
  );
  const offer = Ledger.ZswapOffer.fromInput(input)
    .merge(Ledger.ZswapOffer.fromOutput(payout))
    .merge(Ledger.ZswapOffer.fromOutput(change));
  const tx = Ledger.Transaction.fromParts(
    'undeployed',
    offer,
    undefined,
    Ledger.Intent.new(new Date(Date.now() + 60_000)).addCall(call),
  );
  const raw = Buffer.from(tx.serialize());
  const identity = {
    txHash: '66'.repeat(32),
    bytesSha256: createHash('sha256').update(raw).digest('hex'),
    identifiers: ['77'.repeat(32)],
  };
  const [, indices] = state.tryApply(offer);
  const payoutIndex = indices.get(payout.commitment);
  const changeIndex = indices.get(change.commitment);
  assert.ok(payoutIndex !== undefined && changeIndex !== undefined);
  const source = { transactionHash: identity.txHash, logicalSegment: 0, physicalSegment: 0 };
  const inputEvent: Ledger.EventDetails = {
    tag: 'zswapInput',
    nullifier: input.nullifier,
    contract: account,
  };
  const payoutEvent: Ledger.EventDetails = {
    tag: 'zswapOutput',
    commitment: payout.commitment,
    contract: undefined,
    mtIndex: payoutIndex,
  };
  const changeEvent = {
    tag: 'zswapOutput' as const,
    commitment: change.commitment,
    contract: account,
    mtIndex: changeIndex,
  };
  return {
    state,
    tx,
    raw,
    identity,
    callCommitment: Ledger.communicationCommitment(empty, empty, random),
    source,
    inputEvent,
    payoutEvent,
    changeEvent,
    changeIndex,
    inputNullifier: input.nullifier,
    payoutCommitment: payout.commitment,
    changeCommitment: change.commitment,
  };
}

test('host observes only the original finalized withdrawal with independently matched change index', async () => {
  const f = fixture();
  const queries: string[] = [];
  let raw = f.raw.toString('hex');
  let canonical = block;
  let finalizedHeight = '0x20';
  let indexedEvents = ['01', '02', '03'];
  let changeHash = f.identity.txHash;
  let changeSegment = 0;
  let insertionProven = true;
  let indexedChange = f.changeIndex;
  const finality = createShieldedWithdrawalFinality({
    nodeUrl,
    indexerUrl,
    networkId: 'undeployed',
    versionOfRecord: () => 'v9',
    ledger: {
      ContractCall: Ledger.ContractCall,
      Transaction: {
        deserialize(_s, _p, _b, bytes) {
          assert.deepEqual(Buffer.from(bytes), f.raw);
          // Exercise actual ledger calls and offers with a synthetic, unproven fixture.
          return {
            intents: f.tx.intents,
            guaranteedOffer: f.tx.guaranteedOffer,
            fallibleOffer: f.tx.fallibleOffer,
            transactionHash: () => f.identity.txHash,
            identifiers: () => f.identity.identifiers,
          } as unknown as Ledger.FinalizedTransaction;
        },
      },
      Event: {
        deserialize(bytes) {
          const event = [f.inputEvent, f.payoutEvent, { ...f.changeEvent, mtIndex: indexedChange }][
            (bytes[0] ?? 0) - 1
          ];
          assert.ok(event);
          const source =
            event.tag === 'zswapOutput' && event.commitment === f.changeCommitment
              ? { ...f.source, transactionHash: changeHash, logicalSegment: changeSegment }
              : f.source;
          return { source, content: event } as Ledger.Event;
        },
      },
    },
    async fetch(url, init) {
      assert.equal(init?.redirect, 'error');
      assert.ok(typeof init?.body === 'string');
      const body = JSON.parse(init.body);
      if (url === indexerUrl) {
        queries.push('indexer');
        assert.match(body.query, /zswapLedgerEvents/);
        assert.deepEqual(body.variables, { offset: { identifier: f.identity.identifiers[0] } });
        return Response.json({
          data: {
            transactions: [
              {
                __typename: 'RegularTransaction',
                protocolVersion: 2001000,
                raw,
                hash: f.identity.txHash,
                identifiers: f.identity.identifiers,
                block: { hash: block, height: 10 },
                transactionResult: { status: 'SUCCESS' },
                zswapStartIndex: '1',
                zswapEndIndex: '4',
                zswapLedgerEvents: indexedEvents.map((raw) => ({ raw })),
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
          return Response.json({ id: 1, result: { number: finalizedHeight } });
        case 'chain_getBlockHash':
          return Response.json({ id: 1, result: '0x' + canonical });
        default:
          return assert.fail('Finality must be read only.');
      }
    },
    async verifyInsertion(output, _signal, transaction) {
      queries.push('independent insertion');
      assert.deepEqual(
        { ...output, index: f.changeIndex },
        {
          txHash: f.identity.txHash,
          bytesSha256: f.identity.bytesSha256,
          blockHash: block,
          blockHeight: 10,
          account,
          commitment: f.changeCommitment,
          index: f.changeIndex,
        },
      );
      return (
        insertionProven &&
        verifyShieldedInsertionByReplay(f.state, transaction, output.commitment, output.index)
      );
    },
  });
  const observe = () => finality.readFinalized(f.identity);
  const canonicalQueries = [
    'indexer',
    'chain_getFinalizedHead',
    'chain_getHeader',
    'chain_getBlockHash',
  ];
  raw = 'abcd';
  assert.equal(await observe(), undefined);
  assert.deepEqual(queries.splice(0), ['indexer']);
  raw = f.raw.toString('hex');
  finalizedHeight = '0x9';
  assert.equal(await observe(), undefined);
  assert.deepEqual(queries.splice(0), canonicalQueries.slice(0, -1));
  finalizedHeight = '0x20';
  canonical = 'ee'.repeat(32);
  assert.equal(await observe(), undefined);
  assert.deepEqual(queries.splice(0), canonicalQueries);
  canonical = block;
  indexedEvents = ['01', '02', '03', '03'];
  assert.equal(await observe(), undefined);
  assert.deepEqual(queries.splice(0), canonicalQueries);
  indexedEvents = ['01', '02', '03'];
  changeHash = 'ff'.repeat(32);
  assert.equal(await observe(), undefined);
  assert.deepEqual(queries.splice(0), canonicalQueries);
  changeHash = f.identity.txHash;
  changeSegment = 1;
  assert.equal(await observe(), undefined);
  assert.deepEqual(queries.splice(0), canonicalQueries);
  changeSegment = 0;
  indexedChange = 3n;
  assert.equal(await observe(), undefined);
  assert.deepEqual(queries.splice(0), [...canonicalQueries, 'independent insertion']);
  indexedChange = f.changeIndex;
  insertionProven = false;
  assert.equal(await observe(), undefined);
  assert.deepEqual(queries.splice(0), [...canonicalQueries, 'independent insertion']);
  insertionProven = true;
  assert.deepEqual(await observe(), {
    bindingId: 'acc-s3r1.1',
    account,
    circuit,
    inputNullifier: f.inputNullifier,
    blockHash: block,
    blockHeight: 10,
    dispatch: { identity: f.identity, callCommitment: f.callCommitment },
    outputCommitments: [f.payoutCommitment, f.changeCommitment],
    changeOutput: { account, commitment: f.changeCommitment, index: f.changeIndex },
  });
});
