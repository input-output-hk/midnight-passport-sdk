import { createHash, randomUUID } from 'node:crypto';

export type HostJson =
  null | boolean | number | string | readonly HostJson[] | { readonly [key: string]: HostJson };
export interface HostMutationPins {
  readonly networkId: string;
  readonly bindingId: string;
  readonly manifestSha256: string;
  readonly scheme: 'p256-webauthn' | 'jubjub-schnorr';
}
export interface HostMutationIdentity {
  readonly pins: HostMutationPins;
  readonly requestId: string;
  readonly intentSha256: string;
  readonly kind: 'call' | 'deploy';
}
export interface HostMutationPlan {
  readonly address: string;
  readonly steps: number;
  readonly context: HostJson;
}
export interface HostPreparedTransaction {
  readonly tx: string;
  readonly identifiers: readonly string[];
}
export interface HostConfirmation {
  readonly identifier: string;
  readonly txHash: string;
  readonly blockHeight?: number;
  readonly succeeded: true;
}
export interface HostMutationStep extends HostPreparedTransaction {
  readonly phase: 'ready' | 'dispatching' | 'submitted' | 'confirmed';
  readonly submissionId?: string;
  readonly confirmation?: HostConfirmation;
}
export interface HostMutationRecord {
  readonly version: 1;
  readonly revision: number;
  readonly identity: HostMutationIdentity;
  readonly input: HostJson;
  readonly owner: string;
  readonly phase: 'preparing' | 'active' | 'complete';
  readonly plan?: HostMutationPlan;
  readonly steps: readonly HostMutationStep[];
}
export interface HostMutationStore {
  read(identity: HostMutationIdentity): Promise<HostMutationRecord | undefined>;
  compareAndSwap(expected: number | undefined, record: HostMutationRecord): Promise<boolean>;
}
/** The driver owns chain-era decoding and finality. prepare/prepareStep MUST NOT broadcast.
 * Call prepare validates the original already-built input and may be retried under a new
 * revision fence; it must not generate replacement intent/authority or dispatch.
 * lookup must verify the exact identifier and SucceedEntirely; absence/timeout is unknown.
 * check verifies the exact original verifier roster, authority/counter and account generation.
 */
export interface HostMutationDriver {
  prepare(identity: HostMutationIdentity, input: HostJson): Promise<HostMutationPlan>;
  prepareStep(record: HostMutationRecord, index: number): Promise<HostPreparedTransaction>;
  submit(transaction: HostPreparedTransaction): Promise<string>;
  lookup(transaction: HostMutationStep): Promise<HostConfirmation | undefined>;
  check(record: HostMutationRecord, confirmedSteps: number): Promise<boolean>;
}
export type HostMutationOutcome =
  | { readonly kind: 'unknown' }
  | {
      readonly kind: 'confirmed';
      readonly digest: string;
      readonly result:
        | { readonly txHash: string; readonly submissionId: string; readonly blockHeight?: number }
        | { readonly address: string; readonly txIds: readonly string[] };
    };
const HEX = /^[0-9a-f]{64}$/;
// Native ledger-v9 watch IDs are tagged 33-byte values. Retain legacy 32-byte IDs
// in v1 records; included transaction hashes, addresses and intent digests stay 32 bytes.
const WATCH_ID = /^(?:[0-9a-f]{64}|[0-9a-f]{66})$/;
export const hostFailure = (): never => {
  throw new Error('Host mutation is unsettled; reconcile the original protected record.');
};
export function hostCanonical(value: unknown): string {
  const visit = (v: unknown, depth: number): HostJson => {
    if (depth > 24) return hostFailure();
    if (v === null || typeof v === 'boolean' || typeof v === 'string') return v;
    if (typeof v === 'number' && Number.isSafeInteger(v)) return v;
    if (Array.isArray(v)) return v.map((x) => visit(x, depth + 1));
    if (!v || typeof v !== 'object' || Object.getPrototypeOf(v) !== Object.prototype)
      return hostFailure();
    return Object.fromEntries(
      Object.entries(v)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, x]) => {
          if (['__proto__', 'constructor', 'prototype'].includes(k)) return hostFailure();
          return [k, visit(x, depth + 1)];
        }),
    );
  };
  const result = JSON.stringify(visit(value, 0));
  if (Buffer.byteLength(result) > 8 * 1024 * 1024) return hostFailure();
  return result;
}
export const hostHash = (value: unknown): string =>
  createHash('sha256').update(hostCanonical(value)).digest('hex');
