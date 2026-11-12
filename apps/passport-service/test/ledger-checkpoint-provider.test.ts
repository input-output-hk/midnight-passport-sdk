import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createHash } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer, type IncomingMessage } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';
import * as Ledger from '@midnightntwrk/ledger-v9';
import { TypeRegistry } from '@polkadot/types';
import type { Header } from '@polkadot/types/interfaces';
import { createLedgerCheckpointProvider } from '../src/ledger-checkpoint-provider.ts';
import { ledgerStateRootV18 } from '../src/ledger-state-root.ts';

const metadata = '0x6d6574610e000000040000';
const metadataSha256 = createHash('sha256')
  .update(Buffer.from(metadata.slice(2), 'hex'))
  .digest('hex');
const hex = (value: number) => '0x' + value.toString(16);
const signal = () => AbortSignal.timeout(15_000);

function makeChain() {
  const registry = new TypeRegistry();
  let state = Ledger.LedgerState.blank('undeployed');
  let parentHash = '0x' + '00'.repeat(32);
  return Array.from({ length: 7 }, (_, height) => {
    const number = hex(height);
    const raw = {
      parentHash,
      number,
      stateRoot: '0x' + '11'.repeat(32),
      extrinsicsRoot: '0x' + '22'.repeat(32),
      digest: { logs: [] },
    };
    const hash = registry.createType<Header>('Header', raw).hash.toHex();
    const timestamp = Buffer.alloc(8);
    timestamp.writeBigUInt64LE(BigInt(height * 1000));
    if (height) {
      state = state.postBlockUpdate(
        new Date(height * 1000),
        { readTime: 0, computeTime: 0, blockUsage: 0, bytesWritten: 0, bytesChurned: 0 },
        0,
      );
    }
    const snapshot = Buffer.from(state.serialize());
    const result = {
      hash,
      timestamp: '0x' + timestamp.toString('hex'),
      header: raw,
      snapshot,
      root: [...Buffer.from(ledgerStateRootV18(snapshot), 'hex')],
      parameters: Buffer.from(state.parameters.serialize()).toString('hex'),
    };
    parentHash = hash;
    return result;
  });
}

async function body(request: IncomingMessage) {
  let bytes = '';
  for await (const chunk of request) bytes += String(chunk);
  return JSON.parse(bytes) as {
    method?: string;
    params?: (number | string)[];
    variables?: { hash: string };
  };
}

