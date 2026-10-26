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
import { createAccount as laceCreateAccount } from '../../src/flows/create-account';
import { createHttpProver } from '../../src/infra/http-prover';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { signIn } from '../../src/flows/sign-in';
import { createInMemoryStorage } from './fake-passkey';
import { createWindowPair, SIGNER_URL } from './fake-windows';
import { createPassportAccounts } from '@input-output-hk/mn-passport-account';
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

it('opens a Lace-created ACC through packed SDK address recovery', async () => {
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
    artefactUrl: process.env.PASSPORT_LACE_ARTEFACT_URL ?? config.zkBaseUrl,
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
    const sdkRoot = process.env.PASSPORT_SDK_ROOT;
    if (!sdkRoot) throw new Error('PASSPORT_SDK_ROOT required for localnet sponsor worker');
    const worker = spawn(process.execPath, ['--import', join(contractDir, 'node_modules/tsx/dist/loader.mjs'), join(sdkRoot, 'experiments/lace-consumer/localnet-sponsor-worker.mjs')], { env: process.env, stdio: ['pipe', 'pipe', 'inherit'] });
    let seq = 0;
    const pending = new Map();
    let readyResolve, readyReject;
    const ready = new Promise((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
    worker.on('exit', code => { const error = new Error('sponsor worker exited: ' + code); readyReject(error); for (const wait of pending.values()) wait.reject(error); });
    const lines = createInterface({ input: worker.stdout });
    lines.on('line', line => {
      if (!line.startsWith('PASSPORT_RPC ')) { console.log('localnet wallet:', line); return; }
      const answer = JSON.parse(line.slice('PASSPORT_RPC '.length));
      if (answer.ready) { readyResolve(); return; }
      const wait = pending.get(answer.id); pending.delete(answer.id);
      if (answer.error) wait.reject(new Error(answer.error)); else wait.resolve(Buffer.from(answer.tx, 'hex'));
    });
    try {
      await ready;
      const localSponsor = { balanceAndSign: bytes => new Promise((resolve, reject) => { const id = ++seq; pending.set(id, { resolve, reject }); worker.stdin.write(JSON.stringify({ id, method: 'balance', tx: hex(bytes) }) + '\n'); }) };
      const laceRecords = createRemoteAccountRecordStore(client);
      const created = await laceCreateAccount({ lockAccount: true }, {
        seams: { passportAuthoriser: laceAuthoriser, passportEncryptionKey: viewingKey, passportNetwork: network,
          passportSponsor: localSponsor, passportProver: createHttpProver('http://127.0.0.1:16300', { artefactUrl: network.artefactUrl }) },
        accountRecords: toAccountRecords(laceRecords), rpId: 'localhost', onProgress: stage => console.log('Lace create stage', stage),
      });
      console.log('LACE_NATIVE_CREATED', JSON.stringify(created));
      // No directory hint from SDK creation exists. Recover by address through the local key
      // origin, which can validate registrations (the hosted sign-in scope intentionally hides them).
      const account = await createPassportAccounts(ports).openAccountAt(created.account.address);
      assert.equal(account.address, created.account.address);
      assert.equal((await account.state()).entryCount, 1);
      const receipt = { account: account.address, laceHead: process.env.LACE_SOURCE_REVISION, sdkVersion: process.env.RELEASE_VERSION, bindingId: network.bindingId, manifestSha256: network.manifestSha256, networkId: network.networkId, consentKinds };
    if (process.env.LIVE_CONSUMER_RECEIPT_FILE) writeFileSync(process.env.LIVE_CONSUMER_RECEIPT_FILE, JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    console.log('LACE_CREATED_SDK_OPEN_PASS', JSON.stringify(receipt));
    } finally { worker.stdin.end(); lines.close(); worker.kill('SIGTERM'); }
  } finally {
    stop();
    client.close();
  }
}, 1_800_000);
