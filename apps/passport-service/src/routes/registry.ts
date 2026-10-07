import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { ServiceConfig } from '../config.ts';
import { json, readJson, type Route } from '../http.ts';

const PATH = /^\/accounts\/([a-z0-9-]{1,32})\/([0-9a-f]{2,512})$/;
const BIGINT_HEX = /^(0|[1-9a-f][0-9a-f]*)$/;

interface NormalisedRecord {
  credentialId: string;
  address: string;
  publicKey: { x: string; y: string };
  policy: { rp_id_hash: string; origin: string };
  salt: string;
  status: 'deployed' | 'active';
}

type Store = Record<string, unknown>;

// Type guard: validates structure, field types, and lengths; returns normalised copy
function isRecord(body: unknown, credentialId: string): body is NormalisedRecord {
  if (!body || typeof body !== 'object') return false;
  const r = body as Record<string, unknown>;
  const pk = r.publicKey as Record<string, unknown> | undefined;
  const policy = r.policy as Record<string, unknown> | undefined;

  // Strict validation: exact field types and lengths (lowercase hex only)
  if (r.credentialId !== credentialId) return false;
  if (typeof r.address !== 'string' || !/^[0-9a-f]{64}$/.test(r.address)) return false;
  if (typeof pk?.x !== 'string' || !BIGINT_HEX.test(pk.x) || pk.x.length > 64) return false;
  if (typeof pk.y !== 'string' || !BIGINT_HEX.test(pk.y) || pk.y.length > 64) return false;
  if (typeof policy?.rp_id_hash !== 'string' || !/^[0-9a-f]{64}$/.test(policy.rp_id_hash))
    return false;
  if (typeof policy.origin !== 'string' || !/^[0-9a-f]{42}$/.test(policy.origin)) return false;
  if (typeof r.salt !== 'string' || !/^[0-9a-f]{64}$/.test(r.salt)) return false;
  if (r.status !== 'deployed' && r.status !== 'active') return false;

  return true;
}

function normalise(rec: NormalisedRecord): NormalisedRecord {
  return {
    credentialId: rec.credentialId,
    address: rec.address,
    publicKey: { x: rec.publicKey.x, y: rec.publicKey.y },
    policy: { rp_id_hash: rec.policy.rp_id_hash, origin: rec.policy.origin },
    salt: rec.salt,
    status: rec.status,
  };
}

// Compares all fields except status, field by field
function same(a: NormalisedRecord, b: NormalisedRecord): boolean {
  return (
    a.credentialId === b.credentialId &&
    a.address === b.address &&
    a.publicKey.x === b.publicKey.x &&
    a.publicKey.y === b.publicKey.y &&
    a.policy.rp_id_hash === b.policy.rp_id_hash &&
    a.policy.origin === b.policy.origin &&
    a.salt === b.salt
  );
}

export function registryRoute(config: ServiceConfig): Route {
  // Single-process registry: fixed `.tmp` name, no fsync
  const load = (): Store => {
    if (!existsSync(config.registryFile)) return {};
    try {
      const content = readFileSync(config.registryFile, 'utf8');
      const parsed = JSON.parse(content);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('registry file is not a plain object');
      }
      return parsed as Store;
    } catch (e) {
      console.error('registry load error:', e instanceof Error ? e.message : String(e));
      throw new Error('registry file unreadable');
    }
  };

  const save = (store: Store) => {
    mkdirSync(dirname(config.registryFile), { recursive: true, mode: 0o700 });
    writeFileSync(`${config.registryFile}.tmp`, JSON.stringify(store, null, 2));
    renameSync(`${config.registryFile}.tmp`, config.registryFile);
  };

  return async (req, res, url) => {
    if (!url.pathname.startsWith('/accounts/')) return false;
    const m = PATH.exec(url.pathname);
    if (!m || m[2]!.length % 2 !== 0) {
      json(res, 400, { error: 'bad account path' });
      return true;
    }
    const networkId = m[1]!;
    const credentialIdHex = m[2]!;
    const key = `${networkId}/${credentialIdHex}`;

    if (req.method === 'GET') {
      try {
        const rec = load()[key];
        if (rec === undefined) json(res, 404, { error: 'not found' });
        else json(res, 200, rec);
      } catch (e) {
        json(res, 500, { error: 'registry file unreadable' });
      }
      return true;
    }

    if (req.method === 'PUT') {
      const body = await readJson(req, 64 * 1024);
      if (!isRecord(body, credentialIdHex)) {
        json(res, 400, { error: 'bad account record' });
        return true;
      }

      // Keep load–check–save synchronous: no await between them
      let store: Store;
      try {
        store = load();
      } catch (e) {
        json(res, 500, { error: 'registry file unreadable' });
        return true;
      }

      const rec = normalise(body);
      const existing = store[key];

      if (existing === undefined) {
        // First write: record doesn't exist yet
        store[key] = rec;
        save(store);
        res.writeHead(204);
        res.end();
        return true;
      }

      // Record exists: verify it's valid and apply write-once semantics
      if (!isRecord(existing, credentialIdHex)) {
        // Existing record is corrupt; this shouldn't happen, but fail safely
        json(res, 500, { error: 'registry file unreadable' });
        return true;
      }

      const ex = existing as NormalisedRecord;

      if (!same(rec, ex)) {
        // Different address, salt, publicKey or policy: write-once violation
        json(res, 409, { error: 'account already registered' });
        return true;
      }

      // Same credential and fields. Check status transition.
      if (rec.status === ex.status) {
        // Identical re-PUT: no change needed
        res.writeHead(204);
        res.end();
        return true;
      }

      if (ex.status === 'deployed' && rec.status === 'active') {
        // Only legal transition: deployed → active
        store[key] = rec;
        save(store);
        res.writeHead(204);
        res.end();
        return true;
      }

      // Any other transition (active → deployed, etc.): rejected
      json(res, 409, { error: 'account already registered' });
      return true;
    }

    res.setHeader('allow', 'GET, PUT');
    json(res, 405, { error: 'method not allowed' });
    return true;
  };
}
