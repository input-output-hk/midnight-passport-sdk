import { createHash } from 'node:crypto';
import type * as Ledger from '@midnightntwrk/ledger-v9';
import { z } from 'zod';
import { ledgerStateRootV18, maximumLedgerSnapshotBytes } from './ledger-state-root.ts';

const blockByteLimit = 4 * 1024 * 1024;
const parametersByteLimit = 64 * 1024;
const hash = z.string().regex(/^[0-9a-f]{64}$/);
const timestamp = z.number().int().min(0).max(8_640_000_000_000_000);
const bytesSchema = z.custom<Uint8Array>((value) => value instanceof Uint8Array);
const blockSchema = z.strictObject({
  blockHash: hash,
  parentHash: hash,
  height: z.number().int().positive(),
  timestamp,
  parentTimestamp: timestamp,
  transactions: z
    .array(
      z.strictObject({
        kind: z.enum(['system', 'regular']),
        bytes: bytesSchema,
      }),
    )
    .max(1024),
  ledgerParameters: bytesSchema.optional(),
});

export type CanonicalLedgerBlock = z.input<typeof blockSchema>;

export type ReplayLedger = Pick<
  typeof Ledger,
  | 'LedgerState'
  | 'LedgerParameters'
  | 'SystemTransaction'
  | 'Transaction'
  | 'TransactionContext'
  | 'WellFormedStrictness'
>;

export interface LedgerTransition {
  readonly before: Ledger.LedgerState;
  readonly after: Ledger.LedgerState;
  readonly result: Ledger.TransactionResult;
}

export interface ReplayTarget {
  readonly txHash: string;
  readonly bytesSha256: string;
}

const byteLength = Object.getOwnPropertyDescriptor(
  Object.getPrototypeOf(Uint8Array.prototype),
  'byteLength',
)?.get;

function copyBytes(bytes: Uint8Array, limit: number): Uint8Array<ArrayBuffer> {
  const length = byteLength?.call(bytes);
  if (length === undefined || length === 0 || length > limit)
    throw new Error('Ledger replay input exceeds its byte budget.');
  return new Uint8Array(bytes);
}

function readBlock(input: CanonicalLedgerBlock) {
  const block = blockSchema.parse(input);
  if (block.timestamp < block.parentTimestamp) throw new Error('Invalid ledger block timestamp.');
  let remaining = blockByteLimit;
  const transactions = block.transactions.map(({ kind, bytes }) => {
    const copy = copyBytes(bytes, remaining);
    remaining -= copy.length;
    return { kind, bytes: copy };
  });
  if (!block.ledgerParameters && transactions.length > 0)
    throw new Error('Ledger parameters are required for blocks with ledger transactions.');
  const ledgerParameters =
    block.ledgerParameters && copyBytes(block.ledgerParameters, parametersByteLimit);
  return { ...block, transactions, ledgerParameters };
}

function blockContext(block: CanonicalLedgerBlock): Ledger.BlockContext {
  return {
    secondsSinceEpoch: BigInt(Math.floor(block.timestamp / 1000)),
    secondsSinceEpochErr: 30,
    parentBlockHash: block.parentHash,
    lastBlockTime: BigInt(Math.floor(block.parentTimestamp / 1000)),
  };
}

/**
 * Replay the trusted node's ordered execution input for one pinned-runtime block.
 * Both roots come from the node. A root alone cannot authenticate transaction
 * order, so the ordered calls must come from the same canonical node, not an indexer.
 */
function replayLedgerBlock(
  ledger: ReplayLedger,
  input: CanonicalLedgerBlock,
  parentSnapshot: Uint8Array,
  roots: { readonly parent: string; readonly block: string },
  signal: AbortSignal,
  target?: ReplayTarget,
) {
  signal.throwIfAborted();
  const block = readBlock(input);
  const parent = copyBytes(parentSnapshot, maximumLedgerSnapshotBytes);
  if (ledgerStateRootV18(parent) !== roots.parent) return undefined;
  let state = ledger.LedgerState.deserialize(parent);
  const tblock = new Date(block.timestamp);
  const context = blockContext(block);
  const strictness = new ledger.WellFormedStrictness();
  // Node inclusion already validated balancing. Ledger application determines
  // the committed result, which can still be partial success or failure.
  strictness.enforceBalancing = false;
  const fullness: Ledger.SyntheticCost = {
    readTime: 0n,
    computeTime: 0n,
    blockUsage: 0n,
    bytesWritten: 0n,
    bytesChurned: 0n,
  };
  let match: LedgerTransition | undefined;
  for (const { kind, bytes } of block.transactions) {
    signal.throwIfAborted();
    if (kind === 'system') {
      [state] = state.applySystemTx(ledger.SystemTransaction.deserialize(bytes), tblock);
      continue;
    }
    const before = state;
    const tx = ledger.Transaction.deserialize('signature', 'proof', 'binding', bytes);
    const cost = tx.cost(before.parameters, true);
    const verified = tx.wellFormed(before, strictness, tblock);
    const [after, result] = before.apply(verified, new ledger.TransactionContext(before, context));
    state = after;
    if (result.type !== 'failure') {
      fullness.readTime += cost.readTime;
      fullness.computeTime += cost.computeTime;
      fullness.blockUsage += cost.blockUsage;
      fullness.bytesWritten += cost.bytesWritten;
      fullness.bytesChurned += cost.bytesChurned;
    }
    if (!target || tx.transactionHash() !== target.txHash) continue;
    if (match || createHash('sha256').update(bytes).digest('hex') !== target.bytesSha256)
      return undefined;
    match = { before, after, result };
  }
  if (target && (!match || match.result.type === 'failure')) return undefined;
  const normalized = state.parameters.normalizeFullness(fullness);
  state = state.postBlockUpdate(tblock, normalized, Math.max(...Object.values(normalized)));
  // WASM passes normalized fullness through f64. Zero fullness for an empty
  // block is exact; other blocks use the indexer's serialized parameters.
  if (block.ledgerParameters)
    state.parameters = ledger.LedgerParameters.deserialize(block.ledgerParameters);
  signal.throwIfAborted();
  const snapshot = state.serialize();
  if (ledgerStateRootV18(snapshot) !== roots.block || signal.aborted) return undefined;
  return { snapshot, match };
}

export function replayLedgerTransition(
  ledger: ReplayLedger,
  block: CanonicalLedgerBlock,
  parent: Uint8Array,
  roots: { readonly parent: string; readonly block: string },
  target: ReplayTarget,
  signal: AbortSignal,
): LedgerTransition | undefined {
  return replayLedgerBlock(ledger, block, parent, roots, signal, target)?.match;
}

export function replayLedgerSnapshot(
  ledger: ReplayLedger,
  block: CanonicalLedgerBlock,
  parent: Uint8Array,
  roots: { readonly parent: string; readonly block: string },
  signal: AbortSignal,
): Uint8Array | undefined {
  return replayLedgerBlock(ledger, block, parent, roots, signal)?.snapshot;
}
