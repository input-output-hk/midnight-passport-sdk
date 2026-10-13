import { fromHex, toHex } from './hex.js';
import type {
  FetchLike,
  LegacyAccountRecord as AccountRecord,
  RegistrySeam,
} from '@midnight-ntwrk/mn-passport-account/ports';

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
