// End-to-end MVP on the localnet: create -> rotate #1 -> reopen -> rotate #2.
//
// It drives the real connector in Node with three seams: a software P-256 passkey, the
// service-backed chain, and the HTTP registry client against a running apps/passport-service.
// Run it through `pnpm prototype:e2e` (see the task report for the environment it needs), which
// loads e2e/dedupe-runtime.mjs so the generated module and midnight-js share one compact-runtime.
import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  createPassportConnector,
  createRegistryClient,
  type ChainSeam,
  type PassportSeams,
} from '@midnight-ntwrk/mn-passport-account';
import {
  createServiceChain,
  defaultFetch,
  fetchServiceConfig,
  type GeneratedAccModule,
} from '@midnight-ntwrk/mn-passport-adapter-browser';
import { assertSingleCompactRuntime } from './runtime-preflight.ts';
import { softwarePasskey } from './software-passkey.ts';

const SERVICE = process.env.PASSPORT_SERVICE_URL ?? 'http://localhost:8787';
const NETWORK_ID = process.env.PASSPORT_NETWORK_ID ?? 'undeployed';
const EVIDENCE = fileURLToPath(
  new URL('../../../experiments/acc-0.35/results/x8-dapp-e2e.json', import.meta.url),
);

const fail = (message: string): never => {
  console.error(`MVP e2e: ${message}`);
  process.exit(1);
};

const contractDir = process.env.PASSPORT_CONTRACT_DIR;
if (!contractDir)
  fail('PASSPORT_CONTRACT_DIR is not set (the directory holding contracts/managed).');
// R18: the app pins the manifest hash itself; it is never read back from the service's /config.
const pin = process.env.PASSPORT_MANIFEST_SHA256 ?? '';
if (!/^[0-9a-fA-F]{64}$/.test(pin)) {
  fail('PASSPORT_MANIFEST_SHA256 must be set to the 64 hex characters of the manifest SHA-256.');
}

const accModule = (await import(
  pathToFileURL(`${contractDir}/contracts/managed/account/contract/index.js`).href
)) as GeneratedAccModule;
// Fails in milliseconds, before any deploy, when two compact-runtime copies are loaded (C1).
try {
  assertSingleCompactRuntime(accModule);
} catch (e) {
  fail(e instanceof Error ? e.message : String(e));
}
const config = await fetchServiceConfig(SERVICE, defaultFetch, NETWORK_ID);

interface Step {
  readonly name: string;
  readonly at: string;
  readonly ms: number;
  readonly [key: string]: unknown;
}
const steps: Step[] = [];
const transactions: {
  readonly circuit: string;
  readonly txHash: string;
  readonly blockHeight?: number;
}[] = [];
let deployTxHashes: readonly string[] = [];
let last = Date.now();
const step = (name: string, data: Record<string, unknown> = {}): void => {
  const now = Date.now();
  steps.push({ name, at: new Date(now).toISOString(), ms: now - last, ...data });
  last = now;
  console.log(`  ok ${name}`, data);
};

// Records what the chain seam reports, so the evidence names the transactions without the
// connector needing to expose them.
const serviceChain = createServiceChain({
  serviceUrl: SERVICE,
  config,
  expectedManifestSha256: pin,
  module: accModule,
});
const chain: ChainSeam = {
  readLedger: (address) => serviceChain.readLedger(address),
  async deploy(args) {
    const result = await serviceChain.deploy(args);
    deployTxHashes = result.txHashes;
    return result;
  },
  async call(address, circuit, args) {
    const result = await serviceChain.call(address, circuit, args);
    transactions.push({ circuit, ...result });
    return result;
  },
};

const seams: PassportSeams = {
  networkId: NETWORK_ID,
  bindingId: config.bindingId,
  pureCircuits: accModule.pureCircuits,
  passkey: softwarePasskey('localhost', 'http://localhost:5173'),
  chain,
  registry: createRegistryClient(SERVICE, defaultFetch),
  random: (n) => new Uint8Array(randomBytes(n)),
  encryptionKey: () => new Uint8Array(randomBytes(32)),
};

const connector = createPassportConnector(seams);
const started = Date.now();
last = started;

const account = await connector.createAccount({
  userName: 'e2e',
  onProgress: (stage) => step(`create:${stage}`),
});
const created = await account.state();
if (!created.booted) fail('the account is not booted after createAccount');
step('created', { address: account.address, state: created });

const r1 = await account.rotateEncryptionKey(new Uint8Array(randomBytes(32)));
step('rotate #1 (passkey-signed, k = 18)', { ...r1, state: await account.state() });

const reopened = await createPassportConnector(seams).openAccount();
if (reopened.address !== account.address) fail('reopen returned a different account');
step('reopened after "reload"', { address: reopened.address });

const r2 = await reopened.rotateEncryptionKey(new Uint8Array(randomBytes(32)));
step('rotate #2 after reopen (rescanned counter)', { ...r2, state: await reopened.state() });

const seconds = Math.round((Date.now() - started) / 1000);
const compactRuntime = (
  JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
    dependencies: Record<string, string>;
  }
).dependencies['@midnight-ntwrk/compact-runtime'];

// No secrets: neither the passkey's private key nor the sponsor seed ever reaches this object.
const evidence = {
  verdict: 'PASS',
  network: NETWORK_ID,
  service: SERVICE,
  binding: config.bindingId,
  manifestSha256: config.manifestSha256,
  address: account.address,
  deployTxHashes,
  transactions,
  steps,
  seconds,
  versions: {
    node: process.version,
    connectorApi: connector.apiVersion,
    compactRuntime,
  },
};
mkdirSync(dirname(EVIDENCE), { recursive: true });
writeFileSync(
  EVIDENCE,
  JSON.stringify(evidence, (_k, v: unknown) => (typeof v === 'bigint' ? v.toString() : v), 2) +
    '\n',
);
console.log(`MVP e2e: PASS in ${seconds} s (evidence: ${EVIDENCE})`);
