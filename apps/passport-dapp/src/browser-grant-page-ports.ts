import { PassportConnectorError } from '@input-output-hk/mn-passport-account/errors';
import { createMidnightGrantSource } from '@input-output-hk/mn-passport-adapter-midnight-js';
import {
  fetchCheckedV1Config,
  remoteDirectory,
  remoteV1Prover,
} from '@input-output-hk/mn-passport-adapter-service';
import {
  equalBytes,
  webauthnPasskey,
  type BeforePasskeyCeremony,
} from '@input-output-hk/mn-passport-adapter-webauthn';
import { pureCircuits } from '#acc';
import { accModule } from './acc-module.js';
import { grantBinding, grantNetwork } from './browser-grant-demo-config.js';
import { runDemoBrowserGrantJourney } from './browser-grant-journey.js';
import { deriveDemoGrantOpeningKey } from './browser-grant-stores.js';

type ServiceFetch = NonNullable<Parameters<typeof remoteDirectory>[1]>['fetch'];
type CheckedFetch = NonNullable<ServiceFetch>;

function privateFetch(signal: AbortSignal): CheckedFetch {
  return (input, init) => {
    const { signal: timeout, ...request } = init ?? {};
    if (timeout && !(timeout instanceof AbortSignal)) return forbidden();
    return fetch(input, {
      ...request,
      credentials: 'omit',
      mode: 'same-origin',
      redirect: 'error',
      referrerPolicy: 'no-referrer',
      cache: 'no-store',
      signal: AbortSignal.any([signal, ...(timeout ? [timeout] : [])]),
    });
  };
}

async function readNetwork(issuer: string, request: CheckedFetch) {
  const config = await fetchCheckedV1Config(
    location.origin,
    {
      networkId: grantNetwork,
      bindingId: grantBinding,
      manifestSha256: __PASSPORT_MANIFEST_SHA256__,
      artefactUrl: issuer + '/v1/zk/' + grantBinding,
    },
    { fetch: request },
  );
  return {
    config,
    network: {
      networkId: grantNetwork,
      bindingId: grantBinding,
      manifestSha256: config.manifestSha256,
      indexerUrl: config.indexerUri,
      indexerWsUrl: config.indexerWsUri,
      nodeUrl: config.nodeUri,
      artefactUrl: config.zkBaseUrl,
    },
  };
}

export async function holderPorts(issuer: string, signal: AbortSignal) {
  const { network } = await readNetwork(issuer, privateFetch(signal));
  return {
    networkId: grantNetwork,
    pure: pureCircuits,
    source: createMidnightGrantSource({
      network,
      binding: accModule,
      openings: { readReadPublicKey: async () => undefined },
    }),
  };
}

type Journey = Parameters<typeof runDemoBrowserGrantJourney>[1];

interface IssuerPageOperation {
  readonly issuer: string;
  readonly account: string;
  readonly fragment: string;
  readonly beforeCeremony: BeforePasskeyCeremony;
  readonly review: Journey['review'];
  readonly signal: AbortSignal;
  readonly checkCurrent: () => void;
}

function forbidden(): never {
  throw new PassportConnectorError('NotAuthorised', 'Only the original grant relay is enabled.');
}

export async function runIssuerPageOperation(
  action: 'issue' | 'recover',
  input: IssuerPageOperation,
) {
  const { issuer, account, signal, beforeCeremony, checkCurrent } = input;
  if (issuer !== location.origin) return forbidden();
  const request = privateFetch(signal);
  const { config, network } = await readNetwork(issuer, request);
  checkCurrent();
  const keys = webauthnPasskey({ origin: issuer, rpId: location.hostname, beforeCeremony });
  if (!keys.credentials.withLoginSession) return forbidden();
  return keys.credentials.withLoginSession(async () => {
    const selected = await keys.credentials.identify();
    checkCurrent();
    const owner = await remoteDirectory(issuer, { fetch: request }).get(grantNetwork, {
      kind: 'credential-id',
      credentialId: selected.credentialId,
    });
    if (
      owner?.address !== account ||
      owner.status !== 'active' ||
      owner.scheme !== 'p256-webauthn' ||
      !owner.policy ||
      !owner.credentialId ||
      !equalBytes(owner.credentialId, selected.credentialId) ||
      !selected.owns(owner.publicKey, owner.policy)
    )
      return forbidden();
    const openingKey = await deriveDemoGrantOpeningKey(keys.prf, grantNetwork, account);
    checkCurrent();
    return runDemoBrowserGrantJourney(action, {
      ...input,
      owner,
      credential: {
        credentialId: owner.credentialId,
        policy: owner.policy,
        publicKey: { ...owner.publicKey, identity: false },
      },
      indexedDB,
      openingKey,
      authoriser: keys.p256,
      chain: {
        network,
        binding: accModule,
        prover: remoteV1Prover(issuer, { fetch: request, timeoutMs: 120_000 }),
        sponsor: { balanceAndSign: forbidden },
        submitter: { submit: forbidden },
        sponsorKeys: config,
      },
    });
  });
}
