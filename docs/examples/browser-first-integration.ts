import type { AccountRecord, AccountRecordStore, NetworkConfig } from '@input-output-hk/mn-passport-account/ports';
import { createBrowserPassport } from '@input-output-hk/mn-passport-adapter-browser';
import {
  fetchCheckedV1Config,
  remoteDirectory,
  remoteV1Deployer,
  remoteV1Prover,
  remoteV1Sponsor,
} from '@input-output-hk/mn-passport-adapter-service';
import { resolveBinding } from '@input-output-hk/mn-passport-contract';
import type { PassportEvent } from '@input-output-hk/mn-passport-protocol';

const service = 'http://127.0.0.1:8787';
const bindingId = 'acc-s3r1.1';
const networkId = 'undeployed';
const hex32 = /^[0-9a-f]{64}$/;
type CeremonyReview = NonNullable<Parameters<typeof createBrowserPassport>[0]['passkey']['beforeCeremony']>;

/** Public metadata only. Use a durable store appropriate to your host before account creation. */
export function browserRecords(storage: Storage): AccountRecordStore {
  const key = `mn-passport:account-record:v1:${networkId}:${bindingId}`;
  const read: AccountRecordStore['read'] = async () => {
    const raw = storage.getItem(key);
    if (!raw) return undefined;
    const entry: unknown = JSON.parse(raw);
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new Error('Invalid account record');
    const value = entry as Record<string, unknown>;
    if (
      typeof value.address !== 'string' || !hex32.test(value.address) ||
      value.bindingId !== bindingId || value.scheme !== 'p256-webauthn' ||
      typeof value.localUseCounter !== 'string' || !/^\d+$/.test(value.localUseCounter) ||
      typeof value.credentialId !== 'string' || !/^(?:[0-9a-f]{2})+$/.test(value.credentialId)
    ) throw new Error('Invalid account record');
    const credentialId = new Uint8Array(value.credentialId.match(/../g)!.map(byte => Number.parseInt(byte, 16)));
    return {
      address: value.address,
      bindingId,
      scheme: 'p256-webauthn',
      localUseCounter: BigInt(value.localUseCounter),
      credentialId,
    } satisfies AccountRecord;
  };
  return {
    read,
    exists: async () => (await read()) !== undefined,
    async write(record) {
      if (!hex32.test(record.address) || record.bindingId !== bindingId || record.scheme !== 'p256-webauthn' || !record.credentialId)
        throw new Error('Invalid account record');
      storage.setItem(key, JSON.stringify({
        address: record.address,
        bindingId: record.bindingId,
        scheme: record.scheme,
        localUseCounter: record.localUseCounter.toString(),
        credentialId: Array.from(record.credentialId, byte => byte.toString(16).padStart(2, '0')).join(''),
      }));
    },
  };
}

/** Construct once. Construction alone does not request a passkey or deploy an ACC. */
export async function connect(records: AccountRecordStore, beforeCeremony: CeremonyReview) {
  const pin = resolveBinding(bindingId);
  const config = await fetchCheckedV1Config(service, {
    networkId, bindingId, manifestSha256: pin.manifestSha256,
    artefactUrl: `${service}/v1/zk/${bindingId}`,
  });
  const network: NetworkConfig = {
    networkId, bindingId, manifestSha256: pin.manifestSha256,
    nodeUrl: config.nodeUri,
    indexerUrl: config.indexerUri,
    indexerWsUrl: config.indexerWsUri,
    artefactUrl: config.zkBaseUrl,
  };
  const sponsor = remoteV1Sponsor(service);
  return createBrowserPassport({
    arm: 'p256', network,
    binding: () => import('@input-output-hk/mn-passport-contract/bindings/acc-s3r1.1'),
    passkey: { rpId: 'localhost', origin: 'http://localhost:5173', beforeCeremony },
    prover: remoteV1Prover(service), sponsor, sponsorKeys: config, submitter: sponsor,
    deployer: remoteV1Deployer(service), directory: remoteDirectory(service), records,
  });
}

/** Call from explicit reviewed UI actions, never on page load. */
export async function accountActions(
  storage: Storage,
  onEvent: (event: PassportEvent) => void,
  beforeCeremony: CeremonyReview,
) {
  const passport = await connect(browserRecords(storage), beforeCeremony);
  return {
    create(userName: string, retireAuthority: boolean, signal: AbortSignal) {
      return passport.createAccount({ userName, retireAuthority, signal, onEvent });
    },
    open(signal: AbortSignal) {
      return passport.openAccount({ signal, onEvent });
    },
  };
}
