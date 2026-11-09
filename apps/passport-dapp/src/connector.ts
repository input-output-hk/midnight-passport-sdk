import { exportGrantOpening } from './grant-opening.js';
import type {
  AccountDirectory,
  ActiveReadGrantTargetSource,
  NetworkConfig,
  QualifiedHoldingSource,
} from '@input-output-hk/mn-passport-account/ports';
import type { PrfKeySource } from '@input-output-hk/mn-passport-account/ports';
import {
  createBrowserPassport,
  injectPassportConnector,
  type BrowserLoginKeys,
} from '@input-output-hk/mn-passport-adapter-browser';
import {
  createRegistryClient,
  fetchCheckedV1Config,
  remoteDirectory,
  remoteV1Deployer,
  remoteV1Prover,
  remoteV1Sponsor,
} from '@input-output-hk/mn-passport-adapter-service';
import {
  PASSPORT_API_VERSION,
  type PassportConnectorAPI,
} from '@input-output-hk/mn-passport-protocol';
import { createGrantBookkeepingRecovery } from '@input-output-hk/mn-passport-account';
import {
  recipeDeviceKeyring,
  type AuthenticatedJubjubOwner,
} from '@input-output-hk/mn-passport-keys';
import { tracedFetch } from './operation-trace.js';
import { browserAccountRecords, browserGrantJournal } from './grant-journal.js';
import { reviewedOwnerValueCall } from './reviewed-value-call.js';
import { grantHandoffFromOpening, type GrantHandoff } from './grant-handoff.js';
import { beforeDemoCeremony } from './consent.js';
import {
  routineKeys,
  checkRoutineReview,
  acceptRoutineLogin,
  approveCriticalOwner,
} from './routine-access.js';
import { demoSigningMode } from './signing-mode.js';

export const SERVICE_URL = import.meta.env.VITE_PASSPORT_SERVICE_URL ?? 'http://localhost:8787';
/** The artefact manifest hash this build pins (R18); the service's /v1/config is checked against it. */
export const MANIFEST_SHA256 = __PASSPORT_MANIFEST_SHA256__;
/** The network this build is bound to, fixed at build time next to the manifest pin. */
export const NETWORK_ID = __PASSPORT_NETWORK_ID__;
export const RP_ID = 'localhost';
/** The grants ACC binding this page deploys: the artefact build the manifest pin above names. */
export const BINDING_ID = 'acc-s3r1.1';
/** The host pins this separately from the service's discovery answer. */
const ARTEFACT_URL =
  import.meta.env.VITE_PASSPORT_ARTEFACT_URL ??
  `${SERVICE_URL.replace(/\/+$/, '')}/v1/zk/${BINDING_ID}`;
const signing = demoSigningMode({
  mode: import.meta.env.VITE_PASSPORT_SIGNING_MODE,
  legacyArm: import.meta.env.VITE_PASSPORT_ARM,
  search: location.search,
});
export const ARM = signing.arm;
export const SIGNING_MODE = signing.mode;
export const ORIGIN = 'http://localhost:5173';
const loginOptions = {
  onAccountOpened: (
    account: import('@input-output-hk/mn-passport-protocol').PassportAccount,
    keys: BrowserLoginKeys,
  ) => acceptRoutineLogin(account, keys, RP_ID, ORIGIN),
  onAccountCreated: (
    account: import('@input-output-hk/mn-passport-protocol').PassportAccount,
    keys: BrowserLoginKeys,
  ) => acceptRoutineLogin(account, keys, RP_ID, ORIGIN),
};
let exportOpening: ((account: string, grantId: string) => Promise<GrantHandoff>) | undefined;
let ownerExportOpening: typeof exportOpening;

/** Owner-only handoff from the selected passkey's encrypted local journal. */
export async function exportDemoGrantOpening(
  account: string,
  grantId: string,
): Promise<GrantHandoff> {
  checkRoutineReview();
  if (
    routineKeys.snapshot().authority === 'owner' &&
    routineKeys.snapshot().account === account &&
    ownerExportOpening
  ) {
    await approveCriticalOwner(true);
    return ownerExportOpening(account, grantId);
  }
  if (!exportOpening) throw new Error('Connect and open the owner account first.');
  return exportOpening(account, grantId);
}

