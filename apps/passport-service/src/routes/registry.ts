import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import type { ServiceConfig } from '../config.ts';
import { json, readJson, type Route } from '../http.ts';

const PATH = /^\/accounts\/([a-z0-9-]{1,32})\/([0-9a-f]{2,512})$/;
const HEX = /^[0-9a-f]*$/;

type Store = Record<string, unknown>;

function isRecord(body: unknown, credentialId: string): boolean {
  if (!body || typeof body !== 'object') return false;
  const r = body as Record<string, unknown>;
  const pk = r.publicKey as Record<string, unknown> | undefined;
  const policy = r.policy as Record<string, unknown> | undefined;
  return (
    r.credentialId === credentialId &&
    typeof r.address === 'string' &&
    HEX.test(r.address) &&
    typeof pk?.x === 'string' &&
    typeof pk.y === 'string' &&
    typeof policy?.rp_id_hash === 'string' &&
    typeof policy.origin === 'string' &&
    typeof r.salt === 'string' &&
    HEX.test(r.salt) &&
    (r.status === 'deployed' || r.status === 'active')
  );
}

export function registryRoute(config: ServiceConfig): Route {
  const load = (): Store =>
    existsSync(config.registryFile)
      ? (JSON.parse(readFileSync(config.registryFile, 'utf8')) as Store)
      : {};
  const save = (store: Store) => {
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
    const key = `${m[1]}/${m[2]}`;
    if (req.method === 'GET') {
      const rec = load()[key];
      if (rec === undefined) json(res, 404, { error: 'not found' });
      else json(res, 200, rec);
      return true;
    }
    if (req.method === 'PUT') {
      const body = await readJson(req, 64 * 1024);
      if (!isRecord(body, m[2]!)) {
        json(res, 400, { error: 'bad account record' });
        return true;
      }
      const store = load();
      store[key] = body;
      save(store);
      res.writeHead(204);
      res.end();
      return true;
    }
    json(res, 405, { error: 'method not allowed' });
    return true;
  };
}
