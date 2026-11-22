import { resolvePinnedBinding } from '@input-output-hk/mn-passport-contract';
import { join } from 'node:path';
import type { ServiceConfig } from './config.ts';

/** The source host accepts only independently packaged pins and explicit candidate assets. */
export function assertPinnedBinding(
  config: Pick<ServiceConfig, 'bindingId' | 'manifestSha256' | 'contractDir' | 'artefactDir'>,
): void {
  const binding = resolvePinnedBinding(config.bindingId);
  if (config.manifestSha256 !== binding.manifestSha256)
    throw new Error('passport-service: binding or manifest differs from the package pin');
  if (
    binding.provisional &&
    config.artefactDir === join(config.contractDir, 'contracts/managed/account')
  )
    throw new Error(
      'passport-service: provisional binding requires a separate ACC asset directory',
    );
}