export function validateHostIdentity(i: HostMutationIdentity): void {
  if (
    !i ||
    !/^[0-9a-f]{32}:(0|[1-9][0-9]{0,2})$/.test(i.requestId) ||
    Number(i.requestId.split(':')[1]) > 511 ||
    !HEX.test(i.intentSha256) ||
    !['call', 'deploy'].includes(i.kind) ||
    !i.pins ||
    !/^[a-z0-9][a-z0-9-]{0,63}$/.test(i.pins.networkId) ||
    i.pins.bindingId !== 'acc-s3r1.1' ||
    i.pins.manifestSha256 !== '77fb9c17b0d59047456c43115d9a58f5cb99a226ee73b6b974fd724930c3153f' ||
    !['p256-webauthn', 'jubjub-schnorr'].includes(i.pins.scheme)
  )
    return hostFailure();
}
export function validateHostRecord(r: HostMutationRecord): void {
  if (
    !r ||
    r.version !== 1 ||
    !Number.isSafeInteger(r.revision) ||
    r.revision < 0 ||
    typeof r.owner !== 'string' ||
    !/^[a-zA-Z0-9-]{1,80}$/.test(r.owner) ||
    !['preparing', 'active', 'complete'].includes(r.phase) ||
    !Array.isArray(r.steps) ||
    r.steps.length > 64
  )
    return hostFailure();
  validateHostIdentity(r.identity);
  hostCanonical(r);
  if (r.phase === 'preparing') {
    if (r.plan || r.steps.length) return hostFailure();
    return;
  }
  if (
    !r.plan ||
    !HEX.test(r.plan.address) ||
    !Number.isInteger(r.plan.steps) ||
    r.plan.steps < 1 ||
    r.plan.steps > 64 ||
    r.steps.length > r.plan.steps
  )
    return hostFailure();
  r.steps.forEach((s, index) => {
    if (
      !s ||
      !['ready', 'dispatching', 'submitted', 'confirmed'].includes(s.phase) ||
      typeof s.tx !== 'string' ||
      !/^(?:[0-9a-f]{2})+$/.test(s.tx) ||
      s.tx.length > 8 * 1024 * 1024 ||
      !Array.isArray(s.identifiers) ||
      s.identifiers.length < 1 ||
      s.identifiers.length > 64 ||
      s.identifiers.some((id: string) => !WATCH_ID.test(id)) ||
      new Set(s.identifiers).size !== s.identifiers.length ||
      (index < r.steps.length - 1 && s.phase !== 'confirmed') ||
      (s.submissionId !== undefined && !s.identifiers.includes(s.submissionId))
    )
      return hostFailure();
    if (s.phase === 'confirmed') {
      const c = s.confirmation;
      if (
        !c ||
        c.succeeded !== true ||
        !s.identifiers.includes(c.identifier) ||
        !HEX.test(c.txHash) ||
        (c.blockHeight !== undefined && (!Number.isSafeInteger(c.blockHeight) || c.blockHeight < 0))
      )
        return hostFailure();
    } else if (s.confirmation) return hostFailure();
  });
  if (
    r.phase === 'complete' &&
    (r.steps.length !== r.plan.steps || r.steps.some((s) => s.phase !== 'confirmed'))
  )
    return hostFailure();
}
/** Host-side execution with revision fencing before EVERY broadcast. A successor may take over
 * ready preparation, but a dispatching/sent transaction is ONLY looked up, never re-sent.
 * The protected byte sequence and constructor plan are retained across process death.
 */
