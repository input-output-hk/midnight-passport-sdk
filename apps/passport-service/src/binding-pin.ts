import { BINDING_VERSION, resolveBinding } from '@input-output-hk/mn-passport-contract';
import type { ServiceConfig } from './config.ts';

/** The image and source demo serve only the ACC binding shipped with this SDK build. */
export function assertPinnedBinding(
  config: Pick<ServiceConfig, 'bindingId' | 'manifestSha256'>,
): void {
  const binding = resolveBinding(BINDING_VERSION);
  if (config.bindingId !== BINDING_VERSION || config.manifestSha256 !== binding.manifestSha256)
    throw new Error('passport-service: binding or manifest differs from the package pin');
}
