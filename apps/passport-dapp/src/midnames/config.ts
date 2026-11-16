import type { PassportNameService } from '@input-output-hk/mn-passport-account/names';
import {
  createMidnamesNameService,
  requireAgreeingMidnamesResolvers,
  requireKnownMidnamesMapping,
} from './resolver.js';
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
  readonly verificationIndexerUrl?: string | undefined;
  readonly verificationIndexerWsUrl?: string | undefined;
  readonly knownName?: string | undefined;
  readonly knownAccountAddress?: string | undefined;
}

const loopback = (value: string) =>
  ['localhost', '127.0.0.1', '[::1]'].includes(new URL(value).hostname);

function endpoint(value: string, secure: string, local: string): string {
  const url = new URL(value);
  if (
    (url.protocol !== secure && !(loopback(value) && url.protocol === local)) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error('Invalid naming indexer URL.');
  return url.href;
}

function requireOnlinePin(
  online: boolean,
  name: string | undefined,
  account: string | undefined,
): void {
  const hasPin = name !== undefined || account !== undefined;
  if ((hasPin && (!name?.trim() || !account?.trim())) || (online && !hasPin))
    throw new Error('Online naming requires a complete independently observed name-to-ACC pin.');
}

function configuredIndexers(config: MidnamesConfig, networkId: string) {
  const {
    indexerUrl,
    indexerWsUrl,
    verificationIndexerUrl,
    verificationIndexerWsUrl,
    knownName,
    knownAccountAddress,
  } = config;
  if (!indexerUrl || !indexerWsUrl)
    throw new Error('Configure the registry, namespace, matching network, and both indexer URLs.');
  const http = endpoint(indexerUrl, 'https:', 'http:');
  const ws = endpoint(indexerWsUrl, 'wss:', 'ws:');
  const hasVerification =
    verificationIndexerUrl !== undefined || verificationIndexerWsUrl !== undefined;
  if (hasVerification && (!verificationIndexerUrl || !verificationIndexerWsUrl))
    throw new Error('Online naming requires two complete, distinct indexer paths.');
  const verification =
    verificationIndexerUrl && verificationIndexerWsUrl
      ? {
          http: endpoint(verificationIndexerUrl, 'https:', 'http:'),
          ws: endpoint(verificationIndexerWsUrl, 'wss:', 'ws:'),
        }
      : undefined;
  const online =
    networkId !== 'undeployed' ||
    !loopback(http) ||
    !loopback(ws) ||
    (verification !== undefined && (!loopback(verification.http) || !loopback(verification.ws)));
  requireOnlinePin(online, knownName, knownAccountAddress);
  if (online && !verification)
    throw new Error('Online naming requires two complete, distinct indexer paths.');
  if (
    verification &&
    (new URL(verification.http).origin === new URL(http).origin ||
      new URL(verification.ws).origin === new URL(ws).origin)
  )
    throw new Error('Naming verification must use a distinct indexer origin.');
  return { http, ws, verification };
}

/** Absence selects the demo mock. Partial or mismatched configuration refuses. */
export function configureMidnames(
  config: MidnamesConfig,
  expectedNetwork: string,
  bindingId: string,
  preparation?: ClaimPreparation,
): (PassportNameService & { readonly recovery?: ClaimRecovery }) | undefined {
  const { registryAddress, namespace, networkId, knownName, knownAccountAddress } = config;
  if (!preparation && Object.values(config).every((value) => value === undefined)) return undefined;
  if (
    !registryAddress ||
    !namespace ||
    networkId !== expectedNetwork ||
    !config.indexerUrl ||
    !config.indexerWsUrl
  )
    throw new Error('Configure the registry, namespace, matching network, and both indexer URLs.');
  const profileId = registryProfile(config.registryProfile, networkId);
  const { http, ws, verification } = configuredIndexers(config, networkId);
  const load = (readerHttp: string, readerWs: string) =>
    import('./ledger-reader.js').then(({ createMidnamesIndexer, createMidnamesLedgerReads }) =>
      createMidnamesLedgerReads(
        createMidnamesIndexer(networkId, readerHttp, readerWs),
        networkId,
        bindingId,
        profileId,
      ),
    );
  const lazyReads = (readerHttp: string, readerWs: string) => {
    let loaded: ReturnType<typeof load> | undefined;
    return () =>
      (loaded ??= load(readerHttp, readerWs).catch((error: unknown) => {
        loaded = undefined;
        throw error;
      }));
  };
  const reads = lazyReads(http, ws);
  const verificationReads = verification && lazyReads(verification.http, verification.ws);
  const profile = { registryAddress, namespace, networkId };
  const serviceFor = (source: typeof reads) =>
    createMidnamesNameService(profile, {
      readTarget: async (...args) => (await source()).readTarget(...args),
      isSupportedAccount: async (...args) => (await source()).isSupportedAccount(...args),
    });
  const readerService = serviceFor(reads);
  const checkedService = verificationReads
    ? requireAgreeingMidnamesResolvers(readerService, serviceFor(verificationReads))
    : readerService;
  const service =
    knownName === undefined || knownAccountAddress === undefined
      ? checkedService
      : requireKnownMidnamesMapping(checkedService, networkId, knownName, knownAccountAddress);
  const guardKnown = async () => {
    if (knownName !== undefined) await service.resolve({ name: knownName, networkId });
  };
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
        await guardKnown();
        const reader = await reads();
        if (await reader.hasDomain(name, profile)) return 'taken';
        return (await reader.isSupportedAccount(accountAddress, networkId))
          ? 'available'
          : 'unsupported';
      },
      async check(receipt) {
        if (receipt.networkId !== networkId || receipt.registryAddress !== registryAddress)
          return 'conflict';
        try {
          await guardKnown();
        } catch {
          return 'unavailable';
        }
        const { readClaimFinality } = await import('./claim-finality.js');
        const finality = await readClaimFinality(http, receipt);
        if (finality === undefined) return 'unavailable';
        if (finality === 'conflict') return 'conflict';
        if (finality === 'failed' || finality === 'claim-failed') {
          try {
            const reader = await reads();
            return (await reader.readClaim(receipt.name, profile)) ? 'conflict' : finality;
          } catch {
            return 'unavailable';
          }
        }
        if (!finality) return 'pending';
        try {
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
        } catch {
          return 'unavailable';
        }
      },
    },
  };
}
