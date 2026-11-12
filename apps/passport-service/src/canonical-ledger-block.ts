import { createHash } from 'node:crypto';
import { Bytes, Metadata, Struct, TypeRegistry, type Vec } from '@polkadot/types';
import type { EventRecord, Header } from '@polkadot/types/interfaces';
import { z } from 'zod';
import { fetchJsonBounded } from '@input-output-hk/mn-passport-service/finality';
import type { CanonicalLedgerBlock } from './ledger-block-replay.ts';

const hash = z.string().regex(/^[0-9a-f]{64}$/);
const rpcHash = z.string().regex(/^0x[0-9a-f]{64}$/);
const eventsKey = '0x26aa394eea5630e07c48ae0c9558cef780d41e5e16056765bc8461851072c9d7';
const timestampKey = '0xf0c365c3cf59d671eb72da0e7a4113c49f1f0515f462cdcf84e0f1d6045dfcbb';
const metadataLimit = 4 * 1024 * 1024;
const blockResponseLimit = 10 * 1024 * 1024;
const parametersLimit = 64 * 1024;
const blockReply = z.object({
  block: z.object({
    header: z.object({
      parentHash: rpcHash,
      number: z.string().regex(/^0x[0-9a-f]{1,16}$/),
      stateRoot: rpcHash,
      extrinsicsRoot: rpcHash,
      digest: z.object({ logs: z.array(z.string()).max(256) }),
    }),
    extrinsics: z.array(z.string()).max(4096),
  }),
});
const rpcReply = z.object({ id: z.literal(1), error: z.undefined(), result: z.unknown() });
const indexedReply = z.object({
  errors: z.undefined(),
  data: z.object({
    block: z.object({
      hash,
      ledgerParameters: z
        .string()
        .min(2)
        .max(2 * parametersLimit)
        .regex(/^[0-9a-f]+$/),
    }),
  }),
});

interface CanonicalLedgerRuntime {
  readonly nodeUrl: string;
  readonly indexerUrl: string;
  /** Independently recorded metadata hash for the pinned node runtime. */
  readonly metadataSha256: string;
  readonly fetch?: typeof fetch;
}

function hexBytes(value: unknown): Uint8Array<ArrayBuffer> {
  if (typeof value !== 'string' || !/^0x[0-9a-f]+$/.test(value) || value.length % 2 !== 0)
    throw new Error('Invalid node SCALE response.');
  return Buffer.from(value.slice(2), 'hex');
}

type LedgerCall = CanonicalLedgerBlock['transactions'][number];
type SystemEvent = {
  readonly position: 'initialization' | 'finalization' | number;
  readonly bytes: Uint8Array;
};

/** Preserve the node's dispatch phases and refuse ambiguous effects within an explicit call. */
export function orderedLedgerCalls(
  extrinsics: readonly (LedgerCall | undefined)[],
  systemEvents: readonly SystemEvent[],
): LedgerCall[] {
  const systemByPhase = new Map<SystemEvent['position'], LedgerCall[]>();
  let previous = -1;
  for (const { position, bytes } of systemEvents) {
    const ordinal =
      position === 'initialization'
        ? -1
        : position === 'finalization'
          ? extrinsics.length
          : position;
    if (
      ordinal < previous ||
      (typeof position === 'number' &&
        (!Number.isInteger(position) ||
          position < 0 ||
          position >= extrinsics.length ||
          extrinsics[position]))
    )
      throw new Error('Ambiguous canonical system transaction phase.');
    previous = ordinal;
    const calls = systemByPhase.get(position) ?? [];
    calls.push({ kind: 'system', bytes });
    systemByPhase.set(position, calls);
  }
  return [
    ...(systemByPhase.get('initialization') ?? []),
    ...extrinsics.flatMap((call, position) =>
      call ? [call] : (systemByPhase.get(position) ?? []),
    ),
    ...(systemByPhase.get('finalization') ?? []),
  ];
}

export function readCanonicalSystemBytes(encoded: unknown): Uint8Array {
  // Runtime 2001000 emits one struct containing the hash and a SCALE byte
  // vector. The nested byte vector, without its length prefix, is the tx.
  const serialized = encoded instanceof Struct && encoded.get('serializedSystemTransaction');
  if (!(serialized instanceof Bytes)) throw new Error('Invalid system transaction event payload.');
  return serialized.toU8a(true);
}

