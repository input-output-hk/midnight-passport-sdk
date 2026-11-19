// Opt-in local registration host. The browser owns the naming witness and proof;
// this process owns a separate funded sponsor wallet and one durable claim journal.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  createMidnamesIndexer,
  createMidnamesLedgerReads,
} from '../../apps/passport-dapp/src/midnames/ledger-reader.ts';
import { claimDestination } from '../../apps/passport-dapp/src/midnames/claim-quote.ts';
import { readClaimFinality } from '../../apps/passport-dapp/src/midnames/claim-finality.ts';
import { createClaimSponsorHandler } from './claim-sponsor-http.mts';
import { startDemoOwnerBundle } from './claim-owner-browser-host.mjs';
import { verifyPreparedRegistry } from './verify-prepared.mjs';

const networkId = 'undeployed';
const indexerUrl = 'http://127.0.0.1:8088/api/v4/graphql';
const indexerWsUrl = 'ws://127.0.0.1:8088/api/v4/graphql/ws';
const nodeUrl = 'http://127.0.0.1:9944';
const proverUrl = 'http://127.0.0.1:16320';
const origin = 'http://localhost:5173';
const claimProtocolVersion = Number(process.env.VITE_MIDNAMES_CLAIM_PROTOCOL_VERSION);
assert.equal(claimProtocolVersion, 2001100, 'Pin the shared Ledger 9 claim protocol.');
const maximumDust = 100_000_000_000_000_000n;
const address = /^[0-9a-f]{64}$/;
const safeRefusals = new Set([
  'Invalid claim quote.',
  'The requested name is already registered.',
  'Claim target is not an activated Passport ACC.',
  'The dedicated claim sponsor needs NIGHT and two DUST inputs.',
  'The live registry or sponsor terms differ from the reviewed quote.',
  'The sponsor has an unresolved original claim.',
]);
const appPackage = pathToFileURL(
  new URL('../../apps/passport-dapp/package.json', import.meta.url).pathname,
).href;
const appImport = (name) => import(import.meta.resolve(name, appPackage));
const hex = (value) => (typeof value === 'string' ? value : Buffer.from(value).toString('hex'));

function privateDirectory(path) {
  assert.ok(isAbsolute(path) && resolve(path) === path);
  if (!existsSync(path)) mkdirSync(path, { recursive: true, mode: 0o700 });
  const stat = lstatSync(path);
  assert.ok(stat.isDirectory() && !stat.isSymbolicLink());
  assert.equal(realpathSync(path), path);
  assert.equal(stat.mode & 0o077, 0);
  assert.equal(stat.uid, process.getuid());
}

function privateSeed(path) {
  assert.ok(isAbsolute(path) && resolve(path) === path);
  const stat = lstatSync(path);
  assert.ok(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1);
  assert.equal(stat.mode & 0o077, 0);
  assert.equal(stat.uid, process.getuid());
  const seed = readFileSync(path, 'utf8').trim();
  assert.match(seed, address);
  assert.notEqual(seed, '0'.repeat(63) + '1', 'Use a separately funded sponsor wallet.');
  return seed;
}

const [prepared, reference, registryAddress, seedPath, journalDir, rawPort, rawOwnerPort] =
  process.argv.slice(2);
assert.ok(process.env.IN_NIX_SHELL && process.env.COMPACT_DIRECTORY, 'Use the pinned Nix shell.');
assert.ok([prepared, reference, seedPath, journalDir].every((path) => path && isAbsolute(path)));
assert.match(registryAddress ?? '', address);
const port = Number(rawPort);
assert.ok(Number.isInteger(port) && port > 0 && port < 65536 && port !== 5173);
const ownerPort = Number(rawOwnerPort);
assert.ok(
  Number.isInteger(ownerPort) &&
    ownerPort > 0 &&
    ownerPort < 65536 &&
    ownerPort !== port &&
    ownerPort !== 5173,
);
privateDirectory(journalDir);
await verifyPreparedRegistry(prepared);
const seed = privateSeed(seedPath);
const walletModule = await import(pathToFileURL(join(reference, 'src/node/wallet.ts')).href);
assert.deepEqual(walletModule.CONFIG, {
  networkId,
  indexer: indexerUrl,
  indexerWS: indexerWsUrl,
  node: nodeUrl,
  proofServer: proverUrl,
});
const get = (name) =>
  import(import.meta.resolve(name, pathToFileURL(join(reference, 'package.json')).href));
