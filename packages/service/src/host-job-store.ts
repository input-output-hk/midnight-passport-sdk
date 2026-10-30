import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { fileMutationByteStore } from './mutation-store.js';
import { hostCanonical } from './host-mutations.js';
import {
  hostJobFailure,
  validateHostJobId,
  validateHostJobRecord,
  validateHostJobUpdate,
  type HostJobRecord,
  type HostJobStore,
} from './host-jobs.js';

const copy = <T>(value: T): T => JSON.parse(hostCanonical(value)) as T;
const capacity = (n: number) => {
  if (!Number.isSafeInteger(n) || n < 1 || n > 4096) hostJobFailure();
  return n;
};
/** Process-local only. Terminal IDs count towards capacity; they are never silently reused. */
export function createMemoryHostJobStore(options: { maxJobs?: number } = {}): HostJobStore {
  const maxJobs = capacity(options.maxJobs ?? 128),
    records = new Map<string, HostJobRecord>();
  return {
    async read(id) {
      validateHostJobId(id);
      const r = records.get(id);
      return r && copy(r);
    },
    async compareAndSwap(expected, next) {
      next = copy(next);
      const previous = records.get(next.id);
      if (previous?.revision !== expected) return false;
      validateHostJobUpdate(previous, next);
      if (!previous && records.size >= maxJobs) hostJobFailure();
      records.set(next.id, next);
      return true;
    },
  };
}

interface AdmissionIndex {
  version: 1;
  revision: number;
  jobs: Record<string, string>;
}
const INDEX = '0'.repeat(32);
/** Separate private POSIX directory and dedicated 32-byte job key. Immutable encrypted
 * revisions retain protected inputs. Capacity reservations survive partial/lost accepts.
 * No disk compaction, unknown eviction, rollback/deletion detection or distributed wallet lock. */
export function encryptedHostJobStore(
  directory: string,
  key: Uint8Array,
  options: { maxJobs?: number } = {},
): HostJobStore & { close(): void } {
  if (key.length !== 32) hostJobFailure();
  const maxJobs = capacity(options.maxJobs ?? 128),
    secret = Buffer.from(key),
    bytes = fileMutationByteStore(directory);
  let closed = false;
  const check = () => {
    if (closed) hostJobFailure();
  };
  const aad = (id: string, revision: number) =>
    Buffer.from(hostCanonical({ domain: 'mn-passport:host-jobs:v1', id, revision }));
  const readRaw = async (id: string): Promise<{ revision: number; value: unknown } | undefined> => {
    check();
    const r = await bytes.read(id);
    if (!r) return undefined;
    let plain: Buffer | undefined;
    try {
      if (r.bytes.length < 29) hostJobFailure();
      const body = Buffer.from(r.bytes),
        decipher = createDecipheriv('aes-256-gcm', secret, body.subarray(0, 12));
      decipher.setAAD(aad(id, r.revision));
      decipher.setAuthTag(body.subarray(-16));
      plain = Buffer.concat([decipher.update(body.subarray(12, -16)), decipher.final()]);
      return { revision: r.revision, value: JSON.parse(plain.toString('utf8')) as unknown };
    } catch {
      return hostJobFailure();
    } finally {
      plain?.fill(0);
    }
  };
  const writeRaw = async (
    id: string,
    expected: number | undefined,
    value: { revision: number },
  ) => {
    check();
    const plain = Buffer.from(hostCanonical(value)),
      iv = randomBytes(12);
    try {
      const cipher = createCipheriv('aes-256-gcm', secret, iv);
      cipher.setAAD(aad(id, value.revision));
      const encrypted = Buffer.concat([
        iv,
        cipher.update(plain),
        cipher.final(),
        cipher.getAuthTag(),
      ]);
      return await bytes.compareAndSwap(id, expected, {
        revision: value.revision,
        bytes: encrypted,
      });
    } finally {
      plain.fill(0);
    }
  };
  const readIndex = async () => {
    const raw = await readRaw(INDEX);
    if (!raw) return undefined;
    const v = raw.value as AdmissionIndex;
    if (
      !v ||
      v.version !== 1 ||
      v.revision !== raw.revision ||
      !v.jobs ||
      typeof v.jobs !== 'object' ||
      Array.isArray(v.jobs) ||
      Object.keys(v).some((k) => !['version', 'revision', 'jobs'].includes(k)) ||
      Object.keys(v.jobs).length > maxJobs
    )
      hostJobFailure();
    for (const [id, hash] of Object.entries(v.jobs)) {
      validateHostJobId(id);
      if (typeof hash !== 'string' || !/^[0-9a-f]{64}$/.test(hash)) hostJobFailure();
    }
    return v;
  };
  const reserve = async (id: string, digest: string) => {
    for (let attempt = 0; attempt < 16; attempt++) {
      const index = await readIndex(),
        prior = index?.jobs[id];
      if (prior !== undefined) {
        if (prior !== digest) hostJobFailure();
        return;
      }
      if (Object.keys(index?.jobs ?? {}).length >= maxJobs) hostJobFailure();
      const next: AdmissionIndex = {
        version: 1,
        revision: index ? index.revision + 1 : 0,
        jobs: { ...index?.jobs, [id]: digest },
      };
      if (await writeRaw(INDEX, index?.revision, next)) return;
    }
    hostJobFailure();
  };
  const read = async (id: string) => {
    validateHostJobId(id);
    const raw = await readRaw(id);
    if (!raw) return undefined;
    const r = raw.value as HostJobRecord;
    validateHostJobRecord(r);
    if (
      r.id !== id ||
      r.revision !== raw.revision ||
      (await readIndex())?.jobs[id] !== r.descriptorSha256
    )
      hostJobFailure();
    return r;
  };
  return {
    close() {
      secret.fill(0);
      closed = true;
    },
    read,
    async compareAndSwap(expected, next) {
      next = copy(next);
      validateHostJobRecord(next);
      const previous = await read(next.id);
      if (previous?.revision !== expected) return false;
      validateHostJobUpdate(previous, next);
      await reserve(next.id, next.descriptorSha256);
      return writeRaw(next.id, expected, next);
    },
  };
}
