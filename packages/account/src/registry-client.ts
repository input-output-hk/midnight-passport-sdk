import { fromHex, toHex } from './codec.js';
import type { AccountRecord, RegistrySeam } from './seams.js';

/** The part of an `AbortSignal` a caller hands to fetch; the real one satisfies it. */
export interface AbortSignalLike {
  readonly aborted: boolean;
}

/** Structural fetch: the package compiles without DOM or Node types. */
export type FetchLike = (
  url: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    signal?: AbortSignalLike;
  },
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

interface WireRecord {
  credentialId: string;
  address: string;
  publicKey: { x: string; y: string };
  policy: { rp_id_hash: string; origin: string };
  salt: string;
  status: AccountRecord['status'];
}

const toWire = (r: AccountRecord): WireRecord => ({
  credentialId: toHex(r.credentialId),
  address: r.address,
  publicKey: { x: r.publicKey.x.toString(16), y: r.publicKey.y.toString(16) },
  policy: { rp_id_hash: toHex(r.policy.rp_id_hash), origin: toHex(r.policy.origin) },
  salt: toHex(r.salt),
  status: r.status,
});

const fromWire = (w: WireRecord): AccountRecord => ({
  credentialId: fromHex(w.credentialId),
  address: w.address,
  publicKey: { x: BigInt(`0x${w.publicKey.x}`), y: BigInt(`0x${w.publicKey.y}`), identity: false },
  policy: { rp_id_hash: fromHex(w.policy.rp_id_hash), origin: fromHex(w.policy.origin) },
  salt: fromHex(w.salt),
  status: w.status,
});

export function createRegistryClient(baseUrl: string, fetchFn: FetchLike): RegistrySeam {
  const base = baseUrl.replace(/\/+$/, '');
  const url = (networkId: string, credentialId: Uint8Array) =>
    `${base}/accounts/${encodeURIComponent(networkId)}/${toHex(credentialId)}`;
  return {
    async put(networkId, record) {
      const res = await fetchFn(url(networkId, record.credentialId), {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(toWire(record)),
      });
      if (!res.ok) throw new Error(`registry PUT failed: ${res.status}`);
    },
    async get(networkId, credentialId) {
      const res = await fetchFn(url(networkId, credentialId));
      if (res.status === 404) return undefined;
      if (!res.ok) throw new Error(`registry GET failed: ${res.status}`);
      return fromWire((await res.json()) as WireRecord);
    },
  };
}
