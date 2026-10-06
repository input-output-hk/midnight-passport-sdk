import { createReadStream, statSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import type { ServiceConfig } from '../config.ts';
import { json, type Route } from '../http.ts';

const PREFIX = '/zk/acc/';

export function zkRoute(config: ServiceConfig): Route {
  const root = resolve(config.artefactDir);
  return async (req, res, url) => {
    if (req.method !== 'GET' || !url.pathname.startsWith(PREFIX)) return false;
    let rel: string;
    try {
      rel = decodeURIComponent(url.pathname.slice(PREFIX.length));
    } catch {
      json(res, 404, { error: 'not found' });
      return true;
    }
    // A NUL byte makes statSync throw (a 500), so it is refused here as an unknown file.
    if (rel.includes('\0')) {
      json(res, 404, { error: 'not found' });
      return true;
    }
    const path = resolve(root, rel);
    const inside = path.startsWith(`${root}${sep}`);
    const file = inside ? statSync(path, { throwIfNoEntry: false }) : undefined;
    if (!file?.isFile()) {
      json(res, 404, { error: 'not found' });
      return true;
    }
    res.writeHead(200, {
      'content-type': 'application/octet-stream',
      'content-length': file.size,
      'cache-control': rel.endsWith('contract-manifest.json')
        ? 'no-cache'
        : 'public, max-age=31536000, immutable',
    });
    createReadStream(path).pipe(res);
    return true;
  };
}

export function configRoute(config: ServiceConfig, extra: () => Record<string, unknown>): Route {
  return async (req, res, url) => {
    if (req.method !== 'GET' || url.pathname !== '/config') return false;
    json(res, 200, {
      networkId: config.networkId,
      bindingId: config.bindingId,
      manifestSha256: config.manifestSha256,
      indexerUri: config.indexerUri,
      indexerWsUri: config.indexerWsUri,
      nodeUri: config.nodeUri,
      zkBaseUrl: `http://${req.headers.host}/zk/acc`,
      ...extra(),
    });
    return true;
  };
}
