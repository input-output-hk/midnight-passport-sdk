import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmdirSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { randomUUID } from 'node:crypto';
import { dirname } from 'node:path';
import type { ServiceWire } from '@input-output-hk/mn-passport-protocol';
import type { FundingProgress, FundingStore } from './funding-route.js';

interface ProgressRecord {
  readonly balanceBefore: string;
  readonly preparationTxId?: string;
  readonly depositTxId?: string;
}

interface Entry {
  readonly request: ServiceWire.FundAccRequest;
  readonly day: string;
  readonly progress?: ProgressRecord;
  readonly result?: ServiceWire.FundAccResponse;
}
interface FileState {
  readonly version: 1;
  readonly requests: Record<string, Entry>;
}

const ADDRESS = /^[0-9a-f]{64}$/;
const DECIMAL = /^[1-9][0-9]*$/;
const NONNEGATIVE_DECIMAL = /^(?:0|[1-9][0-9]*)$/;
// The pinned wallet and node own the identifier format; the service treats IDs as opaque.
const validTxId = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= 256;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MAX_AMOUNT = (1n << 128n) - 1n;
const fields = [
  'requestId',
  'networkId',
  'bindingId',
  'manifestSha256',
  'accountAddress',
  'color',
  'amount',
] as const;

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function validEntry(id: string, value: unknown): value is Entry {
  if (!UUID.test(id) || !record(value) || !record(value.request) || !DAY.test(String(value.day)))
    return false;
  const request = value.request;
  if (
    request.requestId !== id ||
    !fields.every((field) => typeof request[field] === 'string') ||
    !ADDRESS.test(String(request.accountAddress)) ||
    !ADDRESS.test(String(request.manifestSha256)) ||
    !ADDRESS.test(String(request.color)) ||
    !DECIMAL.test(String(request.amount)) ||
    BigInt(String(request.amount)) > MAX_AMOUNT
  )
    return false;
  if (value.progress !== undefined) {
    if (
      !record(value.progress) ||
      typeof value.progress.balanceBefore !== 'string' ||
      !NONNEGATIVE_DECIMAL.test(value.progress.balanceBefore) ||
      BigInt(value.progress.balanceBefore) > MAX_AMOUNT ||
      (value.progress.preparationTxId !== undefined &&
        !validTxId(value.progress.preparationTxId)) ||
      (value.progress.depositTxId !== undefined && !validTxId(value.progress.depositTxId))
    )
      return false;
  }
  if (value.result === undefined) return true;
  return (
    record(value.result) &&
    value.result.requestId === id &&
    typeof value.result.txId === 'string' &&
    value.result.txId.length > 0 &&
    (value.progress?.depositTxId === undefined ||
      value.progress.depositTxId === value.result.txId) &&
    (value.progress?.preparationTxId === undefined ||
      value.progress.preparationTxId === value.result.preparationTxId) &&
    (value.result.preparationTxId === undefined ||
      (typeof value.result.preparationTxId === 'string' &&
        value.result.preparationTxId.length > 0)) &&
    typeof value.result.creditedBalance === 'string' &&
    DECIMAL.test(value.result.creditedBalance) &&
    BigInt(value.result.creditedBalance) <= MAX_AMOUNT
  );
}

function load(file: string): FileState {
  if (!existsSync(file)) return { version: 1, requests: {} };
  const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'));
  if (
    !record(parsed) ||
    parsed.version !== 1 ||
    !record(parsed.requests) ||
    !Object.entries(parsed.requests).every(([id, entry]) => validEntry(id, entry))
  )
    throw new Error('funding reservation file is invalid');
  return parsed as unknown as FileState;
}

export interface FundingInspection {
  readonly lockPresent: boolean;
  readonly entries: readonly {
    readonly request: ServiceWire.FundAccRequest;
    readonly day: string;
    readonly state: 'pending' | 'complete';
    readonly progress?: ProgressRecord;
    readonly result?: ServiceWire.FundAccResponse;
  }[];
}

/** Read-only, schema-validated view; never removes a lock or changes a reservation. */
export function inspectFileFundingStore(file: string): FundingInspection {
  if (!existsSync(file)) throw new Error('funding reservation file does not exist');
  const state = load(file);
  return {
    lockPresent: existsSync(`${file}.lock`),
    entries: Object.values(state.requests).map((entry) => ({
      request: entry.request,
      day: entry.day,
      state: entry.result ? 'complete' : 'pending',
      ...(entry.progress && { progress: entry.progress }),
      ...(entry.result && { result: entry.result }),
    })),
  };
}

