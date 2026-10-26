import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
  openSync,
  closeSync,
  fsyncSync,
  unlinkSync,
} from 'node:fs';
import { randomUUID } from 'node:crypto';
import { dirname } from 'node:path';
import type { ServiceConfig } from './config.ts';

type Store = Record<string, string[]>;

/** The file of addresses this service has deployed, beside the registry file. */
export const deploymentsFile = (registryFile: string): string =>
  `${registryFile.replace(/\.json$/, '')}.deployments.json`;

export const directoryFile = (registryFile: string): string => `${registryFile}.v1`;

const isStore = (v: unknown): v is Store =>
  typeof v === 'object' &&
  v !== null &&
  !Array.isArray(v) &&
  Object.values(v).every((a) => Array.isArray(a) && a.every((x) => typeof x === 'string'));

/** Addresses deployed by this service, per network; persisted so a restart keeps the sponsor's scope. */
export class DeploymentLog {
  readonly #file: string;
  readonly #networkId: string;

  constructor(config: Pick<ServiceConfig, 'registryFile' | 'networkId'>) {
    this.#file = deploymentsFile(config.registryFile);
    this.#networkId = config.networkId;
  }

  #load(): Store {
    if (!existsSync(this.#file)) return {};
    const parsed: unknown = JSON.parse(readFileSync(this.#file, 'utf8'));
    if (!isStore(parsed)) throw new Error('deployments file is not a map of address lists');
    return parsed;
  }

  /** Lowercase hex addresses this service deployed on its network. */
  list(): Set<string> {
    return new Set((this.#load()[this.#networkId] ?? []).map((a) => a.toLowerCase()));
  }

  /** Single sponsor process: publish atomically and durably before reporting deploy completion. */
  add(address: string): void {
    const store = this.#load();
    const known = new Set(store[this.#networkId] ?? []);
    known.add(address.toLowerCase());
    store[this.#networkId] = [...known];
    mkdirSync(dirname(this.#file), { recursive: true, mode: 0o700 });
    const temporary = `${this.#file}.pending-${randomUUID()}`;
    try {
      const file = openSync(temporary, 'wx', 0o600);
      try {
        writeFileSync(file, JSON.stringify(store, null, 2));
        fsyncSync(file);
      } finally {
        closeSync(file);
      }
      renameSync(temporary, this.#file);
      const parent = openSync(dirname(this.#file), 'r');
      try {
        fsyncSync(parent);
      } finally {
        closeSync(parent);
      }
    } finally {
      if (existsSync(temporary)) unlinkSync(temporary);
    }
  }
}

/** Addresses registered for a network in a directory file. Read-only. */
export function registeredAddresses(registryFile: string, networkId: string): Set<string> {
  const out = new Set<string>();
  if (!existsSync(registryFile)) return out;
  const parsed: unknown = JSON.parse(readFileSync(registryFile, 'utf8'));
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('registry file is not a plain object');
  }
  for (const [key, record] of Object.entries(parsed)) {
    if (!key.startsWith(`${networkId}/`)) continue;
    const address = (record as { address?: unknown } | null)?.address;
    if (typeof address === 'string') out.add(address.toLowerCase());
  }
  return out;
}

/**
 * The accounts the sponsor will fund calls to (Ruling R15): registered on this network AND
 * deployed by this service. Read afresh on each call so a new deployment or registration counts
 * at once. An unreadable file throws, which refuses the request.
 */
export function sponsoredAddresses(
  config: Pick<ServiceConfig, 'registryFile' | 'networkId'>,
  log: DeploymentLog,
): Set<string> {
  const deployed = log.list();
  const registered = new Set([
    ...registeredAddresses(config.registryFile, config.networkId),
    ...registeredAddresses(directoryFile(config.registryFile), config.networkId),
  ]);
  return new Set([...registered].filter((a) => deployed.has(a)));
}
