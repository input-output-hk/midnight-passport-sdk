// End-to-end MVP on the localnet: create -> rotate #1 -> reopen -> rotate #2.
//
// It drives the account API v1 in Node over three seams: a software P-256 passkey, the
// service-backed chain, and the HTTP registry client against a running apps/passport-service.
// Every progress event is kept, and every step that starts must end.
// Run it through `pnpm prototype:e2e` (see the task report for the environment it needs), which
// first syncs the generated module into src/acc/generated, where it shares midnight-js's
// compact-runtime (scripts/sync-acc.mjs explains why).
import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createPassportAccounts,
  createRegistryClient,
  portsFromSeams,
  type ChainSeam,
  type PassportSeams,
} from '@midnight-ntwrk/mn-passport-account';
import type { PassportEvent } from '@midnight-ntwrk/mn-passport-protocol';
import {
  accEncryptionKey,
  createServiceChain,
  defaultFetch,
  fetchServiceConfig,
  PRF_LABEL_ROOT,
  prfSalt,
  seedFromRoot,
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

if (!process.env.PASSPORT_CONTRACT_DIR)
  fail('PASSPORT_CONTRACT_DIR is not set (the directory holding contracts/managed).');
// R18: the app pins the manifest hash itself; it is never read back from the service's /config.
const pin = process.env.PASSPORT_MANIFEST_SHA256 ?? '';
if (!/^[0-9a-fA-F]{64}$/.test(pin)) {
  fail('PASSPORT_MANIFEST_SHA256 must be set to the 64 hex characters of the manifest SHA-256.');
}

const accModule: GeneratedAccModule = await import('#acc');
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
// The service's `/deploy` names them `txHashes`, but they are submission ids (Final review M4).
let deploySubmissionIds: readonly string[] = [];
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
    deploySubmissionIds = result.txHashes;
    return result;
  },
  async call(address, circuit, args, options) {
    const result = await serviceChain.call(address, circuit, args, options);
    transactions.push({ circuit, ...result });
    return result;
  },
};

const passkey = softwarePasskey('localhost', 'http://localhost:5173');
/** The account's enc_key as the dapp derives it (Lace recipe v1), from the software passkey's PRF. */
const encryptionKey = (): Uint8Array => {
  const root = passkey.prf(prfSalt(PRF_LABEL_ROOT));
  const seed = seedFromRoot(root);
  try {
    return accEncryptionKey(seed, NETWORK_ID);
  } finally {
    root.fill(0);
    seed.fill(0);
  }
};
const seams: PassportSeams = {
  networkId: NETWORK_ID,
  bindingId: config.bindingId,
  pureCircuits: accModule.pureCircuits,
  passkey,
  chain,
  registry: createRegistryClient(SERVICE, defaultFetch),
  random: (n) => new Uint8Array(randomBytes(n)),
  encryptionKey,
};

const events: PassportEvent[] = [];
const onEvent = (event: PassportEvent): void => {
  events.push(event);
  if (event.phase !== 'start')
    console.log(`  ${event.phase} ${event.step}`, event.durationMs, 'ms');
};
const connector = createPassportAccounts(portsFromSeams(seams));
const started = Date.now();
last = started;

const account = await connector.createAccount({ userName: 'e2e', retireAuthority: true, onEvent });
const created = await account.state();
if (!created.booted) fail('the account is not booted after createAccount');
step('created', { address: account.address, state: created });

// Rotation targets stay random: Lace has no rotation recipe yet (a prototype extension).
const r1 = await account.rotateEncryptionKey(new Uint8Array(randomBytes(32)), { onEvent });
step('rotate #1 (passkey-signed, k = 18)', { ...r1, state: await account.state() });

const reopened = await createPassportAccounts(portsFromSeams(seams)).openAccount({ onEvent });
if (reopened.address !== account.address) fail('reopen returned a different account');
step('reopened after "reload"', { address: reopened.address });

const r2 = await reopened.rotateEncryptionKey(new Uint8Array(randomBytes(32)), { onEvent });
step('rotate #2 after reopen (rescanned counter)', { ...r2, state: await reopened.state() });

// Design §3.4: every start has exactly one end with the same id, in the same flow.
for (const start of events.filter((e) => e.phase === 'start')) {
  const ends = events.filter(
    (e) => e.flowId === start.flowId && e.id === start.id && e.phase !== 'start',
  );
  if (ends.length !== 1 || ends[0]?.phase !== 'end') {
    fail(`the ${start.step} step (${start.id}) did not end exactly once`);
  }
}
for (const s of [
  'deploy',
  'activate',
  'passkey.sign',
  'prove',
  'sponsor.submit',
  'chain.finality',
]) {
  if (!events.some((e) => e.step === s)) fail(`no ${s} event was reported`);
}

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
  deploySubmissionIds,
  transactions,
  steps,
  events,
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