const [{ Transaction }, { getContractLedger }, { firstValueFrom }] = await Promise.all([
  get('@midnightntwrk/ledger-v9'),
  appImport('@midnames/sdk/core'),
  get('rxjs'),
]);
const wallet = await walletModule.createWallet(seed);
let owner;
let server;
try {
  await walletModule.syncWallet(wallet, 'local Midnames claim sponsor');
  const providers = await walletModule.createProviders(wallet);
  const sponsorPaymentAddress = hex(walletModule.userAddressBytes(wallet));
  // The registry stores this as the domain owner and future subdomain payee.
  // Use an address actually controlled by the dedicated local sponsor wallet.
  const domainOwnerAddress = sponsorPaymentAddress;
  const walletKeys = {
    coin: hex(await providers.walletProvider.getCoinPublicKey()),
    encryption: hex(await providers.walletProvider.getEncryptionPublicKey()),
  };
  const reader = createMidnamesLedgerReads(
    createMidnamesIndexer(networkId, indexerUrl, indexerWsUrl),
    networkId,
    'acc-s3r1.1',
    'standalone-0.35',
  );
  const profile = { networkId, registryAddress, namespace: 'night' };
  async function live(destination) {
    const selected = claimDestination(destination);
    if (selected.registryAddress !== registryAddress)
      throw new Error('Claim registry differs from the local demo pin.');
    if (!(await reader.isSupportedAccount(selected.accountAddress, networkId)))
      throw new Error('Claim target is not an activated Passport ACC.');
    if (await reader.hasDomain(selected.name, profile))
      throw new Error('The requested name is already registered.');
    const observed = await getContractLedger(
      createMidnamesIndexer(networkId, indexerUrl, indexerWsUrl),
      registryAddress,
    );
    if (!observed.success) throw new Error('The pinned registry is absent.');
    const root = observed.data;
    if (root.TLD !== 'night') throw new Error('Registry namespace changed.');
    const parent = root.id_to_data.lookup(root.ROOT_ZONE_ID);
    const price = parent.payment_config;
    const labelLength = selected.name.length - '.night'.length;
    const night =
      labelLength <= 3 ? price.cost_short : labelLength === 4 ? price.cost_med : price.cost_long;
    if (!price.buy_enabled || !price.coin_color.every((byte) => byte === 0) || night <= 0n)
      throw new Error('Registry purchase terms are unavailable.');
    return { night, payee: Buffer.from(parent.owner_address.bytes).toString('hex') };
  }
  async function inventory(night) {
    const state = await firstValueFrom(wallet.wallet.state());
    if (
      !state.isSynced ||
      state.dust.availableCoins.length < 2 ||
      !state.unshielded.availableCoins.some((coin) => coin.utxo.value >= night)
    )
      throw new Error('The dedicated claim sponsor needs NIGHT and two DUST inputs.');
  }
  owner = await startDemoOwnerBundle(
    {
      assets: join(prepared, 'managed'),
      modulePath: join(prepared, 'managed/contract/index.js'),
      ref: reference,
    },
    {
      networkId,
      registryAddress,
      sponsorAddress: domainOwnerAddress,
      indexerUrl,
      indexerWsUrl,
      walletKeys,
    },
    origin,
    ownerPort,
  );
  const handler = createClaimSponsorHandler(
    origin,
    journalDir,
    {
      async authorize(_bytes, receipt) {
        if (receipt.registryAddress !== registryAddress) throw new Error('Claim registry changed.');
      },
      async submit(bytes) {
        const tx = Transaction.deserialize('signature', 'proof', 'binding', bytes);
        await providers.midnightProvider.submitTx({ version: 'v9', tx });
      },
    },
    {
      async issue(destination) {
        const terms = await live(destination);
        await inventory(terms.night);
        return {
          ...claimDestination(destination),
          id: randomBytes(32).toString('hex'),
          sponsorAddress: domainOwnerAddress,
          sponsorPaymentAddress,
          registryPayee: terms.payee,
          night: String(terms.night),
          maximumDust: String(maximumDust),
          expiresAt: Date.now() + 600_000,
        };
      },
      async authorizeQuote(quote) {
        const terms = await live(quote);
        if (
          quote.sponsorAddress !== domainOwnerAddress ||
          quote.sponsorPaymentAddress !== sponsorPaymentAddress ||
          quote.registryPayee !== terms.payee ||
          quote.night !== String(terms.night) ||
          quote.maximumDust !== String(maximumDust) ||
          quote.expiresAt <= Date.now()
        )
          throw new Error('The live registry or sponsor terms differ from the reviewed quote.');
        await inventory(terms.night);
      },
      async retireExpiredUnsent(receipt) {
        if (
          (await readClaimFinality(indexerUrl, receipt, fetch, claimProtocolVersion)) !== false ||
          (await reader.hasDomain(receipt.name, profile)) ||
          !(await reader.isSupportedAccount(receipt.accountAddress, networkId))
        )
          throw new Error('The expired claim could not be proved unsent and unregistered.');
      },
      async balance(bytes) {
        const tx = Transaction.deserialize('signature', 'proof', 'pre-binding', bytes);
        const balanced = await providers.walletProvider.balanceTx({ version: 'v9', tx });
        assert.equal(balanced.version, 'v9');
        return balanced.tx.serialize();
      },
    },
    (error) =>
      console.error(
        'claim-demo-host: request refused:',
        error instanceof Error && safeRefusals.has(error.message)
          ? error.message
          : 'invalid request or unavailable sponsor',
      ),
  );
  server = createServer((request, response) => {
    void handler(request, response).then(
      (handled) => {
        if (!handled) response.writeHead(404).end();
      },
      () => response.destroy(),
    );
  });
  await new Promise((done, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', done);
  });
  console.log(`PASSPORT_MIDNAMES_OWNER_PORT=${new URL(owner.origin).port}`);
  console.log(`PASSPORT_MIDNAMES_SPONSOR_PORT=${port}`);
  const stop = new AbortController();
  process.once('SIGINT', () => stop.abort());
  process.once('SIGTERM', () => stop.abort());
  await new Promise((done) => stop.signal.addEventListener('abort', done, { once: true }));
} finally {
  if (server?.listening) await new Promise((done) => server.close(done));
  await owner?.close();
  await wallet.wallet.stop();
}
