import { createHash } from 'node:crypto';
import type * as Ledger from '@midnightntwrk/ledger-v9';
import { z } from 'zod';
import type { ShieldedBackfillFinalitySource } from '../../../packages/account/dist/index.js';
import { abortable } from './bounded-json.ts';
import { readHostReceipt, type HostConfirmationRuntime } from './host-confirmation.ts';
import { isHostFinalizedBlock } from './host-finalized-block.ts';
import {
  parseHostShieldedAppendReceipt,
  readPinnedAppendCall,
  type AppendLedger,
  type HostShieldedAppendReceipt,
  type HostShieldedAppendReceipts,
} from './shielded-append-receipts.ts';

const requestSchema = z.strictObject({
  appendId: z.uuid(),
  intentSha256: z.string().regex(/^[0-9a-f]{64}$/),
});

interface PinnedInbox {
  readonly spec_version: bigint;
  readonly booted: boolean;
  readonly enc_key: Uint8Array;
  readonly auth_nonce: bigint;
  readonly inbox_count: bigint;
  readonly inbox: { lookup(index: bigint): Uint8Array };
}

interface HostShieldedAppendRuntime<
  State,
> extends HostConfirmationRuntime<Ledger.FinalizedTransaction> {
  readonly ledger: AppendLedger;
  readonly receipts: HostShieldedAppendReceipts;
  readonly networkId: string;
  readonly nodeUrl: string;
  readonly readPinnedLedger: (state: State) => PinnedInbox;
  /**
   * Independently verify successful inclusion of the exact transaction,
   * then return the account state immediately before and after it. A
   * before/after block snapshot may include unrelated transactions.
   */
  readonly readAuthenticatedTransition: (
    original: {
      readonly identity: HostShieldedAppendReceipt['identity'];
      readonly blockHash: string;
      readonly blockHeight: number;
      readonly account: string;
    },
    signal: AbortSignal,
  ) => Promise<{ readonly before: State; readonly after: State } | undefined>;
}

function appendedIndex(
  record: HostShieldedAppendReceipt,
  before: PinnedInbox,
  after: PinnedInbox,
): number | undefined {
  const index = before.inbox_count;
  if (
    index < BigInt(record.minInboxIndex) ||
    index >= 4096n ||
    before.spec_version !== 3n ||
    after.spec_version !== 3n ||
    !before.booted ||
    !after.booted ||
    after.auth_nonce !== before.auth_nonce + 1n ||
    after.inbox_count !== index + 1n ||
    Buffer.from(before.enc_key).toString('hex') !== record.encKey ||
    Buffer.from(after.enc_key).toString('hex') !== record.encKey
  )
    return undefined;
  const entry = after.inbox.lookup(index);
  if (
    entry.length !== 192 ||
    createHash('sha256').update(entry).digest('hex') !== record.entrySha256
  )
    return undefined;
  return Number(index);
}

/** Read-only recovery of one staged append using exact receipt and canonical state evidence. */
export function createHostShieldedAppendFinality<State>(
  runtime: HostShieldedAppendRuntime<State>,
): ShieldedBackfillFinalitySource {
  const { networkId } = runtime;
  return {
    networkId,
    bindingId: 'acc-s3r1.1',
    async readOriginalAppend(input) {
      const request = requestSchema.safeParse(input);
      if (!request.success) return undefined;
      try {
        const retained = parseHostShieldedAppendReceipt(
          await runtime.receipts.read(request.data.appendId),
        );
        if (!retained.success) return undefined;
        const record = retained.data;
        if (
          record.appendId !== request.data.appendId ||
          record.intentSha256 !== request.data.intentSha256 ||
          record.networkId !== networkId
        )
          return undefined;
        const receipt = await readHostReceipt(
          { identifiers: record.identity.identifiers },
          runtime,
          record.identity,
        );
        const blockHash = receipt?.confirmation.blockHash;
        const blockHeight = receipt?.confirmation.blockHeight;
        if (
          !receipt ||
          !blockHash ||
          !blockHeight ||
          !readPinnedAppendCall(receipt.transaction, runtime.ledger, record) ||
          !(await isHostFinalizedBlock(runtime, blockHeight, blockHash))
        )
          return undefined;
        const signal = AbortSignal.timeout(4000);
        const transition = await abortable(
          runtime.readAuthenticatedTransition(
            {
              identity: record.identity,
              blockHash,
              blockHeight,
              account: record.account,
            },
            signal,
          ),
          signal,
        );
        if (!transition) return undefined;
        const inboxIndex = appendedIndex(
          record,
          runtime.readPinnedLedger(transition.before),
          runtime.readPinnedLedger(transition.after),
        );
        if (inboxIndex === undefined) return undefined;
        return {
          appendId: record.appendId,
          intentSha256: record.intentSha256,
          account: record.account,
          circuit: record.circuit,
          callArgsSha256: record.callArgsSha256,
          entrySha256: record.entrySha256,
          txHash: record.identity.txHash,
          inboxIndex,
        };
      } catch {
        return undefined;
      }
    },
  };
}
