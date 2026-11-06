import type { PassportEvent } from '@input-output-hk/mn-passport-protocol';

type Store = Pick<Storage, 'length' | 'key' | 'getItem' | 'setItem' | 'removeItem'>;
interface Receipt {
  txId: string;
  circuit?: string;
  flowId: string;
  at: number;
}
const id = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-zA-Z0-9:_-]{1,256}$/.test(value);
/** Public append-only receipt records. Local metadata is evidence, never proof of chain finality. */
export function transactionReceipts(storage: Store, networkId: string, bindingId: string) {
  const prefix = `passport-demo:transaction-receipt:v1:${networkId}:${bindingId}:`;
  const parse = (value: unknown): Receipt => {
    if (!value || typeof value !== 'object') throw Error('Invalid transaction receipt record.');
    const v = value as Record<string, unknown>;
    if (
      !id(v.txId) ||
      typeof v.flowId !== 'string' ||
      v.flowId.length > 256 ||
      typeof v.at !== 'number' ||
      !Number.isFinite(v.at) ||
      (v.circuit !== undefined &&
        (typeof v.circuit !== 'string' || !/^[a-z0-9_]{1,128}$/.test(v.circuit)))
    )
      throw Error('Invalid transaction receipt record.');
    return {
      txId: v.txId,
      flowId: v.flowId,
      at: v.at,
      ...(typeof v.circuit === 'string' && { circuit: v.circuit }),
    };
  };
  const load = () => {
    if (storage.length > 10_000) throw Error('Receipt storage is too large to inspect safely.');
    const entries: Receipt[] = [];
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (!key?.startsWith(prefix) || key === prefix + 'probe') continue;
      if (entries.length >= 2048) throw Error('Archive transaction receipts before continuing.');
      const raw = storage.getItem(key);
      if (!raw || raw.length > 2048) throw Error('Invalid transaction receipt record.');
      const receipt = parse(JSON.parse(raw));
      if (key !== prefix + receipt.txId) throw Error('Transaction receipt identity mismatch.');
      entries.push(receipt);
    }
    return entries;
  };
  return {
    load,
    assertWritable() {
      load();
      // Only our own probe is removed. Historical transaction references are never evicted.
      const probe = prefix + 'probe';
      storage.setItem(probe, ' '.repeat(2048));
      storage.removeItem(probe);
    },
    observe(event: PassportEvent) {
      if (event.step !== 'sponsor.submit' || event.phase !== 'end' || !event.detail?.txId) return;
      const receipt = parse({
        txId: event.detail.txId,
        circuit: event.detail.circuit,
        flowId: event.flowId,
        at: event.at,
      });
      const key = prefix + receipt.txId;
      if (!storage.getItem(key)) storage.setItem(key, JSON.stringify(receipt));
      return receipt;
    },
  };
}
