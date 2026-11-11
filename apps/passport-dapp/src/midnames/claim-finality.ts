import { ContractCall, Transaction } from '@midnightntwrk/ledger-v9';
import { claimDigest, claimHex, type ClaimReceipt } from './claim-receipt.js';

// This recovery profile is pinned to the isolated Ledger 9 standalone indexer.
const protocolVersion = 2001000;
const rawLimit = 2 * 1024 * 1024;
const query =
  'query MidnamesClaim($offset: TransactionOffset!) { transactions(offset:$offset) { __typename protocolVersion hash raw ... on RegularTransaction { identifiers transactionResult { status } } } }';

async function readBounded(response: Response): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) return undefined;
  const decoder = new TextDecoder();
  let size = 0;
  let json = '';
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) return JSON.parse(json + decoder.decode()) as unknown;
      size += next.value.length;
      if (size > rawLimit + 32_768) return undefined;
      json += decoder.decode(next.value, { stream: true });
    }
  } finally {
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export async function confirmedClaim(
  indexer: string,
  original: ClaimReceipt,
  request: typeof fetch = fetch,
): Promise<boolean> {
  try {
    const response = await request(indexer, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query,
        variables: { offset: { identifier: original.transaction.identifiers[0] } },
      }),
      redirect: 'error',
      signal: AbortSignal.timeout(6000),
    });
    if (!response.ok) return false;
    const body = (await readBounded(response)) as
      | {
          errors?: unknown;
          data?: { transactions?: unknown };
        }
      | undefined;
    const rows = body?.data?.transactions;
    if (body?.errors || !Array.isArray(rows) || rows.length !== 1) return false;
    const row = rows[0] as Record<string, unknown>;
    if (
      row?.__typename !== 'RegularTransaction' ||
      row.protocolVersion !== protocolVersion ||
      (row.transactionResult as { status?: unknown } | undefined)?.status !== 'SUCCESS' ||
      !claimHex(row.hash) ||
      typeof row.raw !== 'string' ||
      row.raw.length > rawLimit ||
      row.raw.length % 2 !== 0 ||
      !/^[0-9a-f]+$/.test(row.raw)
    )
      return false;
    const bytes = Uint8Array.from({ length: row.raw.length / 2 }, (_, index) =>
      Number.parseInt((row.raw as string).slice(index * 2, index * 2 + 2), 16),
    );
    if ((await claimDigest(bytes)) !== original.transaction.sha256) return false;
    const tx = Transaction.deserialize('signature', 'proof', 'binding', bytes);
    const ids = tx.identifiers();
    return (
      tx.transactionHash() === row.hash &&
      ids.length === original.transaction.identifiers.length &&
      original.transaction.identifiers.every((id) => ids.includes(id)) &&
      [...(tx.intents?.values() ?? [])].some((intent) =>
        intent.actions.some(
          (call) =>
            call instanceof ContractCall &&
            call.address === original.registryAddress &&
            (typeof call.entryPoint === 'string'
              ? call.entryPoint
              : new TextDecoder().decode(call.entryPoint)) === 'create_domain',
        ),
      )
    );
  } catch {
    return false;
  }
}
