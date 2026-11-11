import type * as Ledger from '@midnightntwrk/ledger-v9';
import { z } from 'zod';

const maxIndex = (1n << 64n) - 1n;
const indexSchema = z
  .union([z.number().int().nonnegative(), z.string().regex(/^(0|[1-9][0-9]{0,19})$/)])
  .transform(BigInt)
  .refine((value) => value <= maxIndex);
const eventSchema = z.object({
  raw: z
    .string()
    .max(32 * 1024)
    .regex(/^(?:0x)?(?:[0-9a-f]{2})+$/i),
});
const eventsSchema = z.strictObject({
  events: z.array(eventSchema).min(3).max(4096),
  start: indexSchema,
  end: indexSchema,
});

interface Claim {
  readonly value: string;
  readonly segment: number;
  readonly contract: string | undefined;
}

/** Bind indexed Zswap effects to a single original receipt and its concrete offer phases. */
export function readShieldedChangeIndex(
  source: { readonly Event: Pick<typeof Ledger.Event, 'deserialize'> },
  indexed: unknown,
  txHash: string,
  claims: { readonly input: Claim; readonly payout: Claim; readonly change: Claim },
): bigint | undefined {
  const parsed = eventsSchema.safeParse(indexed);
  if (!parsed.success || parsed.data.start >= parsed.data.end) return undefined;
  const { events, start, end } = parsed.data;
  const matches = (event: Ledger.Event, claim: Claim, contract: string | undefined) =>
    event.source.logicalSegment === claim.segment &&
    (claim.segment === 0 || event.source.physicalSegment === claim.segment) &&
    contract === claim.contract;
  let spent = false;
  const outputIndices = new Set<bigint>();
  const outputs = new Map<string, bigint>();
  for (const { raw } of events) {
    const event = source.Event.deserialize(Buffer.from(raw.replace(/^0x/i, ''), 'hex'));
    if (event.source.transactionHash !== txHash) return undefined;
    const detail = event.content;
    if (
      detail.tag === 'zswapInput' &&
      'nullifier' in detail &&
      (detail.nullifier === claims.input.value || detail.contract === claims.input.contract)
    ) {
      if (detail.nullifier !== claims.input.value) return undefined;
      if (spent || !matches(event, claims.input, detail.contract)) return undefined;
      spent = true;
    }
    if (detail.tag !== 'zswapOutput' || !('commitment' in detail)) continue;
    if (detail.mtIndex < start || detail.mtIndex >= end || outputIndices.has(detail.mtIndex))
      return undefined;
    outputIndices.add(detail.mtIndex);
    const claim = [claims.payout, claims.change].find(({ value }) => value === detail.commitment);
    if (!claim) {
      if (detail.contract === claims.change.contract) return undefined;
      continue;
    }
    if (outputs.has(claim.value) || !matches(event, claim, detail.contract)) return undefined;
    outputs.set(claim.value, detail.mtIndex);
  }
  return spent && outputs.has(claims.payout.value) ? outputs.get(claims.change.value) : undefined;
}