/** Legacy hints remain discoverable; the sealed P-256 connector refuses them until migrated. */
function demoDirectory(): AccountDirectory {
  const directory = remoteDirectory(SERVICE_URL, { fetch: tracedFetch });
  const legacy = createRegistryClient(SERVICE_URL, tracedFetch);
  return {
    async get(networkId, key) {
      const hint = await directory.get(networkId, key);
      if (hint) return hint;
      const record = await legacy.get(networkId, key.credentialId);
      return record && { ...record, scheme: 'p256-webauthn' };
    },
    put: directory.put,
  };
}

export async function connect(
  networkId: string,
  ownerSession?: AuthenticatedJubjubOwner,
): Promise<PassportConnectorAPI> {
  const config = await fetchCheckedV1Config(
    SERVICE_URL,
    {
      networkId,
      bindingId: BINDING_ID,
      manifestSha256: MANIFEST_SHA256,
      artefactUrl: ARTEFACT_URL,
    },
    { fetch: tracedFetch },
  );
  const network: NetworkConfig = {
    networkId,
    bindingId: BINDING_ID,
    manifestSha256: MANIFEST_SHA256,
    indexerUrl: config.indexerUri,
    indexerWsUrl: config.indexerWsUri,
    nodeUrl: config.nodeUri,
    artefactUrl: config.zkBaseUrl,
  };
  const sponsor = remoteV1Sponsor(SERVICE_URL, { fetch: tracedFetch });
  let holdingSource: Promise<QualifiedHoldingSource> | undefined;
  const holdings = (): Promise<QualifiedHoldingSource> =>
    (holdingSource ??= import('@input-output-hk/mn-passport-adapter-midnight-js').then(
      ({ createGraphqlHoldingIndexer, createMidnightHoldingSource }) =>
        createMidnightHoldingSource(
          createGraphqlHoldingIndexer({
            networkId,
            url: config.indexerUri,
            wsUrl: config.indexerWsUri,
          }),
        ),
    ));
  const holdingPort: QualifiedHoldingSource = {
    selectHeldEntries: async (account, entries, opened) =>
      (await holdings()).selectHeldEntries(account, entries, opened),
    selectQualifiedHeldCoins: async (account, entries, opened) =>
      (await holdings()).selectQualifiedHeldCoins(account, entries, opened),
  };
  let journal: ReturnType<typeof browserGrantJournal> | undefined;
  let recoverReadKey:
    ((account: string, grantId: string) => Promise<string | undefined>) | undefined;
  let grantSource:
    | Promise<
        ReturnType<
          typeof import('@input-output-hk/mn-passport-adapter-midnight-js').createMidnightGrantSource
        >
      >
    | undefined;
  const grants = () =>
    (grantSource ??= Promise.all([
      import('@input-output-hk/mn-passport-adapter-midnight-js'),
      import('./acc-module.js'),
    ]).then(([{ createMidnightGrantSource }, { accModule }]) =>
      createMidnightGrantSource({
        network,
        binding: accModule,
        openings: {
          readReadPublicKey: async (account, grantId) =>
            (await journal?.readReadPublicKey(account, grantId)) ??
            (await recoverReadKey?.(account, grantId)),
        },
      }),
    ));
  const readGrants: ActiveReadGrantTargetSource = {
    readActiveReadGrantTargets: async (account) =>
      (await grants()).readActiveReadGrantTargets(account),
  };
  const exportFromJournal = (account: string, grantId: string) =>
    exportGrantOpening(
      journal,
      grants,
      networkId,
      async () =>
        (await import('./acc-module.js')).accModule.pureCircuits as unknown as Parameters<
          typeof grantHandoffFromOpening
        >[4],
      account,
      grantId,
    );
  if (ownerSession) ownerExportOpening = exportFromJournal;
  else exportOpening = exportFromJournal;
  let ownerRecord: Awaited<
    ReturnType<import('@input-output-hk/mn-passport-account/ports').AccountRecordStore['read']>
  >;
  return createBrowserPassport({
    arm: ownerSession ? 'jubjub' : ARM,
    ...(ownerSession && { ownerSession }),
    network,
    ...(!ownerSession && loginOptions),
    binding: async () => (await import('./acc-module.js')).accModule,
    passkey: {
      rpId: RP_ID,
      origin: ORIGIN,
      beforeCeremony: beforeDemoCeremony,
      ...(ARM === 'jubjub' && { registrationProfile: 'jubjub-prf' as const }),
    },
    prover: remoteV1Prover(SERVICE_URL, { fetch: tracedFetch }),
    sponsor,
    sponsorKeys: config,
    submitter: sponsor,
    valueCalls: { call: (request) => reviewedOwnerValueCall(SERVICE_URL, request) },
    deployer: remoteV1Deployer(SERVICE_URL, { fetch: tracedFetch }),
    directory: demoDirectory(),
    holdings: holdingPort,
    ...(!ownerSession && {
      routineViewingKey: (
        context: Parameters<
          NonNullable<
            import('@input-output-hk/mn-passport-account/ports').PassportPorts['routineViewingKey']
          >
        >[0],
      ) => {
        checkRoutineReview();
        return routineKeys.viewer(context);
      },
    }),
    readGrants,
    grants: {
      readActiveGrantSnapshot: async (account) => (await grants()).readActiveGrantSnapshot(account),
      readActiveGrantIds: async (account) => (await grants()).readActiveGrantIds(account),
    },
    grantCommitments: {
      readGrantCommitment: async (account, grantId) =>
        (await grants()).readGrantCommitment(account, grantId),
    },
    grantDetails: {
      readGrant: async (account, grantId) => (await grants()).readGrant(account, grantId),
    },
    grantRoster: { readGrantRoster: async (account) => (await grants()).readGrantRoster(account) },
    grantJournalFactory: (prf: PrfKeySource) => {
      let recovery: Promise<ReturnType<typeof createGrantBookkeepingRecovery>> | undefined;
      recoverReadKey = async (account, grantId) => {
        recovery ??= Promise.all([
          import('@input-output-hk/mn-passport-adapter-midnight-js'),
          import('./acc-module.js'),
        ]).then(([{ createMidnightChain }, { accModule }]) =>
          createGrantBookkeepingRecovery({
            networkId,
            origin: RP_ID,
            chain: createMidnightChain({
              network,
              binding: accModule,
              prover: remoteV1Prover(SERVICE_URL, { fetch: tracedFetch }),
              sponsor,
              sponsorKeys: config,
              submitter: sponsor,
            }),
            viewingKey: ownerSession
              ? recoveryKeyring(prf, ownerSession.originalReaderPrf)
              : recipeDeviceKeyring(prf),
            commitments: {
              readGrantCommitment: async (address, id) =>
                (await grants()).readGrantCommitment(address, id),
            },
            pure: accModule.pureCircuits as unknown as Parameters<
              typeof createGrantBookkeepingRecovery
            >[0]['pure'],
          }),
        );
        return (await recovery).readReadPublicKey(account, grantId);
      };
      return (journal = browserGrantJournal(networkId, prf));
    },
    records: ownerSession
      ? {
          read: async () => ownerRecord,
          write: async (record) => {
            ownerRecord = record;
          },
          exists: async () => !!ownerRecord,
        }
      : browserAccountRecords(networkId),
    random: (length) => crypto.getRandomValues(new Uint8Array(length)),
  });
}

