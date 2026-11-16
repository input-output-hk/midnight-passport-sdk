import { Transaction } from '@midnightntwrk/ledger-v9';
import { claimDigest, claimHex, type ClaimReceipt } from './claim-receipt.js';
import { findStandaloneClaimCall } from './claim-call.js';

// This recovery profile is pinned to the isolated Ledger 9 standalone indexer.
const protocolVersion = 2001000;
const rawLimit = 2 * 1024 * 1024;
const query =
  'query MidnamesClaim($offset: TransactionOffset!) { transactions(offset:$offset) { __typename protocolVersion hash raw ... on RegularTransaction { identifiers transactionResult { status segments { id success } } } } }';
type BoundIntent =
  NonNullable<ReturnType<typeof Transaction.deserialize>['intents']> extends Map<number, infer I>
    ? I
    : never;

function isOnlyClaimIntent(intent: BoundIntent) {
  return (
    intent.actions.length === 1 &&
    !intent.dustActions &&
    !intent.guaranteedUnshieldedOffer &&
    !!intent.fallibleUnshieldedOffer
  );
}

function isOnlyFeeIntent(intent: BoundIntent) {
  return (
    intent.actions.length === 0 &&
    !intent.guaranteedUnshieldedOffer &&
    !intent.fallibleUnshieldedOffer &&
    intent.dustActions?.spends.length === 2 &&
    intent.dustActions.registrations.length === 0
  );
}

function sponsoredClaimSegmentIds(
  tx: ReturnType<typeof Transaction.deserialize>,
): readonly [claim: number, fee: number] | undefined {
  if (tx.rewards || tx.guaranteedOffer || tx.fallibleOffer?.size) return undefined;
  const intents = [...(tx.intents?.entries() ?? [])];
  if (intents.length !== 2) return undefined;
  // findStandaloneClaimCall already verified the transaction's one action.
  // Ledger WASM getters create new JS wrappers, so action object identity is unstable.
  const claim = intents.find(([, intent]) => intent.actions.length === 1);
  const fee = intents.find(([id]) => id !== claim?.[0]);
  if (
    !claim ||
    !fee ||
    !Number.isSafeInteger(claim[0]) ||
    !Number.isSafeInteger(fee[0]) ||
    claim[0] <= 0 ||
    fee[0] <= 0 ||
    !isOnlyClaimIntent(claim[1]) ||
    !isOnlyFeeIntent(fee[1])
  )
    return undefined;
  return [claim[0], fee[0]];
}

function onlyClaimFailed(segments: unknown, claimId: number, feeId: number): boolean {
  if (!Array.isArray(segments) || segments.length !== 3) return false;
  const outcome = new Map<number, boolean>();
  for (const value of segments) {
    const segment = value as Record<string, unknown> | null;
    if (
      !segment ||
      typeof segment !== 'object' ||
      !Number.isSafeInteger(segment.id) ||
      typeof segment.success !== 'boolean' ||
      outcome.has(segment.id as number)
    )
      return false;
    outcome.set(segment.id as number, segment.success);
  }
  return (
    outcome.size === 3 &&
    outcome.get(0) === true &&
    outcome.get(feeId) === true &&
    outcome.get(claimId) === false
  );
}

/** The pinned Ledger 9 sponsor pays DUST in a separate guaranteed intent.
 * Its fee may succeed while the sole fallible registration intent fails. */
export function failedSponsoredClaimSegment(
  tx: ReturnType<typeof Transaction.deserialize>,
  segments: unknown,
): boolean {
  const ids = sponsoredClaimSegmentIds(tx);
  return !!ids && onlyClaimFailed(segments, ids[0], ids[1]);
}

function sameIndexedIdentifiers(value: unknown, decoded: string[]): boolean {
  return Array.isArray(value) && JSON.stringify(value) === JSON.stringify(decoded);
}

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

/** Undefined means the indexer could not provide an authoritative answer. */
export async function readClaimFinality(
  indexer: string,
  original: ClaimReceipt,
  request: typeof fetch = fetch,
): Promise<boolean | 'conflict' | 'failed' | 'claim-failed' | undefined> {
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
    if (!response.ok) return undefined;
    const body = (await readBounded(response)) as
      | {
          errors?: unknown;
          data?: { transactions?: unknown };
        }
      | undefined;
    const rows = body?.data?.transactions;
    if (body?.errors || !Array.isArray(rows)) return undefined;
    if (rows.length === 0) return false;
    if (rows.length !== 1) return undefined;
    const row = rows[0] as Record<string, unknown>;
    if (row?.__typename !== 'RegularTransaction' || row.protocolVersion !== protocolVersion)
      return undefined;
    if (
      !claimHex(row.hash) ||
      typeof row.raw !== 'string' ||
      row.raw.length > rawLimit ||
      row.raw.length % 2 !== 0 ||
      !/^[0-9a-f]+$/.test(row.raw)
    )
      return undefined;
    const bytes = Uint8Array.from({ length: row.raw.length / 2 }, (_, index) =>
      Number.parseInt((row.raw as string).slice(index * 2, index * 2 + 2), 16),
    );
    if ((await claimDigest(bytes)) !== original.transaction.sha256) return 'conflict';
    let tx: ReturnType<typeof Transaction.deserialize>;
    try {
      tx = Transaction.deserialize('signature', 'proof', 'binding', bytes);
    } catch {
      return 'conflict';
    }
    const ids = tx.identifiers();
    if (
      tx.transactionHash() !== row.hash ||
      !sameIndexedIdentifiers(row.identifiers, ids) ||
      ids.length !== original.transaction.identifiers.length ||
      !original.transaction.identifiers.every((id) => ids.includes(id))
    )
      return 'conflict';
    const call = findStandaloneClaimCall(tx, original);
    if (!call) return 'conflict';
    const result = row.transactionResult as { status?: unknown; segments?: unknown } | undefined;
    const status = result?.status;
    if (status === 'FAILURE') return 'failed';
    if (status === 'PARTIAL_SUCCESS')
      return failedSponsoredClaimSegment(tx, result?.segments) ? 'claim-failed' : 'conflict';
    return status === 'SUCCESS' ? true : undefined;
  } catch {
    return undefined;
  }
}

export async function confirmedClaim(
  indexer: string,
  original: ClaimReceipt,
  request: typeof fetch = fetch,
): Promise<boolean> {
  return (await readClaimFinality(indexer, original, request)) === true;
}
