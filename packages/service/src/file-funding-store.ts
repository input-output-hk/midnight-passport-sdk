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
import type { FundingStore } from './funding-route.js';

interface Entry {
  readonly request: ServiceWire.FundAccRequest;
  readonly day: string;
  readonly result?: ServiceWire.FundAccResponse;
}
interface FileState {
  readonly version: 1;
  readonly requests: Record<string, Entry>;
}

const ADDRESS = /^[0-9a-f]{64}$/;
const DECIMAL = /^[1-9][0-9]*$/;
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
  if (value.result === undefined) return true;
  return (
    record(value.result) &&
    value.result.requestId === id &&
    typeof value.result.txId === 'string' &&
    value.result.txId.length > 0 &&
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
  };
}
