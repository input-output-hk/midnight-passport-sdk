import { Transaction } from '@midnightntwrk/ledger-v9';
import type { NightBridgeTransaction } from './night-bridge-output.js';
import type { NightSendLeg } from './night-send.js';

const HEX = /^[a-f0-9]{64}$/;
const IDENTIFIER = /^[a-f0-9]{66}$/;
const NODE_HASH = /^0x[a-f0-9]{64}$/;
const HEADER_HEIGHT = /^0x[0-9a-f]+$/;
const MAX_REPLY_BYTES = 4 * 1024 * 1024;
const QUERY =
  'query NightLeg($offset: TransactionOffset!) { transactions(offset:$offset) { __typename protocolVersion hash raw block { hash height } ... on RegularTransaction { identifiers transactionResult { status } } } }';

type Decode = (raw: Uint8Array) => NightBridgeTransaction;

async function boundedJson(
  request: typeof fetch,
  url: string,
  payload: unknown,
): Promise<Record<string, unknown> | undefined> {
  const response = await request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
    redirect: 'error',
    signal: AbortSignal.timeout(6_000),
  });
  if (!response.ok || !response.body) return undefined;
  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let bytes = 0;
  let source = '';
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) {
        const value: unknown = JSON.parse(source + decoder.decode());
        return value && typeof value === 'object' && !Array.isArray(value)
          ? (value as Record<string, unknown>)
          : undefined;
      }
      bytes += next.value.byteLength;
      if (bytes > MAX_REPLY_BYTES) return undefined;
      source += decoder.decode(next.value, { stream: true });
    }
  } finally {
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

function exactLeg(value: NightSendLeg): boolean {
  return (
    HEX.test(value.hash) &&
    Array.isArray(value.identifiers) &&
    value.identifiers.length > 0 &&
    value.identifiers.length <= 32 &&
    value.identifiers.every((id) => IDENTIFIER.test(id)) &&
    new Set(value.identifiers).size === value.identifiers.length
  );
}

function transactionRow(body: Record<string, unknown>, original: NightSendLeg) {
  if (body.errors !== undefined) return undefined;
  const data = body.data as Record<string, unknown> | undefined;
  const rows = data?.transactions;
  if (!Array.isArray(rows) || rows.length !== 1) return undefined;
  const row = rows[0] as Record<string, unknown> | undefined;
  const block = row?.block as Record<string, unknown> | undefined;
  const result = row?.transactionResult as Record<string, unknown> | undefined;
  if (
    row?.__typename !== 'RegularTransaction' ||
    row.protocolVersion !== 2001000 ||
    row.hash !== original.hash ||
    result?.status !== 'SUCCESS' ||
    !Array.isArray(row.identifiers) ||
    row.identifiers.length !== original.identifiers.length ||
    row.identifiers.some((id, index) => id !== original.identifiers[index]) ||
    typeof row.raw !== 'string' ||
    row.raw.length < 2 ||
    row.raw.length > MAX_REPLY_BYTES - 32_768 ||
    row.raw.length % 2 !== 0 ||
    !/^[a-f0-9]+$/.test(row.raw) ||
    typeof block?.hash !== 'string' ||
    !HEX.test(block.hash) ||
    typeof block.height !== 'number' ||
    !Number.isSafeInteger(block.height) ||
    block.height < 0
  )
    return undefined;
  return { raw: row.raw, blockHash: block.hash, blockHeight: block.height };
}

async function canonicalFinalizedBlock(
  request: typeof fetch,
  nodeUrl: string,
  blockHash: string,
  blockHeight: number,
): Promise<boolean> {
  const rpc = async (method: string, params: unknown[] = []) => {
    const body = await boundedJson(request, nodeUrl, {
      jsonrpc: '2.0',
      id: 1,
      method,
      params,
    });
    return body?.jsonrpc === '2.0' && body.id === 1 && body.error === undefined
      ? body.result
      : undefined;
  };
  const head = await rpc('chain_getFinalizedHead');
  if (typeof head !== 'string' || !NODE_HASH.test(head)) return false;
  const header = await rpc('chain_getHeader', [head]);
  const height =
    header && typeof header === 'object' && !Array.isArray(header)
      ? (header as Record<string, unknown>).number
      : undefined;
  if (typeof height !== 'string' || !HEADER_HEIGHT.test(height)) return false;
  if (BigInt(height) < BigInt(blockHeight)) return false;
  return (await rpc('chain_getBlockHash', [blockHeight])) === `0x${blockHash}`;
}

/** Trust the indexer for transaction inclusion; check its reported block against the node's finalized chain. */
export async function readFinalizedNightLeg(
  indexerUrl: string,
  nodeUrl: string,
  original: NightSendLeg,
  request: typeof fetch = fetch,
  decode: Decode = (raw) =>
    Transaction.deserialize('signature', 'proof', 'binding', raw) as NightBridgeTransaction,
): Promise<
  | {
      readonly transaction: NightBridgeTransaction;
      readonly blockHash: string;
      readonly blockHeight: number;
    }
  | undefined
> {
  if (!exactLeg(original)) return undefined;
  try {
    const body = await boundedJson(request, indexerUrl, {
      query: QUERY,
      variables: { offset: { identifier: original.identifiers[0] } },
    });
    if (!body) return undefined;
    const row = transactionRow(body, original);
    if (!row) return undefined;
    const raw = Uint8Array.from({ length: row.raw.length / 2 }, (_, index) =>
      Number.parseInt(row.raw.slice(index * 2, index * 2 + 2), 16),
    );
    const transaction = decode(raw);
    if (
      transaction.transactionHash() !== original.hash ||
      JSON.stringify(transaction.identifiers()) !== JSON.stringify(original.identifiers) ||
      !(await canonicalFinalizedBlock(request, nodeUrl, row.blockHash, row.blockHeight))
    )
      return undefined;
    return { transaction, blockHash: row.blockHash, blockHeight: row.blockHeight };
  } catch {
    return undefined;
  }
}