export function createHostMutationExecutor(store: HostMutationStore, driver: HostMutationDriver) {
  const read = async (identity: HostMutationIdentity) => {
    validateHostIdentity(identity);
    const r = await store.read(identity);
    if (r) {
      validateHostRecord(r);
      if (hostHash(r.identity) !== hostHash(identity)) return hostFailure();
    }
    return r;
  };
  const outcome = (r: HostMutationRecord): HostMutationOutcome => {
    if (r.phase !== 'complete') return { kind: 'unknown' };
    const first = r.steps[0]!.confirmation!;
    return {
      kind: 'confirmed',
      digest: r.identity.intentSha256,
      result:
        r.identity.kind === 'deploy'
          ? {
              address: r.plan!.address,
              txIds: r.steps.map((s) => s.submissionId ?? s.confirmation!.identifier),
            }
          : {
              txHash: first.txHash,
              submissionId: r.steps[0]!.submissionId ?? first.identifier,
              ...(first.blockHeight !== undefined && { blockHeight: first.blockHeight }),
            },
    };
  };
  const drive = async (
    identity: HostMutationIdentity,
    input?: HostJson,
    signal?: { readonly aborted: boolean },
    expectedInputSha256?: string,
  ): Promise<HostMutationOutcome> => {
    identity = JSON.parse(hostCanonical(identity)) as HostMutationIdentity;
    if (input !== undefined) input = JSON.parse(hostCanonical(input)) as HostJson;
    let record = await read(identity);
    if (
      expectedInputSha256 !== undefined &&
      (!HEX.test(expectedInputSha256) || (record && hostHash(record.input) !== expectedInputSha256))
    )
      return hostFailure();
    const owner = randomUUID();
    const checkpoint = () => {
      if (signal?.aborted) return hostFailure();
    };
    const save = async (update: Partial<HostMutationRecord>) => {
      const previous = record;
      const next = { ...record!, ...update, revision: previous ? previous.revision + 1 : 0 };
      validateHostRecord(next);
      if (!(await store.compareAndSwap(previous?.revision, next))) return hostFailure();
      record = next;
    };
    checkpoint();
    if (!record) {
      if (input === undefined) return { kind: 'unknown' };
      await save({ version: 1, identity, input, owner, phase: 'preparing', steps: [] });
      const plan = await driver.prepare(identity, input);
      await save({ plan, phase: 'active' });
      checkpoint();
    } else {
      if (input !== undefined && hostHash(input) !== hostHash(record.input)) return hostFailure();
      if (record.phase === 'complete') return outcome(record);
      if (record.phase === 'preparing') {
        // Constructor output may have existed before acknowledgement; never regenerate it.
        if (record.identity.kind === 'deploy') return { kind: 'unknown' };
        // A call's original input is already durable. Fence any earlier preparer before
        // validating that same input again; a stale producer cannot commit or dispatch.
        await save({ owner });
        const plan = await driver.prepare(identity, record.input);
        await save({ plan, phase: 'active' });
        checkpoint();
      }
    }
    const advance = async (step: HostMutationStep) => {
      const steps = [...record!.steps];
      steps[steps.length - 1] = step;
      await save({ steps });
    };
    while (
      record!.steps.length < record!.plan!.steps ||
      record!.steps.at(-1)?.phase !== 'confirmed'
    ) {
      checkpoint();
      let step = record!.steps.at(-1);
      if (!step || step.phase === 'confirmed') {
        // Claim only before preparing. Unknown lookup polls need no full new revision.
        const index = record!.steps.length;
        if (!(await driver.check(record!, index))) return { kind: 'unknown' };
        if (record!.owner !== owner) await save({ owner });
        const prepared = await driver.prepareStep(record!, index);
        await save({ steps: [...record!.steps, { ...prepared, phase: 'ready' }] });
        checkpoint();
        step = record!.steps.at(-1)!;
      }
      if (step.phase === 'ready') {
        checkpoint();
        if (!(await driver.check(record!, record!.steps.length - 1))) return { kind: 'unknown' };
        checkpoint();
        await advance({ ...step, phase: 'dispatching' });
        step = record!.steps.at(-1)!;
        // The dispatch fence is the point of no return. A later cancellation stops
        // the next step, without stranding this committed dispatch before submit.
        // The persisted CAS is the fence. A stale earlier producer cannot enter submit.
        const submissionId = await driver.submit(step);
        if (!step.identifiers.includes(submissionId)) return hostFailure();
        await advance({ ...step, phase: 'submitted', submissionId });
        step = record!.steps.at(-1)!;
      }
      if (step.phase === 'dispatching' || step.phase === 'submitted') {
        const confirmation = await driver.lookup(step);
        if (!confirmation) return { kind: 'unknown' };
        await advance({ ...step, phase: 'confirmed', confirmation });
      }
    }
    if (!(await driver.check(record!, record!.plan!.steps))) return { kind: 'unknown' };
    await save({ phase: 'complete' });
    return outcome(record!);
  };
  return {
    execute: (
      identity: HostMutationIdentity,
      input: HostJson,
      options: { signal?: { readonly aborted: boolean } } = {},
    ) => drive(identity, input, options.signal),
    resume: (
      identity: HostMutationIdentity,
      options: { signal?: { readonly aborted: boolean }; expectedInputSha256?: string } = {},
    ) => drive(identity, undefined, options.signal, options.expectedInputSha256),
    async inspect(identity: HostMutationIdentity) {
      const r = await read(identity);
      return r
        ? {
            phase: r.phase,
            preparedSteps: r.steps.length,
            confirmedSteps: r.steps.filter((s) => s.phase === 'confirmed').length,
          }
        : undefined;
    },
    async outcome(identity: HostMutationIdentity) {
      const r = await read(identity);
      return r ? outcome(r) : ({ kind: 'unknown' } as const);
    },
  };
}
