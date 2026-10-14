import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { ServiceWire } from '@input-output-hk/mn-passport-protocol';
import type { DirectoryStore } from './directory-route.js';

type Records = Record<string, ServiceWire.AccountHintBody>;

/** A single-process reference store; operators can inject a transactional database instead. */
export function createFileDirectoryStore(file: string): DirectoryStore {
  const load = (): Records => {
    if (!existsSync(file)) return {};
    const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'));
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed))
      throw new Error('directory file is not a record');
    return parsed as Records;
  };
  const save = (records: Records): void => {
    mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
    const temp = `${file}.${process.pid}.tmp`;
    writeFileSync(temp, JSON.stringify(records, null, 2), { mode: 0o600 });
    renameSync(temp, file);
  };
  const path = (networkId: string, key: string): string => `${networkId}/${key}`;
  const same = (left: unknown, right: unknown): boolean =>
    JSON.stringify(left) === JSON.stringify(right);
  return {
    async read(networkId, key) {
      return load()[path(networkId, key)];
    },
    async compareAndSet(networkId, key, expected, next) {
      // No await between load, compare and rename: atomic among handlers in this process.
      const records = load();
      const slot = path(networkId, key);
      if (!same(records[slot], expected)) return false;
      records[slot] = next;
      save(records);
      return true;
    },
  };
}
