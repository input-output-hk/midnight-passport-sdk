import { PassportNameError } from '@input-output-hk/mn-passport-account/names';

const HASH = /^[a-f0-9]{64}$/;
const NODE_HASH = /^0x[a-f0-9]{64}$/;
const HEIGHT = /^0x[0-9a-f]+$/;
const MAX_REPLY_BYTES = 16 * 1024;

export interface MidnamesNodePin {
  readonly nodeUrl: string;
  /** A previously confirmed block on the intended chain, not a genesis-only devnet pin. */
  readonly anchorHeight: number;
  readonly anchorHash: string;
}

export interface MidnamesIndexerBlock {
  readonly height: number;
  readonly hash: string;
}

function validNodeUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      (url.protocol === 'https:' ||
        (url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash
    );
  } catch {
    return false;
  }
}

async function nodeResult(
  request: typeof fetch,
  url: string,
  method: string,
  params: readonly unknown[],
): Promise<unknown> {
  const response = await request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    redirect: 'error',
    signal: AbortSignal.timeout(6_000),
  });
  if (!response.ok || !response.body) throw new PassportNameError('Unavailable');
  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let bytes = 0;
  let source = '';
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      bytes += next.value.byteLength;
      if (bytes > MAX_REPLY_BYTES) throw new PassportNameError('Unavailable');
      source += decoder.decode(next.value, { stream: true });
    }
    const value: unknown = JSON.parse(source + decoder.decode());
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw new PassportNameError('Unavailable');
    const reply = value as Record<string, unknown>;
    if (reply.jsonrpc !== '2.0' || reply.id !== 1 || reply.error || reply.result === undefined)
      throw new PassportNameError('Unavailable');
    return reply.result;
  } finally {
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

/** Pin the indexer's selected block to a separately configured finalized node. */
export function createMidnamesNodeFinality(pin: MidnamesNodePin, request: typeof fetch = fetch) {
  if (
    !validNodeUrl(pin.nodeUrl) ||
    !Number.isSafeInteger(pin.anchorHeight) ||
    pin.anchorHeight < 1 ||
    !HASH.test(pin.anchorHash)
  )
    throw new PassportNameError('InvalidQuery');
  const pinned = Object.freeze({ ...pin });
  return async (block: MidnamesIndexerBlock): Promise<void> => {
    if (
      !Number.isSafeInteger(block.height) ||
      block.height < pinned.anchorHeight ||
      !HASH.test(block.hash)
    )
      throw new PassportNameError('InvalidRecord');
    try {
      const anchor = await nodeResult(request, pinned.nodeUrl, 'chain_getBlockHash', [
        pinned.anchorHeight,
      ]);
      if (anchor !== `0x${pinned.anchorHash}`) throw new PassportNameError('Unavailable');
      const finalized = await nodeResult(request, pinned.nodeUrl, 'chain_getFinalizedHead', []);
      if (typeof finalized !== 'string' || !NODE_HASH.test(finalized))
        throw new PassportNameError('Unavailable');
      const header = await nodeResult(request, pinned.nodeUrl, 'chain_getHeader', [finalized]);
      if (!header || typeof header !== 'object' || Array.isArray(header))
        throw new PassportNameError('Unavailable');
      const height = (header as Record<string, unknown>).number;
      if (
        typeof height !== 'string' ||
        !HEIGHT.test(height) ||
        BigInt(height) < BigInt(block.height)
      )
        throw new PassportNameError('Unavailable');
      const canonical = await nodeResult(request, pinned.nodeUrl, 'chain_getBlockHash', [
        block.height,
      ]);
      if (canonical !== `0x${block.hash}`) throw new PassportNameError('Unavailable');
    } catch {
      throw new PassportNameError('Unavailable');
    }
  };
}
