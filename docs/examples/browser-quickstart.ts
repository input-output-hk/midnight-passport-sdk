import type { AccountRecordStore, NetworkConfig } from '@input-output-hk/mn-passport-account/ports';
import { createBrowserPassport } from '@input-output-hk/mn-passport-adapter-browser';
import {
  fetchCheckedV1Config,
  remoteDirectory,
  remoteV1Deployer,
  remoteV1Prover,
  remoteV1Sponsor,
} from '@input-output-hk/mn-passport-adapter-service';
import { resolveBinding } from '@input-output-hk/mn-passport-contract';

/** Local browser host: supply a durable public account-record store before creating accounts. */
export async function connectLocalPassport(records: AccountRecordStore) {
  const service = 'http://127.0.0.1:8787';
  const bindingId = 'acc-s3r1.1';
  const pin = resolveBinding(bindingId);
  const config = await fetchCheckedV1Config(service, {
    networkId: 'undeployed',
    bindingId: bindingId,
    manifestSha256: pin.manifestSha256,
    artefactUrl: `${service}/v1/zk/${bindingId}`,
  });
  const network: NetworkConfig = {
    networkId: 'undeployed',
    bindingId: bindingId,
    manifestSha256: pin.manifestSha256,
    nodeUrl: config.nodeUri,
    indexerUrl: config.indexerUri,
    indexerWsUrl: config.indexerWsUri,
    artefactUrl: config.zkBaseUrl,
  };
  const sponsor = remoteV1Sponsor(service);
  return createBrowserPassport({
    arm: 'p256',
    network,
    binding: () => import('@input-output-hk/mn-passport-contract/bindings/acc-s3r1.1'),
    passkey: { rpId: 'localhost', origin: 'http://localhost:5173' },
    prover: remoteV1Prover(service),
    sponsor,
    sponsorKeys: config,
    submitter: sponsor,
    deployer: remoteV1Deployer(service),
    directory: remoteDirectory(service),
    records,
  });
}
