// Dedicated localnet only: native owner grant operations, not durable grant continuation.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { privateFiles, publicEvent as emit } from './private-files.ts';
import {
  createHostedAccChain,
  createMidnightGrantSource,
  createMidnightHoldingSource,
  createGraphqlHoldingIndexer,
} from '../../../packages/adapter-midnight-js/dist/index.js';
import { resolveBinding } from '../../../packages/contract/dist/index.js';
import * as binding from '../../../packages/contract/generated/acc-s3r1.1/index.js';
import { mutationDigest } from '../../../packages/account/dist/index.js';
import type {
  PassportPorts,
  AccountRecord,
  AccountHint,
  CallRequest,
} from '../../../packages/account/dist/ports/index.js';
import { softwareParticipant } from '../../../scripts/qualification/identities.mjs';
import { runGrantRecoveryCase } from '../../../scripts/qualification/grant-recovery-case.mjs';

const [mode, root, arm] = process.argv.slice(2);
assert.equal(mode, 'grant-recovery');
assert.ok(root && (arm === 'jubjub' || arm === 'p256'));
assert.equal(process.env.PASSPORT_RC_LOCALNET, '1');
assert.equal(process.env.PASSPORT_LIVE_PROFILE, 'grants');
assert.equal(process.env.MN_NETWORK_ID, 'undeployed');
assert.equal(process.env.MN_NODE_URL, 'http://127.0.0.1:19954');
assert.equal(process.env.MN_INDEXER_URL, 'http://127.0.0.1:18098/api/v4/graphql');
assert.equal(process.env.MN_INDEXER_WS_URL, 'ws://127.0.0.1:18098/api/v4/graphql/ws');
assert.equal(process.env.MN_PROOF_SERVER_URL, 'http://127.0.0.1:16310');
assert.equal(process.env.PASSPORT_SPONSOR_SEED, undefined);
assert.equal(process.env.PASSPORT_SPONSOR_SEED_FILE, undefined);
const files = privateFiles(root);
assert.equal(
  files.exists('grant-recovery-effects.json'),
  false,
  'Never replay an uncertain native grant case.',
);
const fixture = files.read('fixture.json');
const account = files.read('result-create.json').account as string;
const expected = files.read('coin.json');
const setup = files.read('setup-receipt.json');
assert.equal(setup.grantIds.length, 2);
assert.equal(fixture.readGrantSecrets.length, 2);
const protectedFiles = ['grants.json', 'published.json', 'record.json', 'registry.json.v1'];
const retained = Object.fromEntries(
  protectedFiles.map((name) => [
    name,
    createHash('sha256')
      .update(readFileSync(join(root, name)))
      .digest('hex'),
  ]),
);
const operatorRoot = join(root, 'native-grant-operator');
mkdirSync(operatorRoot, { mode: 0o700 });
process.chdir(operatorRoot);
const contract = process.env.PASSPORT_CONTRACT_DIR!;
const referenceImport = (path: string) => import(pathToFileURL(join(contract, path)).href);
const setupModule = await referenceImport('src/node/setup.ts');
const context = await setupModule.setupWallet('0'.repeat(63) + '1');
const handle = await setupModule.connectAccount(context, account);
const network = {
  networkId: 'undeployed',
  bindingId: 'acc-s3r1.1',
  manifestSha256: '77fb9c17b0d59047456c43115d9a58f5cb99a226ee73b6b974fd724930c3153f',
  indexerUrl: process.env.MN_INDEXER_URL!,
  indexerWsUrl: process.env.MN_INDEXER_WS_URL!,
  nodeUrl: process.env.MN_NODE_URL!,
  artefactUrl: '',
};
const native = createHostedAccChain({
  network,
  binding: { id: network.bindingId, ...resolveBinding(network.bindingId) },
  readLedger: async (address) => {
    assert.equal(address, account);
    return handle.ledgerState();
  },
  connectHandle: async (address) => {
    assert.equal(address, account);
    return { callTx: handle.callTx };
  },
});
// The write-ahead request survives failure, but this harness never claims a no-send result
// or resubmits a failed/unknown native grant operation. Start a fresh case only after inspection.
const effects: Array<{
  ordinal: number;
  phase: string;
  input: Pick<CallRequest, 'address' | 'circuit' | 'args'>;
  inputHash: string;
  txHash?: string;
}> = [];
const checkpoint = () =>
  files.save('grant-recovery-effects.json', {
    scope: 'native-single-attempt-owner-grants',
    effects,
  });
