import { utf8ToBytes } from '@noble/hashes/utils.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { fromHex, toHex } from './codec.js';
import { PassportConnectorError } from './errors.js';
import { depositInput, validDepositTransactionId } from './shielded-deposit-validation.js';
import type { AccLedgerView } from './ports/index.js';
import type {
  ShieldedDepositPorts,
  ShieldedDepositRequest,
  ShieldedDepositResult,
} from './shielded-deposit.js';

export interface ShieldedDepositPins {
  readonly networkId: string;
  readonly bindingId: string;
  readonly manifestSha256: string;
}
/** Protected original intent. Never log it or include it in public audit receipts. */
export interface ShieldedDepositIntent {
  readonly requestId: string;
  readonly pins: ShieldedDepositPins;
  readonly account: string;
  readonly color: string;
  readonly nonce: string;
  readonly amount: string;
  readonly encKey: string;
  readonly entry: string;
  readonly initialInbox: { readonly count: number; readonly sha256: string };
}
export interface ShieldedDepositDocument {
  readonly version: 1;
  readonly revision: number;
  readonly intent: ShieldedDepositIntent;
  readonly intentSha256: string;
  readonly phase: 'prepared' | 'dispatching' | 'submitted' | 'confirmed';
  readonly txId?: string;
  readonly result?: ShieldedDepositResult;
}
/** Global request-ID namespace; atomic CAS and acknowledged durability across every writer.
 * Authenticate/encrypt records. Retain all IDs; never delete an unknown dispatch to retry it.
 */
export interface ShieldedDepositJournal {
  read(requestId: string): Promise<ShieldedDepositDocument | undefined>;
  compareAndSwap(
    requestId: string,
    expected: number | undefined,
    next: ShieldedDepositDocument,
  ): Promise<boolean>;
}
export interface ShieldedDepositRecovery {
  readonly pins: ShieldedDepositPins;
  readonly journal: ShieldedDepositJournal;
  /** Read-only original sender journal lookup. Missing is unknown, never proof of no send. */
  readonly reconcileSender: (
    intent: ShieldedDepositIntent,
    intentSha256: string,
  ) => Promise<
    | { readonly kind: 'unknown' }
    | { readonly kind: 'submitted'; readonly intentSha256: string; readonly txId: string }
  >;
  /** Read-only proof of successful canonical finality of THIS transaction and deposit intent.
   * Check network/binding/account, deposit circuit, coin and exact entry; a matching inbox alone
   * is insufficient. Stale/unavailable evidence returns false and never submits anything.
   */
  readonly confirmTransaction: (input: {
    readonly intent: ShieldedDepositIntent;
    readonly intentSha256: string;
    readonly txId: string;
    readonly inboxIndex: number;
  }) => Promise<boolean>;
}
export interface RecoverableShieldedDepositPorts extends ShieldedDepositPorts {
  readonly recovery: ShieldedDepositRecovery;
}
export const SHIELDED_DEPOSIT_DOCUMENT_LIMIT = 8_192;
const HEX = /^[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MAX_INBOX = 65_536;
function fail(message: string): never {
  throw new PassportConnectorError('MutationUnsettled', message, { retryable: false });
}
/** A journal failure cannot prove absence of an earlier send; keep host diagnostics private. */
async function reconcilePort<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch {
    return fail(
      'Original deposit recovery evidence is unavailable; reconcile this request ID without resending.',
    );
  }
}
// This codec owns validation of untrusted parsed JSON; unknown is narrowed before field access.
const fields = (v: unknown, keys: string[], required = keys): v is Record<string, unknown> =>
  !!v &&
  typeof v === 'object' &&
  !Array.isArray(v) &&
  Object.keys(v).every((k) => keys.includes(k)) &&
  required.every((k) => Object.hasOwn(v, k));
const copy = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const canonical = (v: unknown): string => {
  if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']';
  if (v !== null && typeof v === 'object')
    return (
      '{' +
      Object.entries(v)
        .filter(([, item]) => item !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, v]) => JSON.stringify(k) + ':' + canonical(v))
        .join(',') +
      '}'
    );
  return JSON.stringify(v) ?? 'null';
};
export const shieldedDepositIntentHash = (intent: ShieldedDepositIntent): string =>
  toHex(sha256(utf8ToBytes('mn-passport:shielded-deposit-intent:v1\0' + canonical(intent))));
