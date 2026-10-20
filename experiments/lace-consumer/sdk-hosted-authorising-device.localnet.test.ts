// @ts-nocheck
// Local-key-origin SDK creation followed by unmodified Lace hosted sign-in. No hosted create claim.
import { strict as assert } from 'node:assert';
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { firstValueFrom } from 'rxjs';
import { it } from 'vitest';
import { AccAddress, DeviceEpoch, UseCounter } from '@lace-contract/passport';
import { createPasskeySessionKeySource, createSignerClient, serveSignerRequests } from '@lace-lib/passkey';
import { createPassportSignerHandlers } from '../../src/remote/signer-handlers';
import { createRemotePassportAuthoriser } from '../../src/remote/remote-authoriser';
import { createRemoteEncryptionKey } from '../../src/remote/remote-encryption-key';
import { createRemoteAccountRecordStore } from '../../src/remote/remote-account-records';
import { toAccountRecords } from '../../src/store/account-record';
import { createPasskeyAuthoriser } from '../../src/ceremony/passkey';
import { createPasskeyEncryptionKey } from '../../src/ceremony/encryption-key';
import { signIn } from '../../src/flows/sign-in';
import { createInMemoryStorage } from './fake-passkey';
import { createWindowPair, SIGNER_URL } from './fake-windows';
import { createPassportAccounts, addJubjubAuthorisingDevice } from '@input-output-hk/mn-passport-account';
import { hostedJubjubAuthoriser } from '@input-output-hk/mn-passport-adapter-browser/hosted-jubjub';
import { createMidnightChain, createMidnightGrantSource } from '@input-output-hk/mn-passport-adapter-midnight-js';
import {
  fetchCheckedV1Config,
  remoteDirectory,
  remoteV1Deployer,
  remoteV1Prover,
  remoteV1Sponsor,
} from '@input-output-hk/mn-passport-adapter-service';
import { resolveBinding } from '@input-output-hk/mn-passport-contract';
import { Contract, ledger, pureCircuits } from '@input-output-hk/mn-passport-contract/bindings/acc-s3r1.1';
import {
  deriveSymmetricSecret,
  PRF_LABEL_AUTHORISER,
  PRF_LABEL_ROOT,
  prfSalt,
  recipeDeviceKeyring,
  recipeEncryptionKey,
  recipeJubjubAuthoriser,
  seedFromRoot,
} from '@input-output-hk/mn-passport-keys';

const unsupported = async () => { throw new Error('Cardano signer kind is unavailable'); };
const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString('hex');
const noHeldCoins = {
  async selectHeldEntries(_account, _entries, opened) {
    if (opened.some((entry) => entry?.kind === 'coin'))
      throw new Error('unexpected coin in empty localnet ACC');
    return [];
  },
};

