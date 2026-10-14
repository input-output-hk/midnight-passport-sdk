import { PassportConnectorError } from '@input-output-hk/mn-passport-account/errors';
import type { NetworkConfig } from '@input-output-hk/mn-passport-account/ports';
import {
  PASSPORT_SERVICE_API_VERSION,
  type ServiceWire,
} from '@input-output-hk/mn-passport-protocol';
import type { RemoteOptions } from './options.js';
import {
  defaultFetch,
  fetchServiceConfig,
  trimBase,
  type ServiceConfigWire,
} from './service-client.js';

/** Check service discovery against a pin supplied by the app, never by the service itself. */
export async function fetchCheckedConfig(
  base: string,
  pin: Pick<NetworkConfig, 'networkId' | 'bindingId' | 'manifestSha256'>,
  options: RemoteOptions = {},
): Promise<ServiceConfigWire> {
  const config = await fetchServiceConfig(base, options.fetch ?? defaultFetch, pin.networkId);
  if (config.bindingId !== pin.bindingId) {
    throw new PassportConnectorError(
      'BindingUnsupported',
      `service binding ${config.bindingId} does not match ${pin.bindingId}`,
    );
  }
  if (
    !/^[0-9a-f]{64}$/i.test(pin.manifestSha256) ||
    config.manifestSha256.toLowerCase() !== pin.manifestSha256.toLowerCase()
  ) {
    throw new PassportConnectorError(
      'ArtefactIntegrity',
      'service artefact manifest differs from the app pin',
    );
  }
  return config;
}

/** Check the versioned service discovery answer against the host's build-time pins. */
export async function fetchCheckedV1Config(
  base: string,
  pin: Pick<NetworkConfig, 'networkId' | 'bindingId' | 'manifestSha256' | 'artefactUrl'>,
  options: RemoteOptions = {},
): Promise<ServiceWire.Config> {
  let response;
  try {
    response = await (options.fetch ?? defaultFetch)(`${trimBase(base)}/v1/config`);
  } catch (cause) {
    throw new PassportConnectorError('InternalError', 'service /v1/config is unreachable', {
      cause,
    });
  }
  if (!response.ok)
    throw new PassportConnectorError(
      'InternalError',
      `service /v1/config failed: ${response.status}`,
    );
  let body: unknown;
  try {
    body = await response.json();
  } catch (cause) {
    throw new PassportConnectorError('InternalError', 'service /v1/config answered invalid JSON', {
      cause,
    });
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body))
    throw new PassportConnectorError('InternalError', 'service /v1/config answered a non-object');
  const value = body as Record<string, unknown>;
  if (value.networkId !== pin.networkId)
    throw new PassportConnectorError(
      'NetworkMismatch',
      `service is on ${String(value.networkId)}, connector is bound to ${pin.networkId}`,
    );
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
  const fields = [
    'indexerUri',
    'indexerWsUri',
    'nodeUri',
    'proofServerUri',
    'zkBaseUrl',
    'coinPublicKey',
    'encryptionPublicKey',
  ] as const;
  for (const field of fields) {
    if (typeof value[field] !== 'string' || value[field].length === 0)
      throw new PassportConnectorError('InternalError', `service /v1/config has no "${field}"`);
  }
  let artefact: URL;
  try {
    artefact = new URL(value.zkBaseUrl as string);
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
  return value as unknown as ServiceWire.Config;
}