checkpoint();
const chain = {
  ...native,
  call: async (request: CallRequest) => {
    const input = { address: request.address, circuit: request.circuit, args: request.args };
    const effect = {
      ordinal: effects.length,
      phase: 'entered',
      input,
      inputHash: mutationDigest(input),
    };
    effects.push(effect);
    checkpoint();
    const result = await native.call(request);
    Object.assign(effect, { phase: 'confirmed', txHash: result.txHash });
    checkpoint();
    return result;
  },
};
const grants = (openings: Parameters<typeof createMidnightGrantSource>[0]['openings']) =>
  createMidnightGrantSource({ network, binding, openings });
const holdingSource = createMidnightHoldingSource(
  createGraphqlHoldingIndexer({
    networkId: network.networkId,
    url: network.indexerUrl,
    wsUrl: network.indexerWsUrl,
  }),
);
let forbiddenJournalTouches = 0;
let freshProfileWrites = 0;
let profiles = 0;
const participants = {
  owner: softwareParticipant(fixture.participants.owner, arm),
  survivor: softwareParticipant(fixture.participants.survivor, arm),
};
const profile = async (role: 'owner' | 'survivor', name: string): Promise<PassportPorts> => {
  assert.match(name, /^[a-z-]+$/);
  const path = join(root, name);
  mkdirSync(path, { mode: 0o700 });
  const fresh = privateFiles(path);
  profiles++;
  const participant = participants[role];
  const forbidden = async (): Promise<never> => {
    forbiddenJournalTouches++;
    throw new Error('The original issuing journal is unavailable in the fresh profile.');
  };
  return {
    network,
    binding,
    chain,
    authoriser: participant.authoriser,
    credentials: participant.credentials,
    viewingKey: participant.keyring,
    encryptionKey: { publicKey: forbidden },
    holdings: holdingSource,
    grantOrigin: 'localhost',
    deployer: { deploy: forbidden },
    // A separate empty local directory/profile; no remote original hint or journal fallback.
    directory: {
      get: async () =>
        fresh.exists('hint.json') ? (fresh.read('hint.json') as AccountHint) : undefined,
      put: async (_n, hint) => {
        freshProfileWrites++;
        fresh.save('hint.json', hint);
      },
    },
    records: {
      read: async () =>
        fresh.exists('record.json') ? (fresh.read('record.json') as AccountRecord) : undefined,
      exists: async () => fresh.exists('record.json'),
      write: async (record) => {
        freshProfileWrites++;
        fresh.save('record.json', record);
      },
    },
    grantJournal: {
      stage: forbidden,
      load: forbidden,
      pending: forbidden,
      markPublished: forbidden,
    },
  };
};
try {
  const result = await runGrantRecoveryCase({
    account,
    origin: 'localhost',
    pure: binding.pureCircuits,
    profile,
    grants,
    grantees: setup.grantIds.map((grantId: string, index: number) => ({
      grantId,
      readSecret: fixture.readGrantSecrets[index],
    })),
    heldCoins: 1,
    effectCount: () => effects.length + freshProfileWrites,
    assertRetained: async () => {
      for (const [name, digest] of Object.entries(retained))
        assert.equal(
          createHash('sha256')
            .update(readFileSync(join(root, name)))
            .digest('hex'),
          digest,
          'Original protected profile changed.',
        );
      assert.equal(forbiddenJournalTouches, 0);
    },
    assertHoldings: async () => {
      const live = await chain.readAccount(account, { includeInbox: true, includeDevices: true });
      assert.ok(live?.encKey && live.inboxEntries);
      for (const participant of Object.values(participants)) {
        const opened = await participant.keyring.openInbox(
          network.networkId,
          { account, encKey: live.encKey, envelopes: live.inboxEntries },
          live.inboxEntries,
        );
        const held = await holdingSource.selectQualifiedHeldCoins(
          account,
          live.inboxEntries,
          opened,
        );
        assert.equal(held.length, 1);
        assert.deepEqual(held[0]!.coin.nonce, expected.nonce);
        assert.deepEqual(held[0]!.coin.color, expected.color);
        assert.equal(held[0]!.coin.value, 7n);
      }
    },
    stage: async (summary) => emit({ grantRecoveryStage: summary }),
  });
  assert.equal(profiles, 4);
  assert.ok(effects.length > 0 && effects.every((e) => e.phase === 'confirmed'));
  const summary = {
    completed: 'grant-recovery',
    ...result,
    profiles,
    forbiddenJournalTouches,
    freshProfileWrites,
    refusalChecksIncludeProfileWrites: true,
    nativeCalls: effects.length,
    heldCoinsQualified: 1,
    confirmedCircuits: effects.map((e) => e.input.circuit),
    protectedProfileUnchanged: true,
  };
  files.save('grant-recovery-result.json', summary);
  emit(summary);
} finally {
  await context.walletCtx.wallet.stop();
}
process.exit(0);
