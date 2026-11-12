import { createHash } from 'node:crypto';
import type * as Ledger from '@midnightntwrk/ledger-v9';
import { z } from 'zod';
import {
  mutationDigest,
  type MutationByteStore,
  type ShieldedBackfillRecord,
} from '../../../packages/account/dist/index.js';
import {
  backfillCircuit,
  parseBackfillRecord,
} from '../../../packages/account/dist/shielded-backfill-journal.js';
import { finalizedTransactionIdentitySchema } from '../../../packages/account/dist/finalized-transaction-identity.js';
import {
  decodeMutationValue,
  encodeMutationValue,
} from '../../../packages/account/dist/mutation-codec.js';
import { NetworkIdSchema } from '../../../packages/account/dist/validation.js';
import type { HostConfirmationRuntime } from '@input-output-hk/mn-passport-service/finality';

const hex32 = z.string().regex(/^[0-9a-f]{64}$/);
const schema = z
  .strictObject({
    appendId: z.uuid(),
    intentSha256: hex32,
    networkId: NetworkIdSchema,
    account: hex32,
    circuit: backfillCircuit,
    callArgsSha256: hex32,
    entrySha256: hex32,
    encKey: hex32,
    minInboxIndex: z.number().int().min(0).max(4095),
    callCommitment: z.string().regex(/^(?:[0-9a-f]{2}){1,64}$/),
    identity: finalizedTransactionIdentitySchema,
  })
  .readonly();

export type HostShieldedAppendReceipt = z.input<typeof schema>;

export interface HostShieldedAppendReceipts {
  read(appendId: string): Promise<HostShieldedAppendReceipt | undefined>;
  /** True only for the first durable dispatch stage for this append ID. */
  stage(record: HostShieldedAppendReceipt): Promise<boolean>;
}

function slot(id: string) {
  return mutationDigest({
    kind: 'host-shielded-append',
    id: z.uuid().parse(id).toLowerCase(),
  }).slice(0, 32);
}

export function parseHostShieldedAppendReceipt(value: unknown) {
  return schema.safeParse(value);
}

/** Dedicated crash-durable CAS. Retain the receipt independently of the account's envelope. */
export function createHostShieldedAppendReceipts(
  store: MutationByteStore,
): HostShieldedAppendReceipts {
  return {
    async read(appendId) {
      const key = slot(appendId);
      const stored = await store.read(key);
      if (!stored) return undefined;
      if (stored.revision !== 0 || stored.bytes.length > 8192)
        throw new Error('Invalid retained shielded append receipt.');
      const record = schema.parse(JSON.parse(Buffer.from(stored.bytes).toString('utf8')));
      if (slot(record.appendId) !== key) throw new Error('Unexpected shielded append receipt.');
      return record;
    },
    async stage(record) {
      const retained = schema.parse(record);
      return store.compareAndSwap(slot(retained.appendId), undefined, {
        revision: 0,
        bytes: new Uint8Array(Buffer.from(JSON.stringify(retained))),
      });
    },
  };
}

export type AppendLedger = HostConfirmationRuntime<Ledger.FinalizedTransaction>['ledger'] &
  Pick<typeof Ledger, 'ContractCall'> & {
    readonly Transaction: Pick<typeof Ledger.Transaction, 'fromParts'> &
      HostConfirmationRuntime<Ledger.FinalizedTransaction>['ledger']['Transaction'];
  };

export function readPinnedAppendCall<P extends Ledger.Proofish, B extends Ledger.Bindingish>(
  tx: Ledger.Transaction<Ledger.SignatureEnabled, P, B>,
  ledger: AppendLedger,
  expected: Pick<HostShieldedAppendReceipt, 'account' | 'circuit' | 'networkId'> & {
    readonly callCommitment?: string;
  },
): Ledger.ContractCall<P> | undefined {
  const actions = [...(tx.intents?.values() ?? [])].flatMap((intent) => intent.actions);
  const [call] = actions;
  if (
    actions.length !== 1 ||
    !(call instanceof ledger.ContractCall) ||
    call.address !== expected.account
  )
    return undefined;
  const circuit =
    typeof call.entryPoint === 'string'
      ? call.entryPoint
      : new TextDecoder().decode(call.entryPoint);
  if (
    circuit !== expected.circuit ||
    !call.communicationCommitment ||
    (expected.callCommitment !== undefined &&
      call.communicationCommitment !== expected.callCommitment)
  )
    return undefined;
  try {
    // Ledger 9 validates the embedded network when merging standard transactions.
    tx.eraseProofs().merge(ledger.Transaction.fromParts(expected.networkId).eraseProofs());
    return call;
  } catch {
    return undefined;
  }
}

