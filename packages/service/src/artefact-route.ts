import { createReadStream, realpathSync, statSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { pipeline } from 'node:stream';
import { json, type Route } from './http.js';
import { verifyArtefacts } from './artefacts.js';

export interface ArtefactRouteConfig {
  readonly artefactDir: string;
}

const PREFIX = '/zk/acc/';
/** The only artefact folders served: the compiler output (manifest, contract-info), ZKIR and keys. */
const SERVED = ['compiler/', 'zkir/', 'keys/'];

function artefactRoute(config: ArtefactRouteConfig, prefixes: readonly string[]): Route {
  const root = resolve(config.artefactDir);
  const realRoot = realpathSync(root);
  return async (req, res, url) => {
    const prefix = prefixes.find((candidate) => url.pathname.startsWith(candidate));
    if (req.method !== 'GET' || prefix === undefined) return false;
    let rel: string;
    try {
      rel = decodeURIComponent(url.pathname.slice(prefix.length));
    } catch {
      json(res, 404, { error: 'not found' });
      return true;
    }
    if (!SERVED.some((folder) => rel.startsWith(folder))) {
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
    let file = inside ? statSync(path, { throwIfNoEntry: false }) : undefined;
    // A symlink inside the key tree must not make a sponsor-held file downloadable.
    if (file) {
      try {
        if (!realpathSync(path).startsWith(`${realRoot}${sep}`)) file = undefined;
      } catch {
        file = undefined;
      }
    }
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
    // pipeline closes the file on a client abort and surfaces read errors instead of crashing.
    pipeline(createReadStream(path), res, (err) => {
      if (err) res.destroy();
    });
    return true;
  };
}

/** Legacy prototype path; the caller verifies the tree before serving it. */
export function zkRoute(config: ArtefactRouteConfig): Route {
  return artefactRoute(config, [PREFIX]);
}

export interface PinnedArtefactRouteConfig extends ArtefactRouteConfig {
  readonly bindingId: string;
  readonly manifestSha256: string;
}

/** Verify the full tree once, then serve both legacy and binding-pinned v1 paths. */
export function pinnedZkRoute(config: PinnedArtefactRouteConfig): Route {
  if (!/^[a-z0-9][a-z0-9.-]*$/.test(config.bindingId)) throw new Error('invalid ACC binding id');
  if (!/^[0-9a-f]{64}$/.test(config.manifestSha256)) throw new Error('invalid ACC manifest pin');
  verifyArtefacts(config.artefactDir, config.manifestSha256);
  return artefactRoute(config, [PREFIX, `/v1/zk/${config.bindingId}/`]);
}
