import { z } from 'zod';
import { createHash } from 'node:crypto';
import type { HostMutationStep, HostConfirmation } from './host-mutations.js';
import { fetchJsonBounded } from './bounded-json.js';

const RAW_HEX_LIMIT = 16 * 1024 * 1024;
const RESPONSE_LIMIT = RAW_HEX_LIMIT + 1024 * 1024;
const includedRecord = z
  .object({
    __typename: z.literal('RegularTransaction'),
    transactionResult: z.object({ status: z.literal('SUCCESS') }),
    // Refuse at the first invalid item without allocating an issue for every ID.
    identifiers: z.custom<readonly string[]>(
      (value: unknown) =>
        Array.isArray(value) && value.every((id: unknown) => typeof id === 'string'),
    ),
    hash: z.string().regex(/^[0-9a-f]{64}$/),
    raw: z
      .string()
      .max(RAW_HEX_LIMIT)
      .regex(/^(?:[0-9a-f]{2})+$/),
    block: z.object({
      height: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
      hash: z
        .string()
        .regex(/^[0-9a-f]{64}$/)
        .optional(),
    }),
  })
  .passthrough();
const confirmationResponse = z.object({
  errors: z.unknown().optional(),
  data: z.object({ transactions: z.tuple([includedRecord]) }),
});

interface ReceiptTransaction {
  identifiers(): readonly string[];
  transactionHash(): string;
}

export interface HostConfirmationRuntime<T extends ReceiptTransaction = ReceiptTransaction> {
  readonly ledger: {
    readonly Transaction: {
      deserialize(s: 'signature', p: 'proof', b: 'binding', raw: Uint8Array): T;
    };
  };
  readonly indexerUrl: string;
  readonly versionOfRecord: (record: unknown) => string;
  readonly fetch?: typeof fetch;
}
const QUERY =
  'query HostMutationReceipt($offset: TransactionOffset!) { transactions(offset:$offset) { __typename protocolVersion raw hash block { height hash } ... on RegularTransaction { identifiers transactionResult { status } } } }';
const QUERY_SHIELDED = QUERY.replace(
  'identifiers transactionResult',
  'identifiers zswapLedgerEvents { raw } zswapStartIndex zswapEndIndex transactionResult',
);

type ExactTransaction = { readonly txHash: string; readonly bytesSha256: string };
type HostIncludedConfirmation = HostConfirmation & { readonly blockHash?: string };

/** Unknown, malformed, oversized or interrupted observations never confirm or replay a mutation. */
export async function readHostConfirmation(
  step: Pick<HostMutationStep, 'identifiers'> & Partial<HostMutationStep>,
  runtime: HostConfirmationRuntime,
  exact?: ExactTransaction,
): Promise<HostIncludedConfirmation | undefined> {
  return (await readHostReceipt(step, runtime, exact))?.confirmation;
}

/** Keep the checked transaction and its replay events from the same bounded indexer response. */
export async function readHostReceipt<T extends ReceiptTransaction>(
  step: Pick<HostMutationStep, 'identifiers'> & Partial<HostMutationStep>,
  runtime: HostConfirmationRuntime<T>,
  exact?: ExactTransaction,
  queryShielded = false,
): Promise<
  | {
      readonly confirmation: HostIncludedConfirmation;
      readonly transaction: T;
      readonly shielded: {
        readonly events: unknown;
        readonly start: unknown;
        readonly end: unknown;
      };
    }
  | undefined
> {
  const identifier = step.submissionId ?? step.identifiers[0];
  if (!identifier) return undefined;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4000);
  try {
    const response = await fetchJsonBounded(
      runtime.fetch ?? fetch,
      runtime.indexerUrl,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        ...(exact && { redirect: 'error' as const }),
        body: JSON.stringify({
          query: queryShielded ? QUERY_SHIELDED : QUERY,
          variables: { offset: { identifier } },
        }),
        signal: controller.signal,
      },
      RESPONSE_LIMIT,
    );
    if (!response.ok) return undefined;
    const parsed = confirmationResponse.safeParse(response.value);
    if (!parsed.success || parsed.data.errors) return undefined;
    const record = parsed.data.data.transactions[0];
    if (
      !record ||
      runtime.versionOfRecord(record) !== 'v9' ||
      !record.identifiers.includes(identifier)
    )
      return undefined;
    const raw = Uint8Array.from(Buffer.from(record.raw, 'hex'));
    if (
      exact &&
      (!record.block.hash ||
        record.hash !== exact.txHash ||
        createHash('sha256').update(raw).digest('hex') !== exact.bytesSha256)
    )
      return undefined;
    const transaction = runtime.ledger.Transaction.deserialize(
      'signature',
      'proof',
      'binding',
      raw,
    );
    const includedIds = transaction.identifiers();
    if (
      !step.identifiers.every((id) => includedIds.includes(id)) ||
      (exact &&
        (includedIds.length !== step.identifiers.length ||
          !step.identifiers.every((id, index) => includedIds[index] === id))) ||
      transaction.transactionHash() !== record.hash
    )
      return undefined;
    return {
      confirmation: {
        identifier,
        txHash: record.hash,
        blockHeight: record.block.height,
        succeeded: true,
        ...(exact && record.block.hash && { blockHash: record.block.hash }),
      },
      transaction,
      shielded: {
        events: record.zswapLedgerEvents,
        start: record.zswapStartIndex,
        end: record.zswapEndIndex,
      },
    };
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}