function pinsValid(p: unknown): p is ShieldedDepositPins {
  return (
    fields(p, ['networkId', 'bindingId', 'manifestSha256']) &&
    typeof p.networkId === 'string' &&
    /^[a-zA-Z0-9_-]{1,80}$/.test(p.networkId) &&
    typeof p.bindingId === 'string' &&
    /^[a-zA-Z0-9._-]{1,80}$/.test(p.bindingId) &&
    typeof p.manifestSha256 === 'string' &&
    HEX.test(p.manifestSha256)
  );
}
export function shieldedDepositPinsHash(pins: ShieldedDepositPins): string {
  if (!pinsValid(pins)) fail('Invalid deposit network or binding pins.');
  return toHex(sha256(utf8ToBytes('mn-passport:shielded-deposit-context:v1\0' + canonical(pins))));
}
export function validateShieldedDepositDocument(
  value: unknown,
): asserts value is ShieldedDepositDocument {
  if (
    !fields(
      value,
      ['version', 'revision', 'intent', 'intentSha256', 'phase', 'txId', 'result'],
      ['version', 'revision', 'intent', 'intentSha256', 'phase'],
    ) ||
    value.version !== 1 ||
    !Number.isSafeInteger(value.revision) ||
    Number(value.revision) < 0 ||
    Number(value.revision) > 999999 ||
    !fields(value.intent, [
      'requestId',
      'pins',
      'account',
      'color',
      'nonce',
      'amount',
      'encKey',
      'entry',
      'initialInbox',
    ])
  )
    fail('Invalid protected shielded deposit record.');
  const i = value.intent;
  if (
    typeof i.requestId !== 'string' ||
    !UUID.test(i.requestId) ||
    !pinsValid(i.pins) ||
    !['account', 'color', 'nonce', 'encKey'].every(
      (k) => typeof i[k] === 'string' && HEX.test(String(i[k])),
    ) ||
    typeof i.amount !== 'string' ||
    !/^[1-9][0-9]{0,38}$/.test(i.amount) ||
    BigInt(i.amount) > (1n << 128n) - 1n ||
    typeof i.entry !== 'string' ||
    !/^[0-9a-f]{384}$/.test(i.entry) ||
    !fields(i.initialInbox, ['count', 'sha256']) ||
    !Number.isSafeInteger(i.initialInbox.count) ||
    Number(i.initialInbox.count) < 0 ||
    Number(i.initialInbox.count) > MAX_INBOX ||
    typeof i.initialInbox.sha256 !== 'string' ||
    !HEX.test(i.initialInbox.sha256) ||
    value.intentSha256 !== shieldedDepositIntentHash(i as unknown as ShieldedDepositIntent) ||
    !['prepared', 'dispatching', 'submitted', 'confirmed'].includes(String(value.phase))
  )
    fail('Invalid protected shielded deposit identity.');
  const submitted = value.phase === 'submitted' || value.phase === 'confirmed';
  if (submitted ? !validDepositTransactionId(value.txId) : value.txId !== undefined)
    fail('Invalid original deposit transaction.');
  if (value.phase === 'confirmed') {
    if (
      !fields(value.result, ['txId', 'inboxIndex', 'viewingKeyChanged']) ||
      value.result.txId !== value.txId ||
      !Number.isSafeInteger(value.result.inboxIndex) ||
      Number(value.result.inboxIndex) < Number(i.initialInbox.count) ||
      Number(value.result.inboxIndex) >= MAX_INBOX ||
      typeof value.result.viewingKeyChanged !== 'boolean'
    )
      fail('Invalid original deposit receipt.');
  } else if (value.result !== undefined) fail('Premature deposit receipt.');
}
export function shieldedDepositDocumentBytes(doc: ShieldedDepositDocument): Uint8Array {
  validateShieldedDepositDocument(doc);
  const bytes = utf8ToBytes(canonical(doc));
  if (bytes.length > SHIELDED_DEPOSIT_DOCUMENT_LIMIT) fail('Deposit record exceeds its bound.');
  return bytes;
}
export function readShieldedDepositDocument(bytes: Uint8Array): ShieldedDepositDocument {
  if (bytes.length > SHIELDED_DEPOSIT_DOCUMENT_LIMIT) fail('Deposit record exceeds its bound.');
  let doc: unknown;
  try {
    doc = JSON.parse(
      new (
        globalThis as unknown as {
          TextDecoder: new (
            encoding: string,
            options: { fatal: boolean },
          ) => { decode(bytes: Uint8Array): string };
        }
      ).TextDecoder('utf-8', { fatal: true }).decode(bytes),
    );
  } catch {
    return fail('Invalid protected deposit bytes.');
  }
  validateShieldedDepositDocument(doc);
  return doc;
}
function snapshot(view: AccLedgerView | undefined) {
  if (!view) throw new PassportConnectorError('AccountNotFound', 'The destination ACC is absent.');
  if (view.specVersion !== 3 || !view.booted || !view.encKey || !view.inboxEntries)
    throw new PassportConnectorError(
      'BindingUnsupported',
      'The ACC cannot accept a shielded deposit.',
    );
  if (view.encKey.length !== 32)
    throw new PassportConnectorError('EncryptionKeyMismatch', 'The ACC enc_key is malformed.');
  if (view.inboxEntries.length > MAX_INBOX || view.inboxEntries.some((e) => e.length !== 192))
    fail('Deposit inbox snapshot is unavailable or malformed.');
  return { encKey: toHex(view.encKey), entries: view.inboxEntries.map(toHex) };
}
function prefix(entries: readonly string[], count: number): string {
  const hash = sha256.create();
  hash.update(utf8ToBytes('mn-passport:deposit-inbox-prefix:v1\0'));
  for (const entry of entries.slice(0, count)) hash.update(fromHex(entry));
  return toHex(hash.digest());
}
function checkIdentity(
  doc: ShieldedDepositDocument,
  input: ShieldedDepositRequest,
  pins: ShieldedDepositPins,
) {
  validateShieldedDepositDocument(doc);
  const i = doc.intent;
  if (
    i.requestId !== input.requestId ||
    i.account !== input.account ||
    i.color !== toHex(input.color) ||
    i.nonce !== toHex(input.nonce) ||
    i.amount !== input.amount.toString() ||
    canonical(i.pins) !== canonical(pins)
  )
    fail('The request ID belongs to a different original deposit.');
}

