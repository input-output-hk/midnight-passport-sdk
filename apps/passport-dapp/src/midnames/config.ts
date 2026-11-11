import type { PassportNameService } from '@input-output-hk/mn-passport-account/names';
import { createMidnamesNameService } from './resolver.js';
import { registryProfile } from './registry-pins.js';

export interface MidnamesConfig {
  readonly registryProfile?: string | undefined;
  readonly registryAddress?: string | undefined;
  readonly namespace?: string | undefined;
  readonly networkId?: string | undefined;
  readonly indexerUrl?: string | undefined;
  readonly indexerWsUrl?: string | undefined;
}

function endpoint(value: string, secure: string, local: string): string {
  const url = new URL(value);
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (
    (url.protocol !== secure && !(loopback && url.protocol === local)) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error('Invalid naming indexer URL.');
  return url.href;
}

/** Absence selects the demo mock. Partial or mismatched configuration refuses. */
export function configureMidnames(
  config: MidnamesConfig,
  expectedNetwork: string,
  bindingId: string,
): PassportNameService | undefined {
  const { registryAddress, namespace, networkId, indexerUrl, indexerWsUrl } = config;
  if (Object.values(config).every((value) => value === undefined)) return undefined;
  if (
    !registryAddress ||
    !namespace ||
    networkId !== expectedNetwork ||
    !indexerUrl ||
    !indexerWsUrl
  )
    throw new Error('Configure the registry, namespace, matching network, and both indexer URLs.');
  const profileId = registryProfile(config.registryProfile, networkId);
  const http = endpoint(indexerUrl, 'https:', 'http:');
  const ws = endpoint(indexerWsUrl, 'wss:', 'ws:');
  const load = () =>
    import('./ledger-reader.js').then(({ createMidnamesIndexer, createMidnamesLedgerReads }) =>
      createMidnamesLedgerReads(
        createMidnamesIndexer(networkId, http, ws),
        networkId,
        bindingId,
        profileId,
      ),
    );
  let loaded: ReturnType<typeof load> | undefined;
  const reads = () =>
    (loaded ??= load().catch((error: unknown) => {
      loaded = undefined;
      throw error;
    }));
  return createMidnamesNameService(
    { registryAddress, namespace, networkId },
    {
      readTarget: async (...args) => (await reads()).readTarget(...args),
      isSupportedAccount: async (...args) => (await reads()).isSupportedAccount(...args),
    },
  );
}