/** Both readers belong to the same authenticated passkey; preserve old publisher seals. */
function recoveryKeyring(prf: PrfKeySource, original: PrfKeySource) {
  const current = recipeDeviceKeyring(prf),
    previous = recipeDeviceKeyring(original);
  return {
    ...current,
    async openInbox(...args: Parameters<typeof current.openInbox>) {
      const results = await Promise.allSettled([
        current.openInbox(...args),
        previous.openInbox(...args),
      ]);
      const opened = results
        .filter(
          (r): r is PromiseFulfilledResult<Awaited<ReturnType<typeof current.openInbox>>> =>
            r.status === 'fulfilled',
        )
        .map((r) => r.value);
      if (!opened.length) throw (results[0] as PromiseRejectedResult).reason;
      return Array.from(
        { length: args[2].length },
        (_, i) => opened[0]![i] ?? opened[1]?.[i] ?? null,
      );
    },
  };
}

/** What lace-sdk would inject; the harness discovers it like any dApp would. */
export function installShim(): void {
  injectPassportConnector(window as unknown as { midnight?: Record<string, unknown> }, {
    rdns: 'network.midnight.passport.prototype',
    name: 'Midnight Passport (prototype)',
    apiVersion: PASSPORT_API_VERSION,
    bindings: [BINDING_ID],
    connect: (networkId) => connect(networkId),
  });
}