const typedArrayPrototype = Object.getPrototypeOf(Uint8Array.prototype);
const rawLength = Object.getOwnPropertyDescriptor(typedArrayPrototype, 'byteLength')?.get;
const rawBuffer = Object.getOwnPropertyDescriptor(typedArrayPrototype, 'buffer')?.get;

function copyFinalizedBytes(raw: Uint8Array): Uint8Array | undefined {
  const length = raw instanceof Uint8Array ? rawLength?.call(raw) : undefined;
  if (!length || length > 8 * 1024 * 1024 || rawBuffer?.call(raw) instanceof SharedArrayBuffer)
    return undefined;
  return new Uint8Array(raw);
}

/**
 * Build from the owned approved arguments, pin the resulting call before proof
 * and balancing, then stage and forward only the exact verified bytes.
 */
export async function forwardHostShieldedAppend(
  input: {
    readonly original: ShieldedBackfillRecord;
    readonly intentSha256: string;
    readonly args: readonly unknown[];
    readonly signal?: AbortSignal;
  },
  runtime: {
    readonly ledger: AppendLedger;
    readonly networkId: string;
    readonly receipts: HostShieldedAppendReceipts;
    readonly build: (
      account: string,
      circuit: ShieldedBackfillRecord['circuit'],
      args: readonly unknown[],
    ) => Promise<Ledger.UnprovenTransaction>;
    readonly finalize: (built: Ledger.UnprovenTransaction) => Promise<Uint8Array>;
    readonly forward: (bytes: Uint8Array) => Promise<string>;
  },
): Promise<string | undefined> {
  const original = parseBackfillRecord(input.original);
  const args = decodeMutationValue(encodeMutationValue(input.args));
  if (!Array.isArray(args)) return undefined;
  const { intentSha256, signal } = input;
  if (
    signal?.aborted ||
    original.networkId !== runtime.networkId ||
    mutationDigest(original) !== intentSha256 ||
    mutationDigest(args) !== original.callArgsSha256 ||
    (await runtime.receipts.read(original.appendId))
  )
    return undefined;
  const [entry] = args;
  if (
    !(entry instanceof Uint8Array) ||
    entry.length !== 192 ||
    Buffer.from(entry).toString('hex') !== original.entry
  )
    return undefined;
  const entrySha256 = createHash('sha256').update(entry).digest('hex');
  if (signal?.aborted || mutationDigest(args) !== original.callArgsSha256) return undefined;
  const built = await runtime.build(original.account, original.circuit, args);
  const originalCall = readPinnedAppendCall(built, runtime.ledger, original);
  if (!originalCall || signal?.aborted || mutationDigest(args) !== original.callArgsSha256)
    return undefined;
  const callCommitment = originalCall.communicationCommitment;
  const raw = await runtime.finalize(built);
  const bytes = copyFinalizedBytes(raw);
  if (!bytes || signal?.aborted) return undefined;
  const tx = runtime.ledger.Transaction.deserialize('signature', 'proof', 'binding', bytes);
  const record = {
    appendId: original.appendId,
    intentSha256,
    networkId: original.networkId,
    account: original.account,
    circuit: original.circuit,
    callArgsSha256: original.callArgsSha256,
    entrySha256,
    encKey: original.encKey,
    minInboxIndex: original.minInboxIndex,
    callCommitment,
    identity: {
      txHash: tx.transactionHash(),
      bytesSha256: createHash('sha256').update(bytes).digest('hex'),
      identifiers: [...tx.identifiers()],
    },
  };
  if (
    !readPinnedAppendCall(tx, runtime.ledger, record) ||
    signal?.aborted ||
    !(await runtime.receipts.stage(record)) ||
    signal?.aborted
  )
    return undefined;
  try {
    const submissionId = await runtime.forward(bytes);
    return record.identity.identifiers.includes(submissionId) ? submissionId : undefined;
  } catch {
    // Forwarding may have succeeded. The retained identity is the recovery source.
    return undefined;
  }
}
