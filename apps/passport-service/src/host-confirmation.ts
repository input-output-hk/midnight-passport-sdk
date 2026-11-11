import { z } from 'zod';
import { createHash } from 'node:crypto';
import type { HostMutationStep, HostConfirmation } from '@input-output-hk/mn-passport-service';
import { fetchJsonBounded } from './bounded-json.ts';

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

export interface HostConfirmationRuntime {
  readonly ledger: {
    readonly Transaction: {
      deserialize(
        s: 'signature',
        p: 'proof',
        b: 'binding',
        raw: Uint8Array,
      ): {
        identifiers(): readonly string[];
        transactionHash(): string;
      };
    };
  };
  readonly indexerUrl: string;
  readonly versionOfRecord: (record: unknown) => string;
  readonly fetch?: typeof fetch;
}
const QUERY =
  'query HostMutationReceipt($offset: TransactionOffset!) { transactions(offset:$offset) { __typename protocolVersion raw hash block { height hash } ... on RegularTransaction { identifiers transactionResult { status } } } }';

/** Unknown, malformed, oversized or interrupted observations never confirm or replay a mutation. */
export async function readHostConfirmation(
  step: Pick<HostMutationStep, 'identifiers'> & Partial<HostMutationStep>,
  runtime: HostConfirmationRuntime,
  exact?: { readonly txHash: string; readonly bytesSha256: string },
): Promise<(HostConfirmation & { readonly blockHash?: string }) | undefined> {
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
        body: JSON.stringify({ query: QUERY, variables: { offset: { identifier } } }),
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
      identifier,
      txHash: record.hash,
      blockHeight: record.block.height,
      succeeded: true,
      ...(exact && record.block.hash && { blockHash: record.block.hash }),
    };
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}
