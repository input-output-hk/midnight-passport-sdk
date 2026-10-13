import { PassportConnectorError } from '@input-output-hk/mn-passport-account/errors';
import type { NetworkConfig } from '@input-output-hk/mn-passport-account/ports';
import type { RemoteOptions } from './options.js';
import { defaultFetch, fetchServiceConfig, type ServiceConfigWire } from './service-client.js';

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
