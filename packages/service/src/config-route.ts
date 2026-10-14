import {
  PASSPORT_SERVICE_API_VERSION,
  type ServiceWire,
} from '@input-output-hk/mn-passport-protocol';
import { json, type Route } from './http.js';

/** Public, non-secret network and binding configuration supplied by the host. */
export type PublicServiceConfig = Omit<
  ServiceWire.Config,
  'zkBaseUrl' | 'coinPublicKey' | 'encryptionPublicKey' | 'apiVersions'
> & { readonly port: number; readonly publicBaseUrl?: string };

/** Legacy /config and v1 discovery, both derived from the same pinned network configuration. */
export function serviceConfigRoute(
  config: PublicServiceConfig,
  extra: () => Record<string, unknown>,
): Route {
  return async (req, res, url) => {
    if (req.method !== 'GET' || (url.pathname !== '/config' && url.pathname !== '/v1/config'))
      return false;
    const base = (
      config.publicBaseUrl ?? `http://${req.headers.host ?? `localhost:${config.port}`}`
    ).replace(/\/+$/, '');
    const shared = {
      networkId: config.networkId,
      bindingId: config.bindingId,
      manifestSha256: config.manifestSha256,
      indexerUri: config.indexerUri,
      indexerWsUri: config.indexerWsUri,
      nodeUri: config.nodeUri,
      proofServerUri: config.proofServerUri,
    };
    const values = extra();
    if (url.pathname === '/config') {
      json(res, 200, { ...shared, zkBaseUrl: `${base}/zk/acc`, ...values });
      return true;
    }
    if (typeof values.coinPublicKey !== 'string' || typeof values.encryptionPublicKey !== 'string')
      throw new Error('v1 config requires sponsor public keys');
    const answer: ServiceWire.Config = {
      ...shared,
      zkBaseUrl: `${base}/v1/zk/${config.bindingId}`,
      coinPublicKey: values.coinPublicKey,
      encryptionPublicKey: values.encryptionPublicKey,
      apiVersions: [PASSPORT_SERVICE_API_VERSION],
    };
    json(res, 200, answer);
    return true;
  };
}
