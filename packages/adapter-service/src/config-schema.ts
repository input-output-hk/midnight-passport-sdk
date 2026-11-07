import { z } from 'zod';
import { PassportConnectorError } from '@input-output-hk/mn-passport-account/errors';
import {
  PASSPORT_SERVICE_API_VERSION,
  type ServiceWire,
} from '@input-output-hk/mn-passport-protocol';
import type { NetworkConfig } from '@input-output-hk/mn-passport-account/ports';
import type { ServiceConfigWire } from './service-client.js';

const legacySchema = z.object({
  networkId: z.string(),
  bindingId: z.string(),
  manifestSha256: z.string(),
  indexerUri: z.string(),
  indexerWsUri: z.string(),
  nodeUri: z.string(),
  proofServerUri: z.string(),
  zkBaseUrl: z.string(),
  coinPublicKey: z.string(),
  encryptionPublicKey: z.string(),
});
const nonempty = z.string().min(1);
const v1Schema = legacySchema
  .extend({
    indexerUri: nonempty,
    indexerWsUri: nonempty,
    nodeUri: nonempty,
    proofServerUri: nonempty,
    zkBaseUrl: nonempty,
    coinPublicKey: nonempty,
    encryptionPublicKey: nonempty,
    apiVersions: z.array(z.string()),
  })
  .loose();

function configRecord(body: unknown, path: string): Record<string, unknown> {
  if (!body || typeof body !== 'object' || Array.isArray(body))
    throw new PassportConnectorError(
      'InternalError',
      `service ${path} answered ${path === '/config' ? 'a body that is not an object' : 'a non-object'}`,
    );
  return body as Record<string, unknown>;
}
function checkNetwork(value: Record<string, unknown>, networkId: string): void {
  if (value.networkId !== networkId)
    throw new PassportConnectorError(
      'NetworkMismatch',
      `service is on ${String(value.networkId)}, connector is bound to ${networkId}`,
    );
}

export function parseLegacyConfig(body: unknown, networkId: string): ServiceConfigWire {
  const value = configRecord(body, '/config');
  checkNetwork(value, networkId);
  const parsed = legacySchema.safeParse(value);
  if (!parsed.success)
    throw new PassportConnectorError(
      'InternalError',
      `service /config has no "${String(parsed.error.issues[0]?.path[0])}"`,
    );
  return parsed.data;
}

export function parseV1Config(
  body: unknown,
  pin: Pick<NetworkConfig, 'networkId' | 'bindingId' | 'manifestSha256' | 'artefactUrl'>,
): ServiceWire.Config {
  const value = configRecord(body, '/v1/config');
  checkNetwork(value, pin.networkId);
  if (value.bindingId !== pin.bindingId)
    throw new PassportConnectorError(
      'BindingUnsupported',
      `service binding ${String(value.bindingId)} does not match ${pin.bindingId}`,
    );
  if (
    !/^[0-9a-f]{64}$/i.test(pin.manifestSha256) ||
    typeof value.manifestSha256 !== 'string' ||
    value.manifestSha256.toLowerCase() !== pin.manifestSha256.toLowerCase()
  )
    throw new PassportConnectorError(
      'ArtefactIntegrity',
      'service manifest differs from the app pin',
    );
  if (
    !Array.isArray(value.apiVersions) ||
    !value.apiVersions.includes(PASSPORT_SERVICE_API_VERSION)
  )
    throw new PassportConnectorError(
      'ApiVersionUnsupported',
      'service does not offer this v1 wire',
    );
  const parsed = v1Schema.safeParse(value);
  if (!parsed.success)
    throw new PassportConnectorError(
      'InternalError',
      `service /v1/config has no valid "${String(parsed.error.issues[0]?.path[0])}"`,
    );
  const config = parsed.data;
  let artefact: URL;
  try {
    artefact = new URL(config.zkBaseUrl);
  } catch {
    throw new PassportConnectorError(
      'ArtefactIntegrity',
      'service advertised an invalid artefact URL',
    );
  }
  if (
    !['http:', 'https:'].includes(artefact.protocol) ||
    artefact.pathname !== `/v1/zk/${pin.bindingId}` ||
    artefact.search ||
    artefact.hash ||
    artefact.href.replace(/\/$/, '') !== pin.artefactUrl.replace(/\/$/, '')
  )
    throw new PassportConnectorError(
      'ArtefactIntegrity',
      'service artefact URL differs from the app pin',
    );
  return config;
}