function decodeCalls(registry: TypeRegistry, extrinsics: readonly string[], events: unknown) {
  const explicit = extrinsics.map((raw): LedgerCall | undefined => {
    const extrinsic = registry.createType('Extrinsic', hexBytes(raw));
    if (extrinsic.toHex() !== raw) throw new Error('Invalid canonical extrinsic encoding.');
    const { section, method, args } = extrinsic.method;
    const regular = section === 'midnight' && method === 'sendMnTransaction';
    const system = section === 'midnightSystem' && method === 'sendMnSystemTransaction';
    if (!regular && !system) return undefined;
    const argument = args[0];
    if (extrinsic.isSigned || args.length !== 1 || !argument)
      throw new Error('Unsupported Midnight ledger call encoding.');
    return { kind: regular ? 'regular' : 'system', bytes: argument.toU8a(true) };
  });
  const records = registry.createType<Vec<EventRecord>>('Vec<EventRecord>', hexBytes(events));
  if (records.toHex() !== events) throw new Error('Invalid canonical event encoding.');
  const implicit = records.flatMap(({ phase, event }): SystemEvent[] => {
    if (event.section !== 'midnightSystem' || event.method !== 'SystemTransactionApplied')
      return [];
    const encoded = event.data[0];
    if (event.data.length !== 1) throw new Error('Invalid system event payload.');
    const position = phase.isApplyExtrinsic
      ? phase.asApplyExtrinsic.toNumber()
      : phase.isInitialization
        ? 'initialization'
        : 'finalization';
    return [{ position, bytes: readCanonicalSystemBytes(encoded) }];
  });
  return orderedLedgerCalls(explicit, implicit);
}

function decodeTimestamp(registry: TypeRegistry, raw: unknown): number {
  const bytes = hexBytes(raw);
  if (bytes.length !== 8) throw new Error('Invalid node timestamp storage.');
  return registry.createType('u64', bytes).toNumber();
}

function genesisTimestamp(registry: TypeRegistry): number {
  const storage = registry.metadata.pallets
    .find(({ name }) => name.toString() === 'Timestamp')
    ?.storage.unwrapOrDefault();
  const fallback = storage?.items.find(({ name }) => name.toString() === 'Now')?.fallback;
  return decodeTimestamp(registry, fallback?.toHex());
}

export function createCanonicalLedgerBlockReader(runtime: CanonicalLedgerRuntime) {
  const metadataSha256 = hash.parse(runtime.metadataSha256);
  const fetcher = runtime.fetch ?? fetch;
  let decoded: TypeRegistry | undefined;
  function post(url: string, body: unknown, limit: number, signal: AbortSignal) {
    return fetchJsonBounded(
      fetcher,
      url,
      {
        method: 'POST',
        redirect: 'error',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal,
      },
      limit,
    );
  }
  async function rpc(
    method: string,
    params: readonly string[],
    signal: AbortSignal,
    limit = 64 * 1024,
  ) {
    const response = await post(
      runtime.nodeUrl,
      { jsonrpc: '2.0', id: 1, method, params },
      limit,
      signal,
    );
    if (!response.ok) throw new Error('Canonical node RPC unavailable.');
    return rpcReply.parse(response.value).result;
  }
  async function readRegistry(parent: string, signal: AbortSignal) {
    const raw = hexBytes(await rpc('state_getMetadata', [parent], signal, metadataLimit));
    if (createHash('sha256').update(raw).digest('hex') !== metadataSha256)
      throw new Error('Canonical node metadata pin mismatch.');
    if (decoded) return decoded;
    const registry = new TypeRegistry();
    registry.setMetadata(new Metadata(registry, raw));
    decoded = registry;
    return registry;
  }
  async function readParameters(blockHash: string, signal: AbortSignal) {
    const response = await post(
      runtime.indexerUrl,
      {
        query: 'query($hash:HexEncoded!){block(offset:{hash:$hash}){hash ledgerParameters}}',
        variables: { hash: blockHash },
      },
      3 * parametersLimit,
      signal,
    );
    if (!response.ok) throw new Error('Canonical block parameters unavailable.');
    const { hash: indexedHash, ledgerParameters } = indexedReply.parse(response.value).data.block;
    if (indexedHash !== blockHash)
      throw new Error('Indexer returned parameters for another block.');
    return hexBytes('0x' + ledgerParameters);
  }
  return async (
    request: string,
    signal: AbortSignal,
  ): Promise<CanonicalLedgerBlock | undefined> => {
    try {
      signal.throwIfAborted();
      const blockHash = hash.parse(request);
      const hashArg = '0x' + blockHash;
      const { block } = blockReply.parse(
        await rpc('chain_getBlock', [hashArg], signal, blockResponseLimit),
      );
      const { parentHash } = block.header;
      const [registry, rawEvents, now, previous, ledgerParameters] = await Promise.all([
        readRegistry(parentHash, signal),
        rpc('state_getStorage', [eventsKey, hashArg], signal, blockResponseLimit),
        rpc('state_getStorage', [timestampKey, hashArg], signal),
        rpc('state_getStorage', [timestampKey, parentHash], signal),
        readParameters(blockHash, signal),
      ]);
      signal.throwIfAborted();
      const header = registry.createType<Header>('Header', block.header);
      if (header.hash.toHex() !== hashArg) return undefined;
      const height = header.number.toNumber();
      return {
        blockHash,
        parentHash: parentHash.slice(2),
        height,
        timestamp: decodeTimestamp(registry, now),
        parentTimestamp:
          previous === null && height === 1
            ? genesisTimestamp(registry)
            : decodeTimestamp(registry, previous),
        transactions: decodeCalls(registry, block.extrinsics, rawEvents),
        ledgerParameters,
      };
    } catch {
      return undefined;
    }
  };
}
