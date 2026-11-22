import { resolvePinnedBinding } from '@input-output-hk/mn-passport-contract';
import { join } from 'node:path';
import type { ServiceConfig } from './config.ts';

const loopbackHosts = new Set(['localhost', '127.0.0.1', '[::1]']);

function localUrl(value: string, protocols: readonly string[], path: string): boolean {
  try {
    const url = new URL(value);
    return (
      protocols.includes(url.protocol) &&
      loopbackHosts.has(url.hostname) &&
      url.pathname === path &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash
    );
  } catch {
    return false;
  }
}

/** The source host accepts only independently packaged pins and explicit candidate assets. */
export function assertPinnedBinding(
  config: Pick<
    ServiceConfig,
    | 'bindingId'
    | 'manifestSha256'
    | 'contractDir'
    | 'artefactDir'
    | 'networkId'
    | 'host'
    | 'corsOrigin'
    | 'nodeUri'
    | 'indexerUri'
    | 'indexerWsUri'
    | 'proofServerUri'
    | 'publicStack'
  >,
  candidateLocal: boolean,
): void {
  const binding = resolvePinnedBinding(config.bindingId);
  if (config.manifestSha256 !== binding.manifestSha256)
    throw new Error('passport-service: binding or manifest differs from the package pin');
  if (!binding.provisional) return;
  if (config.artefactDir === join(config.contractDir, 'contracts/managed/account'))
    throw new Error(
      'passport-service: provisional binding requires a separate ACC asset directory',
    );
  if (!candidateLocal || config.networkId !== 'undeployed')
    throw new Error(
      'passport-service: provisional binding requires explicit local undeployed mode',
    );
  if (
    !loopbackHosts.has(config.host) ||
    !localUrl(config.corsOrigin, ['http:', 'https:'], '/') ||
    !localUrl(config.nodeUri, ['http:', 'https:'], '/') ||
    !localUrl(config.proofServerUri, ['http:', 'https:'], '/') ||
    !localUrl(config.indexerUri, ['http:', 'https:'], '/api/v4/graphql') ||
    !localUrl(config.indexerWsUri, ['ws:', 'wss:'], '/api/v4/graphql/ws') ||
    config.publicStack.networkId !== 'undeployed' ||
    !localUrl(config.publicStack.nodeUri, ['http:', 'https:'], '/') ||
    !localUrl(config.publicStack.proofServerUri, ['http:', 'https:'], '/') ||
    !localUrl(config.publicStack.indexerUri, ['http:', 'https:'], '/api/v4/graphql') ||
    !localUrl(config.publicStack.indexerWsUri, ['ws:', 'wss:'], '/api/v4/graphql/ws')
  )
    throw new Error('passport-service: provisional binding requires loopback API v4 endpoints');
}
