import { PassportConnectorError } from '@input-output-hk/mn-passport-account/errors';
import type { NetworkConfig } from '@input-output-hk/mn-passport-account/ports';
import type { ServiceWire } from '@input-output-hk/mn-passport-protocol';
import { CONFIG_TIMEOUT_MS, readConfigJson } from './config-read.js';
import { parseV1Config } from './config-schema.js';
import type { RemoteOptions } from './options.js';
import {
  defaultFetch,
  fetchServiceConfig,
  trimBase,
  type ServiceConfigWire,
} from './service-client.js';

/** Pinned discovery, bounded to 64 KiB and 30s by default (timeoutMs: 1..600000). */
export async function fetchCheckedConfig(
  base: string,
  pin: Pick<NetworkConfig, 'networkId' | 'bindingId' | 'manifestSha256'>,
  options: RemoteOptions = {},
): Promise<ServiceConfigWire> {
  const config = await fetchServiceConfig(
    base,
    options.fetch ?? defaultFetch,
    pin.networkId,
    options.timeoutMs === undefined ? CONFIG_TIMEOUT_MS : options.timeoutMs,
  );
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

/** Versioned pinned discovery with the same 64 KiB and 30s default read budget. */
export async function fetchCheckedV1Config(
  base: string,
  pin: Pick<NetworkConfig, 'networkId' | 'bindingId' | 'manifestSha256' | 'artefactUrl'>,
  options: RemoteOptions = {},
): Promise<ServiceWire.Config> {
  const body = await readConfigJson(
    options.fetch ?? defaultFetch,
    `${trimBase(base)}/v1/config`,
    '/v1/config',
    options.timeoutMs === undefined ? CONFIG_TIMEOUT_MS : options.timeoutMs,
  );
  return parseV1Config(body, pin);
}