it('recognises a packed SDK ACC through unmodified Lace hosted sign-in', async () => {
  if (process.env.PASSPORT_LACE_HOSTED_E2E !== '1') return;
  const contractDir = process.env.PASSPORT_CONTRACT_DIR;
  if (!contractDir) throw new Error('set PASSPORT_CONTRACT_DIR');
  const pin = resolveBinding('acc-s3r1.1');
  assert.equal(
    createHash('sha256').update(readFileSync(join(contractDir, 'contracts/managed/account/compiler/contract-manifest.json'))).digest('hex'),
    pin.manifestSha256,
  );
  const service = process.env.PASSPORT_SERVICE_URL ?? 'http://localhost:8787';
  const config = await fetchCheckedV1Config(service, {
    networkId: 'undeployed',
    bindingId: 'acc-s3r1.1',
    manifestSha256: pin.manifestSha256,
    artefactUrl: service + '/v1/zk/acc-s3r1.1',
  });
  const network = {
    networkId: 'undeployed',
    bindingId: 'acc-s3r1.1',
    manifestSha256: pin.manifestSha256,
    indexerUrl: config.indexerUri,
    indexerWsUrl: config.indexerWsUri,
    nodeUrl: config.nodeUri,
    artefactUrl: config.zkBaseUrl,
  };
  const binding = { Contract, ledger, pureCircuits };
  const sponsor = remoteV1Sponsor(service);
  const transactions: Array<{ circuit: string; txHash: string }> = [];
  const chain = createMidnightChain({
    network, binding, prover: remoteV1Prover(service), sponsor,
    sponsorKeys: config, submitter: sponsor,
  });
  const observedChain = {
    readAccount: (...args) => chain.readAccount(...args),
    async call(request) {
      const result = await chain.call(request);
      transactions.push({ circuit: request.circuit, txHash: result.txHash });
      console.log('hosted SDK call', request.circuit, result.txHash);
      return result;
    },
  };
  const grants = createMidnightGrantSource({
    network, binding, openings: { readReadPublicKey: async () => undefined },
  });
  const pair = createWindowPair();
  const credentialId = new Uint8Array(randomBytes(16));
  const deviceOutput = new Uint8Array(randomBytes(32));
  const rootOutput = new Uint8Array(randomBytes(32));
  const signer = {
    keySource: createPasskeySessionKeySource({
      rpId: 'localhost',
      credentials: {
        get: async () => ({
          rawId: credentialId.buffer,
          getClientExtensionResults: () => ({
            prf: { results: { first: deviceOutput.slice(), second: rootOutput.slice() } },
          }),
        }),
      },
    }),
  };
  const credentials = {
    create: async () => ({ credentialId }),
    identify: async () => ({ credentialId, owns: () => true }),
  };
  const storage = createInMemoryStorage();
  const handlers = {
    ...createPassportSignerHandlers({
      keySource: signer.keySource,
      createKeyValueStorage: storage.createKeyValueStorage,
      sessionTimeoutMs: 25 * 60 * 1000,
    }),
    'sign-cardano-tx': unsupported,
    'sign-cardano-data': unsupported,
    'cardano-account-public-key': unsupported,
    'cardano-custody-public-key': unsupported,
    'sign-cardano-custody-tx': unsupported,
    'sign-cardano-custody-data': unsupported,
  };
  const client = createSignerClient({ signerUrl: SIGNER_URL, host: pair.dappHost });
  client.open();
  const consentKinds: string[] = [];
  const stop = serveSignerRequests({
    handlers,
    assertOriginAllowed: () => undefined,
    onRequest: async (request) => {
      consentKinds.push(request.kind);
      return 'approve';
    },
    host: pair.signerHost,
  });
  try {
    await client.connect();
    const laceAuthoriser = createRemotePassportAuthoriser(client);
    const viewingKey = createRemoteEncryptionKey(client);
    const authoriser = hostedJubjubAuthoriser(createPasskeyAuthoriser({ keySource: signer.keySource }), {
      account: AccAddress, epoch: DeviceEpoch, counter: UseCounter, flow: descriptor => descriptor,
    });
    const localViewingKey = createPasskeyEncryptionKey(signer.keySource);
    let record;
    const ports = {
      network, binding, chain: observedChain,
      deployer: remoteV1Deployer(service),
      directory: remoteDirectory(service),
      credentials, authoriser,
      encryptionKey: viewingKey,
      viewingKey: localViewingKey, holdings: noHeldCoins,
      readGrants: grants,
      records: {
        read: async () => record,
        write: async (value) => { record = value; },
        exists: async () => record !== undefined,
      },
      random: (length) => new Uint8Array(randomBytes(length)),
    };
    const account = await createPassportAccounts(ports).createAccount({
      userName: 'lace-hosted-sdk-localnet', retireAuthority: true,
    });
    console.log('hosted SDK ACC created', account.address);
    assert.equal((await account.state()).entryCount, 1);
    const laceRecords = createRemoteAccountRecordStore(client);
    await laceAuthoriser.withKeySession(
      async () => firstValueFrom(laceRecords.write({
        address: account.address,
        bindingVersion: '0.1.0-lace.2',
        localUseCounter: '0',
      })),
      { kind: 'create-account', lockAccount: true },
    );
    const recognised = await signIn({
      seams: {
        passportAuthoriser: laceAuthoriser,
        passportEncryptionKey: viewingKey,
        passportNetwork: network,
      },
      accountRecords: toAccountRecords(laceRecords),
      rpId: 'localhost',
    });
    assert.equal(recognised.account.address, account.address);
    console.log('Lace sign-in recognised SDK ACC', recognised.account.address);

    const reopened = await createPassportAccounts(ports).openAccount();
    assert.equal(reopened.address, account.address);
    console.log('SDK reopened ACC using unmodified Lace local key-origin ports', reopened.address);
    const hostedAuthoriser = hostedJubjubAuthoriser(laceAuthoriser, {
      account: AccAddress, epoch: DeviceEpoch, counter: UseCounter, flow: descriptor => descriptor,
    });
    const joining = recipeJubjubAuthoriser({
      withSession: operation => operation(),
      deviceSecret: async () => new Uint8Array(32).fill(71),
      deriveSecret: async () => new Uint8Array(32).fill(72),
    }, pureCircuits);
    const ownerPublicKey = await authoriser.devicePublicKey();
    record = { address: account.address, bindingId: network.bindingId, scheme: 'jubjub-schnorr', credentialId, localUseCounter: BigInt(recognised.localUseCounter) };
    const added = await addJubjubAuthorisingDevice({
      hint: { address: account.address, scheme: 'jubjub-schnorr', credentialId, publicKey: ownerPublicKey, status: 'active' },
      joiningPublicKey: await joining.devicePublicKey(),
    }, { bindingId: network.bindingId, pure: pureCircuits, chain: observedChain, authoriser: hostedAuthoriser, records: ports.records });
    const settled = await observedChain.readAccount(account.address, { includeDevices: true });
    assert.equal(settled.entryCount, 2);
    assert.ok(settled.hasEntry(Buffer.from(added.commitmentHex, 'hex')));
    assert.equal(settled.authNonce, added.nextUseCounter);
    const signedInAgain = await signIn({ seams: { passportAuthoriser: laceAuthoriser, passportEncryptionKey: viewingKey, passportNetwork: network }, accountRecords: toAccountRecords(laceRecords), rpId: 'localhost' });
    assert.equal(signedInAgain.devices.length, 2);
    assert.equal(signedInAgain.localUseCounter, added.nextUseCounter.toString());
    console.log('HOSTED_AUTHORISING_DEVICE_PASS', JSON.stringify({ account: account.address, commitmentHex: added.commitmentHex, txHash: added.txHash, nextUseCounter: added.nextUseCounter.toString(), viewingKeyDelivered: false }));
    const receipt = {
      laceHead: process.env.LACE_SOURCE_REVISION,
      sdkVersion: process.env.RELEASE_VERSION,
      bindingId: network.bindingId,
      manifestSha256: network.manifestSha256,
      networkId: network.networkId,
      account: account.address,
      transactions,
      consentKinds,
      scope: 'SDK create with Lace local key ports, then Lace hosted sign-in; hosted authorising-only device addition; no sealed reader enrollment or hosted creation claim',
    };
    if (process.env.LIVE_CONSUMER_RECEIPT_FILE) writeFileSync(process.env.LIVE_CONSUMER_RECEIPT_FILE, JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    console.log('LACE_CROSS_SIGNIN_PASS', JSON.stringify(receipt));
  } finally {
    stop();
    client.close();
  }
}, 1_800_000);