/** Resume never creates missing state or automatically resends an uncertain dispatch. */
export async function resumeShieldedDeposit(
  input: ShieldedDepositRequest,
  ports: RecoverableShieldedDepositPorts,
): Promise<ShieldedDepositResult> {
  return runRecoverableShieldedDeposit(input, ports, true);
}
export async function runRecoverableShieldedDeposit(
  request: ShieldedDepositRequest,
  ports: ShieldedDepositPorts,
  resumeOnly = false,
): Promise<ShieldedDepositResult> {
  const { input, pollMs, confirmationMs } = depositInput(request, ports);
  const recovery = ports.recovery;
  if (
    !recovery ||
    !pinsValid(recovery.pins) ||
    typeof recovery.journal?.read !== 'function' ||
    typeof recovery.journal.compareAndSwap !== 'function' ||
    typeof recovery.reconcileSender !== 'function' ||
    typeof recovery.confirmTransaction !== 'function'
  )
    fail('Authenticated deposit recovery ports are required.');
  const pins = copy(recovery.pins),
    now = ports.now ?? Date.now;
  // Validate clock admission before even reading retained state; this is not the poll start.
  let initialTime: number;
  try {
    initialTime = now();
  } catch {
    fail('Invalid deposit reconciliation clock.');
  }
  if (!Number.isSafeInteger(initialTime) || initialTime < 0)
    fail('Invalid deposit reconciliation clock.');
  let doc = await reconcilePort(() => recovery.journal.read(input.requestId));
  if (!doc) {
    if (resumeOnly)
      fail('Original deposit evidence is missing; do not create a replacement request.');
    const first = snapshot(await ports.chain.readAccount(input.account, { includeInbox: true }));
    if (first.entries.length >= MAX_INBOX)
      fail('Deposit inbox exceeds the supported recovery bound.');
    const entry = await ports.sealCoin(fromHex(first.encKey), {
      nonce: input.nonce.slice(),
      color: input.color.slice(),
      value: input.amount,
    });
    if (entry.length !== 192) fail('The coin sealer returned a malformed entry.');
    const encoded = toHex(entry);
    if (first.entries.includes(encoded))
      fail('A new deposit cannot claim an existing inbox entry.');
    const intent: ShieldedDepositIntent = {
      requestId: input.requestId,
      pins,
      account: input.account,
      color: toHex(input.color),
      nonce: toHex(input.nonce),
      amount: input.amount.toString(),
      encKey: first.encKey,
      entry: encoded,
      initialInbox: {
        count: first.entries.length,
        sha256: prefix(first.entries, first.entries.length),
      },
    };
    const prepared: ShieldedDepositDocument = {
      version: 1,
      revision: 0,
      intent,
      intentSha256: shieldedDepositIntentHash(intent),
      phase: 'prepared',
    };
    validateShieldedDepositDocument(prepared);
    await reconcilePort(() =>
      recovery.journal.compareAndSwap(input.requestId, undefined, copy(prepared)),
    );
    doc = await reconcilePort(() => recovery.journal.read(input.requestId));
  }
  // Preserve a validated sender/lookup ID even when its durable transition acknowledgement fails.
  let knownTxId: string | undefined;
  let polling: { deadline: number; previousTime: number; remaining: number } | undefined;
  try {
    for (let contention = 0; contention < 16; contention++) {
      if (!doc) fail('Original deposit journal is unavailable.');
      checkIdentity(doc, input, pins);
      doc = copy(doc);
      if (doc.txId) {
        if (knownTxId && knownTxId !== doc.txId)
          fail('Retained deposit transaction differs from the original observed sender result.');
        knownTxId = doc.txId;
      }
      if (knownTxId && doc.phase === 'prepared')
        fail('An observed deposit transaction cannot return to prepared dispatch admission.');
      if (doc.phase === 'confirmed') return copy(doc.result!);
      if (doc.phase === 'prepared') {
        const current = snapshot(
          await ports.chain.readAccount(input.account, { includeInbox: true }),
        );
        if (current.encKey !== doc.intent.encKey)
          throw new PassportConnectorError(
            'EncryptionKeyMismatch',
            'The ACC enc_key changed before original deposit dispatch.',
          );
        if (
          current.entries.length < doc.intent.initialInbox.count ||
          prefix(current.entries, doc.intent.initialInbox.count) !==
            doc.intent.initialInbox.sha256 ||
          current.entries.includes(doc.intent.entry)
        )
          fail('Original pre-dispatch inbox evidence changed.');
        const dispatching = { ...doc, revision: doc.revision + 1, phase: 'dispatching' as const };
        const fenceAccepted = await reconcilePort(() =>
          recovery.journal.compareAndSwap(
            input.requestId,
            dispatching.revision - 1,
            copy(dispatching),
          ),
        );
        if (typeof fenceAccepted !== 'boolean')
          fail('Original dispatch fence acknowledgement is unavailable; do not send.');
        if (fenceAccepted === true) {
          let txId: string;
          try {
            const result = await ports.sender.depositShielded({
              requestId: input.requestId,
              account: input.account,
              coin: {
                nonce: fromHex(doc.intent.nonce),
                color: fromHex(doc.intent.color),
                value: BigInt(doc.intent.amount),
              },
              entry: fromHex(doc.intent.entry),
              intentSha256: doc.intentSha256,
            });
            if (!validDepositTransactionId(result.txId))
              throw new Error('Unusable original sender transaction ID');
            txId = result.txId;
            knownTxId = txId;
          } catch {
            return fail(
              'Original deposit dispatch is unknown; reconcile this request ID without resending.',
            );
          }
          await reconcilePort(() =>
            recovery.journal.compareAndSwap(input.requestId, dispatching.revision, {
              ...dispatching,
              revision: dispatching.revision + 1,
              phase: 'submitted',
              txId,
            }),
          );
        }
        doc = await reconcilePort(() => recovery.journal.read(input.requestId));
        continue;
      }
      if (doc.phase === 'dispatching') {
        const original = copy(doc.intent),
          digest = doc.intentSha256;
        // A transaction returned for this exact invocation is stronger than a lagging lookup.
        // Retry only its journal transition, never the wallet call or a different transaction.
        const outcome = knownTxId
          ? { kind: 'submitted', intentSha256: digest, txId: knownTxId }
          : await reconcilePort(() => recovery.reconcileSender(original, digest));
        if (
          !outcome ||
          typeof outcome !== 'object' ||
          Array.isArray(outcome) ||
          outcome.kind !== 'submitted' ||
          outcome.intentSha256 !== doc.intentSha256 ||
          !validDepositTransactionId(outcome.txId)
        )
          fail('Original deposit dispatch remains unknown; do not resend.');
        knownTxId ??= outcome.txId;
        const submitted = {
          ...doc,
          revision: doc.revision + 1,
          phase: 'submitted' as const,
          txId: outcome.txId,
        };
        await reconcilePort(() =>
          recovery.journal.compareAndSwap(input.requestId, submitted.revision - 1, submitted),
        );
        doc = await reconcilePort(() => recovery.journal.read(input.requestId));
        continue;
      }
      if (!polling) {
        let started: number;
        try {
          started = now();
        } catch {
          return fail('Invalid deposit reconciliation clock.');
        }
        if (!Number.isSafeInteger(started) || started < 0)
          fail('Invalid deposit reconciliation clock.');
        polling = {
          deadline: started + confirmationMs,
          previousTime: started,
          remaining: Math.ceil(confirmationMs / pollMs) + 1,
        };
      }
      for (;;) {
        let time: number;
        try {
          time = now();
        } catch {
          return fail('Invalid deposit reconciliation clock.');
        }
        if (!Number.isSafeInteger(time) || time < polling.previousTime)
          fail('Invalid deposit reconciliation clock.');
        polling.previousTime = time;
        if (time > polling.deadline || polling.remaining-- <= 0)
          fail(
            'Original deposit transaction or exact inbox entry is unconfirmed; reconcile this request ID.',
          );
        let current: ReturnType<typeof snapshot>;
        try {
          current = snapshot(await ports.chain.readAccount(input.account, { includeInbox: true }));
        } catch {
          return fail(
            'Original submitted deposit observation is unavailable; reconcile this request ID without resending.',
          );
        }
        if (
          current.entries.length < doc.intent.initialInbox.count ||
          prefix(current.entries, doc.intent.initialInbox.count) !== doc.intent.initialInbox.sha256
        )
          fail('Original deposit inbox history is unavailable or reordered.');
        const originalEntry = doc.intent.entry;
        const matches = current.entries.flatMap((e, index) => (e === originalEntry ? [index] : []));
        if (
          matches.length > 1 ||
          (matches.length === 1 && matches[0]! < doc.intent.initialInbox.count)
        )
          fail('Original deposit inbox evidence is ambiguous.');
        if (matches.length === 1) {
          const inboxIndex = matches[0]!;
          const evidence = {
            intent: copy(doc.intent),
            intentSha256: doc.intentSha256,
            txId: doc.txId!,
            inboxIndex,
          };
          if ((await reconcilePort(() => recovery.confirmTransaction(evidence))) === true) {
            const result: ShieldedDepositResult = {
              txId: doc.txId!,
              inboxIndex,
              viewingKeyChanged: current.encKey !== doc.intent.encKey,
            };
            const confirmed = {
              ...doc,
              revision: doc.revision + 1,
              phase: 'confirmed' as const,
              result,
            };
            await reconcilePort(() =>
              recovery.journal.compareAndSwap(input.requestId, confirmed.revision - 1, confirmed),
            );
            doc = await reconcilePort(() => recovery.journal.read(input.requestId));
            break;
          }
        }
        if (time >= polling.deadline || polling.remaining <= 0)
          fail(
            'Original deposit transaction or exact inbox entry is unconfirmed; reconcile this request ID.',
          );
        await reconcilePort(() => ports.sleep(pollMs));
      }
    }
    return fail('Deposit journal contention remains unsettled.');
  } catch (error) {
    if (knownTxId) {
      const message =
        error instanceof PassportConnectorError && error.code === 'MutationUnsettled'
          ? error.message
          : 'Original deposit reconciliation is unsettled.';
      fail(
        `${message} Retain original request ${input.requestId} and transaction ${knownTxId}; do not resend.`,
      );
    }
    throw error;
  }
}
