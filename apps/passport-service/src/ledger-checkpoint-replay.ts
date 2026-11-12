import * as ledger from '@midnightntwrk/ledger-v9';
import { z } from 'zod';
import { join } from 'node:path';
import {
  fetchJsonBounded,
  hostChainRpc,
  readHostBestHash,
} from '@input-output-hk/mn-passport-service/finality';
import { createCanonicalLedgerBlockReader } from './canonical-ledger-block.ts';
import { replayLedgerSnapshot } from './ledger-block-replay.ts';
import { ledgerStateRootV18, normalizeLedgerRootV18 } from './ledger-state-root.ts';
import { openLedgerCheckpointStore, type CheckpointPosition } from './ledger-checkpoint-store.ts';
import {
  checkpointHash,
  type LedgerCheckpointConfig,
  type LedgerCheckpointJob,
} from './ledger-checkpoint-config.ts';

const rpcHash = z
  .string()
  .regex(/^0x[0-9a-f]{64}$/)
  .transform((value) => value.slice(2));
const heightSchema = z
  .string()
  .regex(/^0x[0-9a-f]{1,16}$/)
  .transform(Number)
  .pipe(z.number().int().nonnegative());
const header = z.object({ number: heightSchema, parentHash: rpcHash });
const runtimeVersion = z.object({ specVersion: z.literal(2_001_000) });
const genesisReply = z.object({
  id: z.literal(1),
  error: z.undefined(),
  result: z.object({ genesis_state: z.string().regex(/^(?:0x)?[0-9a-f]+$/) }),
});
const prefix = (hash: string) => '0x' + hash;

interface VerifiedCheckpoint extends CheckpointPosition {
  readonly snapshot: Uint8Array;
  readonly root: string;
}

async function genesisBytes(nodeUrl: string, signal: AbortSignal): Promise<Uint8Array> {
  const response = await fetchJsonBounded(
    fetch,
    nodeUrl,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'system_properties', params: [] }),
      redirect: 'error',
      signal,
    },
    2 * 1024 * 1024,
  );
  if (!response.ok) throw new Error('Genesis snapshot unavailable.');
  const hex = genesisReply.parse(response.value).result.genesis_state.replace(/^0x/, '');
  if (hex.length % 2 !== 0) throw new Error('Invalid genesis snapshot.');
  return Buffer.from(hex, 'hex');
}

export async function runLedgerCheckpointJob(
  config: LedgerCheckpointConfig,
  job: LedgerCheckpointJob,
  signal: AbortSignal,
) {
  const rpc = hostChainRpc(config, signal);
  const canonicalHash = async (height: number) =>
    rpcHash.parse(await rpc('chain_getBlockHash', [height]));
  const readHeader = async (hash: string) =>
    header.parse(await rpc('chain_getHeader', [prefix(hash)]));
  const readRoot = async (hash: string) =>
    normalizeLedgerRootV18(await rpc('midnight_ledgerStateRoot', [prefix(hash)]));
  async function requireVersion(hash: string) {
    runtimeVersion.parse(await rpc('state_getRuntimeVersion', [prefix(hash)]));
  }

  if ((await canonicalHash(0)) !== config.genesisHash) return undefined;
  const directory = join(
    config.directory,
    `v18-${config.genesisHash}-${config.metadataSha256}-${config.retainedBlocks}`,
  );
  const store = await openLedgerCheckpointStore(directory, config.retainedBlocks);
  const readBlock = createCanonicalLedgerBlockReader(config);
  const finalHash = rpcHash.parse(await rpc('chain_getFinalizedHead', []));
  const finalHeight = (await readHeader(finalHash)).number;
  if ((await canonicalHash(finalHeight)) !== finalHash) return undefined;

  async function authenticate(at: CheckpointPosition, bytes: Uint8Array) {
    await requireVersion(at.blockHash);
    const root = await readRoot(at.blockHash);
    if (ledgerStateRootV18(bytes) !== root) throw new Error('Ledger checkpoint root mismatch.');
    return { ...at, root, snapshot: bytes };
  }

  async function cursor(): Promise<VerifiedCheckpoint> {
    const latest = await store.latest();
    if (!latest) {
      const genesis = { height: 0, blockHash: config.genesisHash };
      return authenticate(genesis, await genesisBytes(config.nodeUrl, signal));
    }
    if (latest.height > finalHeight || (await canonicalHash(latest.height)) !== latest.blockHash)
      throw new Error('Ledger checkpoint is outside canonical finality.');
    const bytes = await store.read(latest);
    if (!bytes) throw new Error('Ledger checkpoint changed while opening it.');
    return authenticate(latest, bytes);
  }

  async function next(previous: VerifiedCheckpoint): Promise<VerifiedCheckpoint> {
    signal.throwIfAborted();
    const height = previous.height + 1;
    const blockHash = await canonicalHash(height);
    const [block, root, nodeHeader] = await Promise.all([
      readBlock(blockHash, signal, height > finalHeight),
      readRoot(blockHash),
      readHeader(blockHash),
      requireVersion(blockHash),
    ]);
    if (
      block?.height !== height ||
      block.blockHash !== blockHash ||
      block.parentHash !== previous.blockHash ||
      nodeHeader.number !== height ||
      nodeHeader.parentHash !== previous.blockHash
    )
      throw new Error('Ledger checkpoint replay block is not the next canonical child.');
    const snapshot = replayLedgerSnapshot(
      ledger,
      block,
      previous.snapshot,
      { parent: previous.root, block: root },
      signal,
    );
    if (!snapshot) throw new Error('Ledger checkpoint replay root mismatch.');
    return { height, blockHash, snapshot, root };
  }

  if (job.kind === 'advance') {
    await store.discardInterruptedWrites();
    let current = await cursor();
    const limit = job.throughHeight ?? finalHeight;
    if (limit < current.height) return undefined;
    if (current.height === 0) await store.write(current, current.snapshot);
    const through = Math.min(limit, finalHeight, current.height + config.blocksPerAdvance);
    while (current.height < through) {
      current = await next(current);
      signal.throwIfAborted();
      await store.write(current, current.snapshot);
    }
    return { height: current.height, blockHash: current.blockHash, finalizedHeight: finalHeight };
  }

  const blockHash = checkpointHash.parse(job.blockHash);
  const height = (await readHeader(blockHash)).number;
  if ((await canonicalHash(height)) !== blockHash) return undefined;
  const at = { height, blockHash };
  if (height <= finalHeight) {
    const bytes = await store.read(at);
    return bytes ? (await authenticate(at, bytes)).snapshot : undefined;
  }

  // Best-block observations are temporary. A moving tip invalidates the read
  // even if it moved after we completed the last replay step.
  if ((await readHostBestHash(rpc)) !== blockHash) return undefined;
  let current = await cursor();
  if (height - current.height > config.blocksPerAdvance) return undefined;
  while (current.height < height) current = await next(current);
  if (current.blockHash !== blockHash || (await readHostBestHash(rpc)) !== blockHash)
    return undefined;
  return current.snapshot;
}
