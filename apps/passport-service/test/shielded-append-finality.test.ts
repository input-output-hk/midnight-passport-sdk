import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import * as Ledger from '@midnightntwrk/ledger-v9';
import { fileMutationByteStore } from '@input-output-hk/mn-passport-service';
import { mutationDigest, toHex } from '../../../packages/account/dist/index.js';
import type { ShieldedBackfillRecord } from '../../../packages/account/dist/index.js';
import { ledger as readPinnedLedger } from '../../../packages/contract/generated/acc-s3r1.1/index.js';
import { AccSimulator } from '../../../scripts/qualification/acc-simulator.mjs';
import { createHostShieldedAppendFinality } from '../src/shielded-append-finality.ts';
import {
  createHostShieldedAppendReceipts,
  forwardHostShieldedAppend,
} from '../src/shielded-append-receipts.ts';

const nodeUrl = 'http://localhost:19964';
const indexerUrl = 'http://localhost:18108/api/v4/graphql';
const networkId = 'undeployed';
const txHash = 'ab'.repeat(32);
const blockHash = 'cd'.repeat(32);
const submissionId = 'ef'.repeat(32);
const identifiers = [submissionId];
const circuit = 'append_inbox_with_jubjub';

test('host forwards once and recovers the original finalized append at its executed index', async (t) => {
  const sim = await AccSimulator.create();
  const { address: account, owner } = sim;
  await sim.authorised('append_inbox', [new Uint8Array(192).fill(7)], owner, 0n);
  const before = sim.state;
  const entry = new Uint8Array(192).fill(9);
  let appendArgs: readonly unknown[] = [];
  const call = sim.call.bind(sim);
  sim.call = async (name, ...args) => {
    appendArgs = args;
    return call(name, ...args);
  };
  await sim.authorised('append_inbox', [entry], owner, 1n);
  const after = sim.state;
  const approvedArgs = appendArgs;
  const proof = sim.lastProofData?.[0];
  assert.ok(proof);
  const { input: proofInput, output: proofOutput } = proof;
  sim.state = before;
  await sim.authorised('append_inbox', [new Uint8Array(192).fill(8)], owner, 1n);
  const otherEntry = sim.state;
  assert.equal(readPinnedLedger(before).inbox_count, 1n);
  assert.equal(readPinnedLedger(after).inbox_count, 2n);

  function buildTransaction() {
    const prototype = new Ledger.ContractCallPrototype(
      account,
      circuit,
      new Ledger.ContractOperation(),
      undefined,
      undefined,
      [],
      proofInput,
      proofOutput,
      Ledger.communicationCommitmentRandomness(),
      'fixture',
    );
    return Ledger.Transaction.fromParts(
      networkId,
      undefined,
      undefined,
      Ledger.Intent.new(new Date(Date.now() + 60_000)).addCall(prototype),
    );
  }
  const transaction = buildTransaction();
  const substituted = buildTransaction();
  const substitutedBytes = substituted.serialize();
  const bytes = transaction.serialize();
  const [originalIntent] = transaction.intents?.values() ?? [];
  assert.ok(originalIntent);
  const otherNetwork = Ledger.Transaction.fromParts(
    'preview',
    undefined,
    undefined,
    originalIntent,
  );
  const otherNetworkBytes = otherNetwork.serialize();
  const original: ShieldedBackfillRecord = {
    version: 1,
    networkId,
    account,
    circuit,
    commitment: '13'.repeat(32),
    withdrawalId: 'ca389868-7a7c-4b85-8219-4abc95833afd',
    withdrawalTxHash: '14'.repeat(32),
    appendId: '0f32039b-7bb4-4f19-b9da-d23bbb45a771',
    entry: toHex(entry),
    encKey: toHex(readPinnedLedger(before).enc_key),
    minInboxIndex: 0,
    callArgsSha256: mutationDigest(approvedArgs),
  };
  const intentSha256 = mutationDigest(original);
  const input = { original, args: approvedArgs, intentSha256 };
  const root = await mkdtemp(join(tmpdir(), 'passport-host-shielded-append-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const receipts = createHostShieldedAppendReceipts(fileMutationByteStore(root));
  const ledger = {
    ContractCall: Ledger.ContractCall,
    Transaction: {
      fromParts: Ledger.Transaction.fromParts,
      deserialize(_s: 'signature', _p: 'proof', _b: 'binding', raw: Uint8Array) {
        const envelope = [transaction, substituted, otherNetwork].find(
          (candidate) => toHex(raw) === toHex(candidate.serialize()),
        );
        assert.ok(envelope);
        assert.deepEqual(raw, envelope.serialize());
        // The native call and generated state transition are real. The finalized
        // envelope and inclusion evidence are fixture boundaries in this test.
        return {
          intents: envelope.intents,
          eraseProofs: () => envelope.eraseProofs(),
          transactionHash: () => txHash,
          identifiers: () => identifiers,
        } as unknown as Ledger.FinalizedTransaction;
      },
    },
  };
  let forwards = 0;
  const runtime = {
    networkId,
    ledger,
    receipts,
    async build(target: string, entryPoint: string, args: readonly unknown[]) {
      assert.equal(target, account);
      assert.equal(entryPoint, circuit);
      assert.deepEqual(args, approvedArgs);
      return transaction;
    },
    async finalize(built: Ledger.UnprovenTransaction) {
      assert.equal(built, transaction);
      return bytes;
    },
    async forward(raw: Uint8Array): Promise<string> {
      assert.deepEqual(raw, bytes);
      forwards++;
      throw new Error('Lost forwarding reply');
    },
  };
  assert.equal(
    await forwardHostShieldedAppend({ ...input, args: [new Uint8Array(192)] }, runtime),
    undefined,
  );
  assert.equal(
    await forwardHostShieldedAppend(input, {
      ...runtime,
      finalize: async () => substitutedBytes,
    }),
    undefined,
  );
  assert.equal(
    await forwardHostShieldedAppend(input, {
      ...runtime,
      build: async () => otherNetwork,
      finalize: async () => assert.fail('A wrong-network build must not reach proving.'),
    }),
    undefined,
  );
  assert.equal(
    await forwardHostShieldedAppend(input, {
      ...runtime,
      finalize: async () => otherNetworkBytes,
      forward: async () => {
        forwards++;
        return submissionId;
      },
    }),
    undefined,
  );
  assert.equal(forwards, 0);
  const misleadingBytes = new Uint8Array(otherNetworkBytes);
  misleadingBytes[Symbol.iterator] = bytes[Symbol.iterator].bind(bytes);
  assert.equal(
    await forwardHostShieldedAppend(input, {
      ...runtime,
      finalize: async () => misleadingBytes,
      forward: async () => {
        forwards++;
        return submissionId;
      },
    }),
    undefined,
  );
  assert.equal(forwards, 0);
  const mismatchedAck = {
    ...original,
    appendId: 'da191e9e-4c67-4e60-9f65-33d624f4dd0e',
  };
  assert.equal(
    await forwardHostShieldedAppend(
      { original: mismatchedAck, args: approvedArgs, intentSha256: mutationDigest(mismatchedAck) },
      { ...runtime, forward: async () => '11'.repeat(32) },
    ),
    undefined,
  );
  assert.deepEqual(
    (await receipts.read(mismatchedAck.appendId))?.identity.identifiers,
    identifiers,
  );
  await assert.rejects(
    forwardHostShieldedAppend(input, {
      ...runtime,
      finalize: async () => {
        throw new Error('Injected prover outage before staging');
      },
    }),
    /before staging/,
  );
  assert.equal(await receipts.read(original.appendId), undefined);
  assert.deepEqual(
    await Promise.all([
      forwardHostShieldedAppend(input, runtime),
      forwardHostShieldedAppend(input, runtime),
    ]),
    [undefined, undefined],
  );
  assert.equal(forwards, 1);

  const matchedAck = { ...original, appendId: '697176a2-d462-4b2e-b55f-72f955f66fd3' };
  assert.equal(
    await forwardHostShieldedAppend(
      { original: matchedAck, args: approvedArgs, intentSha256: mutationDigest(matchedAck) },
      { ...runtime, forward: async () => submissionId },
    ),
    submissionId,
  );
  assert.deepEqual((await receipts.read(matchedAck.appendId))?.identity.identifiers, identifiers);

  const restarted = createHostShieldedAppendReceipts(fileMutationByteStore(root));
  assert.equal(
    await forwardHostShieldedAppend(input, {
      ...runtime,
      receipts: restarted,
      build: async () => assert.fail('A staged original must be observed without another build.'),
    }),
    undefined,
  );
  const query = { appendId: original.appendId, intentSha256 };
  let raw = toHex(bytes);
  let finalizedHeight = '0x11';
  let canonical = blockHash;
  type State = Parameters<typeof readPinnedLedger>[0];
  let transition: { before: State; after: State } | undefined = { before, after };
  const calls: string[] = [];
  const finality = createHostShieldedAppendFinality({
    ledger,
    receipts: restarted,
    networkId,
    nodeUrl,
    indexerUrl,
    versionOfRecord: () => 'v9',
    readPinnedLedger,
    async fetch(url, init) {
      assert.equal(init?.redirect, 'error');
      assert.ok(typeof init?.body === 'string');
      const body = JSON.parse(init.body);
      if (url === indexerUrl) {
        calls.push('indexer');
        assert.deepEqual(body.variables, { offset: { identifier: identifiers[0] } });
        return Response.json({
          data: {
            transactions: [
              {
                __typename: 'RegularTransaction',
                protocolVersion: 2001000,
                raw,
                identifiers,
                hash: txHash,
                block: { hash: blockHash, height: 10 },
                transactionResult: { status: 'SUCCESS' },
              },
            ],
          },
        });
      }
      assert.equal(url, nodeUrl);
      calls.push(body.method);
      switch (body.method) {
        case 'chain_getFinalizedHead':
          return Response.json({ id: 1, result: '0x' + '17'.repeat(32) });
        case 'chain_getHeader':
          return Response.json({ id: 1, result: { number: finalizedHeight } });
        case 'chain_getBlockHash':
          return Response.json({ id: 1, result: '0x' + canonical });
        default:
          return assert.fail('Recovery is read only.');
      }
    },
    async readAuthenticatedTransition(request) {
      calls.push('transition');
      assert.deepEqual(request, {
        identity: {
          txHash,
          identifiers,
          bytesSha256: createHash('sha256').update(bytes).digest('hex'),
        },
        blockHash,
        blockHeight: 10,
        account,
      });
      return transition;
    },
  });
  const recover = () => finality.readOriginalAppend(query);
  assert.equal(
    await finality.readOriginalAppend({ ...query, intentSha256: '18'.repeat(32) }),
    undefined,
  );
  assert.deepEqual(calls.splice(0), []);
  raw = '00';
  assert.equal(await recover(), undefined);
  assert.deepEqual(calls.splice(0), ['indexer']);
  raw = toHex(bytes);
  finalizedHeight = '0x9';
  assert.equal(await recover(), undefined);
  assert.ok(!calls.splice(0).includes('transition'));
  finalizedHeight = '0x11';
  canonical = '19'.repeat(32);
  assert.equal(await recover(), undefined);
  assert.ok(!calls.splice(0).includes('transition'));
  canonical = blockHash;
  transition = { before, after: before };
  assert.equal(await recover(), undefined);
  transition = { before, after: otherEntry };
  assert.equal(await recover(), undefined);
  transition = undefined;
  assert.equal(await recover(), undefined);
  transition = { before, after };
  assert.deepEqual(await recover(), {
    ...query,
    account,
    circuit,
    txHash,
    inboxIndex: 1,
    callArgsSha256: original.callArgsSha256,
    entrySha256: createHash('sha256').update(entry).digest('hex'),
  });
});