function save(file: string, state: FileState): void {
  const temp = `${file}.${process.pid}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temp, JSON.stringify(state, null, 2), { mode: 0o600, flag: 'wx' });
    const descriptor = openSync(temp, 'r');
    try {
      fsyncSync(descriptor);
    } finally {
      closeSync(descriptor);
    }
    renameSync(temp, file);
    const directory = openSync(dirname(file), 'r');
    try {
      fsyncSync(directory);
    } finally {
      closeSync(directory);
    }
  } finally {
    if (existsSync(temp)) unlinkSync(temp);
  }
}

const sameRequest = (a: ServiceWire.FundAccRequest, b: ServiceWire.FundAccRequest): boolean =>
  fields.every((field) => a[field] === b[field]);

/**
 * Single-host reference store. An exclusive lock survives a crash: the operator must reconcile
 * wallet and chain state before removing it. Never run two replicas against separate files.
 */
export function createFileFundingStore(file: string): FundingStore {
  const lock = `${file}.lock`;
  const withLock = <T>(work: () => T): T => {
    mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
    mkdirSync(lock, { mode: 0o700 });
    try {
      return work();
    } finally {
      rmdirSync(lock);
    }
  };
  return {
    async reserve(request, policy, utcDay) {
      return withLock(() => {
        if (
          !DAY.test(utcDay) ||
          !UUID.test(request.requestId) ||
          request.color !== policy.color ||
          !DECIMAL.test(request.amount) ||
          BigInt(request.amount) > MAX_AMOUNT
        )
          throw new Error('invalid funding reservation');
        const state = load(file);
        const old = state.requests[request.requestId];
        if (old) {
          if (!sameRequest(old.request, request)) return { state: 'conflict' };
          return old.result ? { state: 'complete', result: old.result } : { state: 'pending' };
        }
        const amount = BigInt(request.amount);
        const spent = Object.values(state.requests)
          .filter((entry) => entry.day === utcDay && entry.request.color === request.color)
          .reduce((sum, entry) => sum + BigInt(entry.request.amount), 0n);
        if (spent + amount > policy.maxPerUtcDay) return { state: 'daily-limit' };
        state.requests[request.requestId] = { request, day: utcDay };
        save(file, state);
        return { state: 'reserved' };
      });
    },
    async complete(requestId, result) {
      withLock(() => {
        const state = load(file);
        const old = state.requests[requestId];
        if (!old || result.requestId !== requestId)
          throw new Error('funding reservation does not match the result');
        if (
          (old.progress?.depositTxId && old.progress.depositTxId !== result.txId) ||
          (old.progress?.preparationTxId &&
            old.progress.preparationTxId !== result.preparationTxId) ||
          (old.progress &&
            BigInt(result.creditedBalance) <
              BigInt(old.progress.balanceBefore) + BigInt(old.request.amount))
        )
          throw new Error('funding result differs from the recorded wallet progress');
        if (old.result) {
          if (
            old.result.requestId !== result.requestId ||
            old.result.txId !== result.txId ||
            old.result.creditedBalance !== result.creditedBalance
          )
            throw new Error('funding reservation has a different result');
          return;
        }
        state.requests[requestId] = { ...old, result };
        save(file, state);
      });
    },
    async recordProgress(requestId, progress: FundingProgress) {
      withLock(() => {
        const state = load(file);
        const old = state.requests[requestId];
        if (!old || old.result) throw new Error('funding reservation is not pending');
        const previous = old.progress;
        let next: ProgressRecord;
        if (progress.stage === 'balance-observed') {
          if (
            !NONNEGATIVE_DECIMAL.test(progress.balanceBefore) ||
            BigInt(progress.balanceBefore) > MAX_AMOUNT ||
            (previous && previous.balanceBefore !== progress.balanceBefore)
          )
            throw new Error('funding initial balance is invalid or changed');
          next = previous ?? { balanceBefore: progress.balanceBefore };
        } else if (progress.stage === 'prepared') {
          if (!previous || previous.depositTxId || !validTxId(progress.preparationTxId))
            throw new Error('funding preparation milestone is out of order');
          if (previous.preparationTxId && previous.preparationTxId !== progress.preparationTxId)
            throw new Error('funding preparation transaction changed');
          next = { ...previous, preparationTxId: progress.preparationTxId };
        } else {
          if (!previous || !validTxId(progress.txId))
            throw new Error('funding submission milestone is out of order');
          if (previous.depositTxId && previous.depositTxId !== progress.txId)
            throw new Error('funding deposit transaction changed');
          next = { ...previous, depositTxId: progress.txId };
        }
        state.requests[requestId] = { ...old, progress: next };
        save(file, state);
      });
    },
  };
}
