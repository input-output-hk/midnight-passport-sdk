import type { PassportNameService } from '@input-output-hk/mn-passport-account/names';
import { createMidnamesNameService } from './resolver.js';
import { isClaimSponsorOrigin, requestClaimDispatch } from './claim-dispatch.js';
import { registryProfile } from './registry-pins.js';
import { claimHex, claimName, type ClaimRecovery } from './claim-receipt.js';
import type { ClaimPreparation } from './claim-quote.js';

export interface MidnamesConfig {
  readonly claimSponsor?: string | undefined;
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
  preparation?: ClaimPreparation,
): (PassportNameService & { readonly recovery?: ClaimRecovery }) | undefined {
  const { registryAddress, namespace, networkId, indexerUrl, indexerWsUrl } = config;
  if (!preparation && Object.values(config).every((value) => value === undefined)) return undefined;
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
  const profile = { registryAddress, namespace, networkId };
  const service = createMidnamesNameService(profile, {
    readTarget: async (...args) => (await reads()).readTarget(...args),
    isSupportedAccount: async (...args) => (await reads()).isSupportedAccount(...args),
  });
  const standalone = profileId === 'standalone-0.35' && namespace === 'night';
  if (preparation && config.claimSponsor !== '1')
    throw new Error('Claim preparation requires the loopback standalone sponsor.');
  if (
    config.claimSponsor !== undefined &&
    (config.claimSponsor !== '1' ||
      !standalone ||
      !isClaimSponsorOrigin(globalThis.location?.origin ?? ''))
  )
    throw new Error('Claim dispatch requires the loopback standalone sponsor.');
  if (!standalone) return service;
  return {
    ...service,
    recovery: {
      registryAddress,
      ...(config.claimSponsor === '1' && { dispatch: requestClaimDispatch }),
      ...(preparation && { preparation }),
      async availability(name, accountAddress) {
        if (!claimName(name) || !claimHex(accountAddress)) throw new Error('Invalid claim scope.');
        const reader = await reads();
        if (await reader.hasDomain(name, profile)) return 'taken';
        return (await reader.isSupportedAccount(accountAddress, networkId))
          ? 'available'
          : 'unsupported';
      },
      async check(receipt) {
        if (receipt.networkId !== networkId || receipt.registryAddress !== registryAddress)
          return 'conflict';
        const { confirmedClaim } = await import('./claim-finality.js');
        if (!(await confirmedClaim(http, receipt))) return 'pending';
        const reader = await reads();
        const record = await reader.readClaim(receipt.name, profile);
        if (!record) return 'pending';
        if (
          record.ownerCommitment !== receipt.ownerCommitment ||
          record.target.kind !== 'contract' ||
          record.target.address !== receipt.accountAddress ||
          !(await reader.isSupportedAccount(receipt.accountAddress, networkId))
        )
          return 'conflict';
        return 'registered';
      },
    },
  };
}
