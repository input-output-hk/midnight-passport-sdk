import type { ServiceConfig } from '../config.ts';
import { json, type Route } from '../http.ts';

export { zkRoute } from '@input-output-hk/mn-passport-service';

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
      proofServerUri: config.proofServerUri,
      zkBaseUrl: `http://${req.headers.host ?? `localhost:${config.port}`}/zk/acc`,
      ...extra(),
    });
    return true;
  };
}