async function serveChain(t: TestContext) {
  const chain = makeChain();
  const genesis = chain[0];
  assert.ok(genesis);
  const control = {
    finalized: 4,
    best: 5,
    invalidRootAt: -1,
    changeBest: false,
    finalizedIndexerOnly: false,
    genesisReads: 0,
    beforeReply: async (_method: string) => {},
  };
  const root = await mkdtemp(join(tmpdir(), 'passport-ledger-checkpoints-'));
  const server = createServer(async (req, res) => {
    try {
      const { method, params = [], variables } = await body(req);
      const requested = chain.find((block) => block.hash === params.at(-1));
      const height = requested ? Number(requested.header.number) : -1;
      const reply = (result: unknown) => res.end(JSON.stringify({ id: 1, result }));
      await control.beforeReply(method ?? 'indexer');
      if (req.url === '/graphql') {
        const indexed = chain.find(
          ({ hash }, height) =>
            hash.slice(2) === variables?.hash &&
            (!control.finalizedIndexerOnly || height <= control.finalized),
        );
        return res.end(
          JSON.stringify({
            data: {
              block: indexed && {
                hash: indexed.hash.slice(2),
                ledgerParameters: indexed.parameters,
              },
            },
          }),
        );
      }
      switch (method) {
        case 'system_properties':
          control.genesisReads++;
          return reply({ genesis_state: genesis.snapshot.toString('hex') });
        case 'chain_getBlockHash': {
          const best = control.best;
          if (!params.length && control.changeBest) control.best++;
          return reply(chain[Number(params[0] ?? best)]?.hash);
        }
        case 'chain_getFinalizedHead':
          return reply(chain[control.finalized]?.hash);
        case 'chain_getHeader':
          return reply(requested?.header);
        case 'chain_getBlock':
          return reply({ block: { header: requested?.header, extrinsics: [] } });
        case 'state_getMetadata':
          return reply(metadata);
        case 'state_getRuntimeVersion':
          return reply({ specVersion: 2_001_000 });
        case 'midnight_ledgerStateRoot':
          return reply(height === control.invalidRootAt ? genesis.root : requested?.root);
        case 'state_getStorage':
          return reply(String(params[0]).startsWith('0x26aa') ? '0x00' : requested?.timestamp);
        default:
          return res.writeHead(500).end();
      }
    } catch {
      res.writeHead(500).end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    await rm(root, { recursive: true });
  });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const nodeUrl = 'http://127.0.0.1:' + address.port;
  const genesisHash = genesis.hash.slice(2);
  const options = {
    directory: root,
    nodeUrl,
    indexerUrl: nodeUrl + '/graphql',
    genesisHash,
    metadataSha256,
    retainedBlocks: 3,
    blocksPerAdvance: 2,
  };
  const hash = (height: number) =>
    chain[height]?.hash.slice(2) ?? assert.fail('Unknown fixture height.');
  const directory = join(root, `v18-${genesisHash}-${metadataSha256}-3`);
  return { chain, control, options, hash, directory };
}

test('resumes an authenticated finalized cursor and reads exact retained and best snapshots', async (t) => {
  const f = await serveChain(t);
  const initial = createLedgerCheckpointProvider(f.options);
  assert.deepEqual(await initial.advanceFinalized(signal()), {
    height: 2,
    blockHash: f.hash(2),
    finalizedHeight: 4,
  });
  assert.equal(f.control.genesisReads, 1);
  const reopened = createLedgerCheckpointProvider(f.options);
  assert.deepEqual(await reopened.advanceFinalized(signal()), {
    height: 4,
    blockHash: f.hash(4),
    finalizedHeight: 4,
  });
  assert.equal(f.control.genesisReads, 1, 'restart uses the authenticated durable cursor');
  assert.deepEqual(
    await reopened.readLedgerSnapshot(f.hash(3), signal()),
    new Uint8Array(f.chain[3]?.snapshot ?? []),
  );
  assert.equal(await reopened.readLedgerSnapshot(f.hash(1), signal()), undefined);
  const beforeBest = (await readdir(f.directory)).sort();
  assert.deepEqual(
    await reopened.readLedgerSnapshot(f.hash(5), signal()),
    new Uint8Array(f.chain[5]?.snapshot ?? []),
  );
  assert.deepEqual(
    (await readdir(f.directory)).sort(),
    beforeBest,
    'best replay is never persisted',
  );
  f.control.changeBest = true;
  assert.equal(await reopened.readLedgerSnapshot(f.hash(5), signal()), undefined);
  assert.deepEqual((await readdir(f.directory)).sort(), beforeBest);
});

test('authenticates an empty best block that the finalized-only indexer cannot serve', async (t) => {
  const f = await serveChain(t);
  f.control.finalizedIndexerOnly = true;
  const provider = createLedgerCheckpointProvider(f.options);
  assert.equal((await provider.advanceFinalized(signal()))?.height, 2);
  assert.equal((await provider.advanceFinalized(signal()))?.height, 4);
  const before = (await readdir(f.directory)).sort();
  assert.deepEqual(
    await provider.readLedgerSnapshot(f.hash(5), signal()),
    new Uint8Array(f.chain[5]?.snapshot ?? []),
  );
  f.control.invalidRootAt = 5;
  assert.equal(await provider.readLedgerSnapshot(f.hash(5), signal()), undefined);
  assert.deepEqual((await readdir(f.directory)).sort(), before);
});

test('rebuilds a historical finalized snapshot without moving the live cursor', async (t) => {
  const f = await serveChain(t);
  const live = createLedgerCheckpointProvider(f.options);
  assert.equal((await live.advanceFinalized(signal()))?.height, 2);
  assert.equal((await live.advanceFinalized(signal()))?.height, 4);
  assert.equal(await live.readLedgerSnapshot(f.hash(1), signal()), undefined);
  assert.equal(await live.advanceFinalized(signal(), 1), undefined);
  const historicalDirectory = await mkdtemp(join(f.options.directory, 'historical-'));
  const historical = createLedgerCheckpointProvider({
    ...f.options,
    directory: historicalDirectory,
  });
  assert.equal((await historical.advanceFinalized(signal(), 1))?.height, 1);
  assert.deepEqual(
    await historical.readLedgerSnapshot(f.hash(1), signal()),
    new Uint8Array(f.chain[1]?.snapshot ?? []),
  );
  assert.equal((await live.advanceFinalized(signal()))?.height, 4);
});

test('publishes only authenticated blocks and refuses a tampered checkpoint after restart', async (t) => {
  const f = await serveChain(t);
  const initial = createLedgerCheckpointProvider(f.options);
  f.control.invalidRootAt = 2;
  assert.equal(await initial.advanceFinalized(signal()), undefined);
  assert.deepEqual((await readdir(f.directory)).sort(), ['checkpoint-0.bin', 'checkpoint-1.bin']);
  f.control.invalidRootAt = -1;
  const abandoned = join(f.directory, '.pending-a1234567-b123-c123-d123-e123456789ab');
  await writeFile(abandoned, 'interrupted bytes', { mode: 0o600 });
  const restarted = createLedgerCheckpointProvider(f.options);
  assert.equal((await restarted.advanceFinalized(signal()))?.height, 3);
  const path = join(f.directory, 'checkpoint-0.bin');
  const bytes = await readFile(path);
  bytes[40] = 0;
  await writeFile(path, bytes);
  assert.equal(await restarted.readLedgerSnapshot(f.hash(3), signal()), undefined);
  assert.equal(await restarted.advanceFinalized(signal()), undefined);
  assert.deepEqual((await readdir(f.directory)).sort(), [
    'checkpoint-0.bin',
    'checkpoint-1.bin',
    'checkpoint-2.bin',
  ]);
});

test('refuses overlapping work and can restart after the owned replay worker is cancelled', async (t) => {
  const f = await serveChain(t);
  let arrived = () => {};
  const inFlight = new Promise<void>((resolve) => {
    arrived = resolve;
  });
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  f.control.beforeReply = async (method) => {
    if (method === 'chain_getBlock') {
      arrived();
      await held;
    }
  };
  const provider = createLedgerCheckpointProvider(f.options);
  const cancel = new AbortController();
  t.after(() => {
    cancel.abort();
    release();
  });
  const advance = provider.advanceFinalized(AbortSignal.any([cancel.signal, signal()]));
  await Promise.race([
    inFlight,
    advance.then(() => assert.fail('Replay stopped before fetching a block.')),
  ]);
  assert.equal(await provider.readLedgerSnapshot(f.hash(1), signal()), undefined);
  cancel.abort();
  release();
  assert.equal(await advance, undefined);
  assert.deepEqual((await readdir(f.directory)).sort(), ['checkpoint-0.bin']);
  f.control.beforeReply = async () => {};
  assert.equal((await provider.advanceFinalized(signal()))?.height, 2);
});

test('resumes the last completed checkpoint after the host process is killed', async (t) => {
  const f = await serveChain(t);
  let arrived = () => {};
  const inFlight = new Promise<void>((resolve) => {
    arrived = resolve;
  });
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let calls = 0;
  f.control.beforeReply = async (method) => {
    if (method === 'chain_getBlock' && ++calls === 2) {
      arrived();
      await held;
    }
  };
  const child = spawn(
    process.execPath,
    [
      '--import',
      'tsx',
      '--input-type=module',
      '-e',
      'const { createLedgerCheckpointProvider } = await import(process.argv[1]); ' +
        'await createLedgerCheckpointProvider(JSON.parse(process.argv[2])).advanceFinalized(AbortSignal.timeout(10000));',
      new URL('../src/ledger-checkpoint-provider.ts', import.meta.url).href,
      JSON.stringify(f.options),
    ],
    { stdio: 'ignore' },
  );
  const closed = once(child, 'exit');
  t.after(async () => {
    release();
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    await closed;
  });
  await Promise.race([
    inFlight,
    closed.then(() => assert.fail('Child exited before replaying the second block.')),
  ]);
  assert.equal(child.kill('SIGKILL'), true);
  assert.deepEqual(await closed, [null, 'SIGKILL']);
  release();
  assert.deepEqual((await readdir(f.directory)).sort(), ['checkpoint-0.bin', 'checkpoint-1.bin']);
  const restarted = createLedgerCheckpointProvider(f.options);
  assert.equal((await restarted.advanceFinalized(signal()))?.height, 3);
  assert.equal(f.control.genesisReads, 1);
});
