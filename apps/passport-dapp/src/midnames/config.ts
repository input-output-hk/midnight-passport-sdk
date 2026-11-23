import type { PassportNameService } from '@input-output-hk/mn-passport-account/names';
import {
  createMidnamesNameService,
  requireAgreeingMidnamesResolvers,
  requireKnownMidnamesMapping,
  requireMatchingFinalizedIndexerBlock,
} from './resolver.js';
import { isClaimSponsorOrigin, requestClaimDispatch } from './claim-dispatch.js';
import {
  isStandaloneRegistryProfile,
  registryProfile,
  type MidnamesRegistryProfile,
} from './registry-pins.js';
import { requireMidnamesV4IndexerPair } from './indexer-endpoints.js';
import {
  createMidnamesNodeFinality,
  type MidnamesIndexerBlock,
  type MidnamesNodePin,
} from './chain-finality.js';
import { claimHex, claimName, type ClaimRecovery } from './claim-receipt.js';
import type { ClaimPreparation } from './claim-quote.js';
import type { CandidateAccountQualification, createMidnamesLedgerReads } from './ledger-reader.js';

export interface MidnamesConfig {
  readonly claimSponsor?: string | undefined;
  /** Exact Indexer v4 transaction protocol observed on this chain, not the API version. */
  readonly claimProtocolVersion?: string | undefined;
  readonly registryProfile?: string | undefined;
  readonly registryAddress?: string | undefined;
  readonly namespace?: string | undefined;
  readonly networkId?: string | undefined;
  readonly indexerUrl?: string | undefined;
  readonly indexerWsUrl?: string | undefined;
  readonly verificationIndexerUrl?: string | undefined;
  readonly verificationIndexerWsUrl?: string | undefined;
  readonly nodeUrl?: string | undefined;
  readonly anchorBlockHeight?: string | undefined;
  readonly anchorBlockHash?: string | undefined;
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

function claimProtocolVersion(value: string | undefined): number {
  if (value !== '2001000' && value !== '2001100')
    throw new Error('Pin the observed standalone claim transaction protocol version.');
  return Number(value);
}

function selectedClaimProtocolVersion(
  standalone: boolean,
  config: MidnamesConfig,
  preparation: ClaimPreparation | undefined,
): number | undefined {
  if (!standalone) {
    if (config.claimProtocolVersion !== undefined)
      throw new Error('Claim protocol version applies only to the standalone registry.');
    return undefined;
  }
  if (
    !preparation &&
    config.claimSponsor === undefined &&
    config.claimProtocolVersion === undefined
  )
    return undefined;
  return claimProtocolVersion(config.claimProtocolVersion);
}

function configuredNodePin(
  config: MidnamesConfig,
  online: boolean,
  indexerHttp: string,
  verificationHttp: string | undefined,
): MidnamesNodePin | undefined {
  const { nodeUrl, anchorBlockHeight, anchorBlockHash } = config;
  const hasNodePin =
    nodeUrl !== undefined || anchorBlockHeight !== undefined || anchorBlockHash !== undefined;
  if (online && !hasNodePin)
    throw new Error('Online naming requires a separately pinned finalized node.');
  if (!hasNodePin) return undefined;
  if (!nodeUrl || !anchorBlockHeight || !anchorBlockHash)
    throw new Error('Naming node finality requires a complete node URL and chain block pin.');
  if (!/^[1-9][0-9]*$/.test(anchorBlockHeight))
    throw new Error('Naming chain anchor height must be a positive decimal integer.');
  const pin = {
    nodeUrl: endpoint(nodeUrl, 'https:', 'http:'),
    anchorHeight: Number(anchorBlockHeight),
    anchorHash: anchorBlockHash,
  };
  createMidnamesNodeFinality(pin);
  if (
    online &&
    (new URL(pin.nodeUrl).origin === new URL(indexerHttp).origin ||
      (verificationHttp && new URL(pin.nodeUrl).origin === new URL(verificationHttp).origin))
  )
    throw new Error('Online naming needs a node origin separate from both indexers.');
  return pin;
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
  requireMidnamesV4IndexerPair(http, ws);
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
  if (verification) requireMidnamesV4IndexerPair(verification.http, verification.ws);
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
  return { http, ws, verification, online };
}

function requireCandidateLocal(
  candidate: CandidateAccountQualification | undefined,
  profileId: MidnamesRegistryProfile,
  networkId: string,
  http: string,
  ws: string,
  verification: unknown,
): void {
  if (
    candidate &&
    (!isStandaloneRegistryProfile(profileId) ||
      networkId !== 'undeployed' ||
      !loopback(http) ||
      !loopback(ws) ||
      verification !== undefined)
  )
    throw new Error('Candidate ACC naming requires one local standalone registry and indexer.');
}

function requirePairNodePin(verification: unknown, nodePin: MidnamesNodePin | undefined): void {
  if (verification && !nodePin)
    throw new Error('Two-provider naming requires a separately pinned finalized node.');
}

type MidnamesReader = Pick<
  ReturnType<typeof createMidnamesLedgerReads>,
  | 'readTarget'
  | 'isSupportedAccount'
  | 'readSupportedTarget'
  | 'readFinalizedBlock'
  | 'readSupportedTargetAt'
>;
type LoadMidnamesReader = () => Promise<MidnamesReader>;

/** Keep a known mapping and its requested name within one provider snapshot. */
export function configuredNameService(
  profile: {
    readonly registryAddress: string;
    readonly namespace: string;
    readonly networkId: string;
  },
  reads: LoadMidnamesReader,
  verificationReads: LoadMidnamesReader | undefined,
  knownName: string | undefined,
  knownAccountAddress: string | undefined,
): PassportNameService {
  const serviceFor = (
    source: LoadMidnamesReader,
    selectedBlock?: () => Promise<MidnamesIndexerBlock>,
  ) =>
    createMidnamesNameService(profile, {
      readTarget: async (...args) => (await source()).readTarget(...args),
      isSupportedAccount: async (...args) => (await source()).isSupportedAccount(...args),
      readSupportedTarget: async (...args) => {
        const reader = await source();
        return selectedBlock
          ? reader.readSupportedTargetAt(...args, await selectedBlock())
          : reader.readSupportedTarget(...args);
      },
    });
  const known = (service: PassportNameService) =>
    knownName === undefined || knownAccountAddress === undefined
      ? service
      : requireKnownMidnamesMapping(service, profile.networkId, knownName, knownAccountAddress);
  const primary = serviceFor(reads);
  const validated = known(primary);
  if (!verificationReads) return validated;
  return Object.freeze({
    provider: primary.provider,
    async resolve(query: Parameters<PassportNameService['resolve']>[0]) {
      let selected: Promise<MidnamesIndexerBlock> | undefined;
      const select = () =>
        (selected ??= requireMatchingFinalizedIndexerBlock(
          async () => (await reads()).readFinalizedBlock(),
          async () => (await verificationReads()).readFinalizedBlock(),
        ));
      const scoped = requireAgreeingMidnamesResolvers(
        serviceFor(reads, select),
        serviceFor(verificationReads, select),
      );
      // Known mapping and requested name share this one selected block.
      return known(scoped).resolve(query);
    },
  });
}

/** Absence selects the demo mock. Partial or mismatched configuration refuses. */
export function configureMidnames(
  config: MidnamesConfig,
  expectedNetwork: string,
  bindingId: string,
  preparation?: ClaimPreparation,
  candidate?: CandidateAccountQualification,
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
  const { http, ws, verification, online } = configuredIndexers(config, networkId);
  requireCandidateLocal(candidate, profileId, networkId, http, ws, verification);
  const nodePin = configuredNodePin(config, online, http, verification?.http);
  requirePairNodePin(verification, nodePin);
  const verifyFinalizedBlock = nodePin && createMidnamesNodeFinality(nodePin);
  const load = (readerHttp: string, readerWs: string) =>
    import('./ledger-reader.js').then(({ createMidnamesIndexer, createMidnamesLedgerReads }) =>
      createMidnamesLedgerReads(
        createMidnamesIndexer(networkId, readerHttp, readerWs),
        networkId,
        bindingId,
        profileId,
        candidate,
        verifyFinalizedBlock,
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
  const service = configuredNameService(
    profile,
    reads,
    verificationReads,
    knownName,
    knownAccountAddress,
  );
  const guardKnown = async () => {
    if (knownName !== undefined) await service.resolve({ name: knownName, networkId });
  };
  // The 0.36.1 compiler profile is read-only until its browser owner bundle
  // proves and submits through the release prover at this exact source head.
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
  const protocolVersion = selectedClaimProtocolVersion(standalone, config, preparation);
  if (protocolVersion === undefined) return service;
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
        const finality = await readClaimFinality(http, receipt, fetch, protocolVersion);
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
