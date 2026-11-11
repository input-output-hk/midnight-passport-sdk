import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import { configureMidnames } from '../../apps/passport-dapp/src/midnames/config.ts';
import { depositByName } from '../../apps/passport-dapp/src/midnames/deposit-by-name.ts';
import { readHostConfirmation } from '../../apps/passport-service/src/host-confirmation.ts';
import {
  isolationEnvironment,
  isolationProfile,
} from '../../scripts/qualification/native-isolation-profile.mjs';
import { saveIsolationReceipt } from '../../scripts/qualification/native-isolation-files.mjs';

const [output, ref, registryAddress, name] = process.argv.slice(2);
assert.equal(process.env.PASSPORT_MIDNAMES_NATIVE, '1');
assert.equal(process.env.MN_NETWORK_ID, 'undeployed');
assert.equal(process.env.PASSPORT_RC_LOCALNET, '1');
const expectedEnvironment = isolationEnvironment(
  isolationProfile(process.env.PASSPORT_NATIVE_ISOLATION_RUN_ID, output),
);
for (const [key, value] of Object.entries(expectedEnvironment))
  assert.equal(process.env[key], value, `Unexpected fixture setting ${key}`);
const target = join(output, 'sender');
mkdirSync(target, { mode: 0o700 });
const networkId = 'undeployed';
const indexerUrl = process.env.MN_INDEXER_URL;
const names = configureMidnames(
  {
    registryProfile: 'standalone-0.35',
    registryAddress,
    namespace: 'night',
    networkId,
    indexerUrl,
    indexerWsUrl: process.env.MN_INDEXER_WS_URL,
  },
  networkId,
  'acc-s3r1.1',
);
assert.ok(names);
const get = (name) =>
  import(import.meta.resolve(name, pathToFileURL(join(ref, 'package.json')).href));
const load = (file) => import(pathToFileURL(join(ref, file)).href);
const [
  walletModule,
  setup,
  binding,
  ledger,
  { CompiledContract },
  contracts,
  { versionOfRecord },
  rx,
  { sealInboxCoin },
] = await Promise.all([
  load('src/node/wallet.ts'),
  load('src/node/setup.ts'),
  load('contracts/managed/account/contract/index.js'),
  get('@midnightntwrk/ledger-v9'),
  get('@midnight-ntwrk/compact-js'),
  get('@midnight-ntwrk/midnight-js-contracts'),
  get('@midnight-ntwrk/midnight-js-protocol'),
  get('rxjs'),
  import(
    import.meta.resolve(
      '@input-output-hk/mn-passport-keys',
      pathToFileURL(join(import.meta.dirname, '../../apps/passport-dapp/package.json')).href,
    )
  ),
]);

const receipt = { networkId, registryAddress, name, requestId: randomUUID(), dispatches: 0 };
const save = () => saveIsolationReceipt(join(target, 'sender.json'), receipt);
process.chdir(target);
let wallet;
try {
  save();
  wallet = await walletModule.createWallet('0'.repeat(63) + '1');
  await walletModule.syncWallet(wallet, 'independent isolated sender wallet');
  const faucet = await setup.deployFaucet(wallet);
  const domain = new Uint8Array(randomBytes(32));
  const amount = 10n;
  const walletState = await rx.firstValueFrom(
    wallet.wallet.state().pipe(rx.filter((state) => state.isSynced)),
  );
  receipt.faucetAddress = faucet.address;
  receipt.mintIdentifier = await faucet.mint(
    domain,
    amount,
    new Uint8Array(randomBytes(32)),
    walletModule.coinPublicKeyBytes(walletState),
  );
  save();
  const color = ledger.encodeRawTokenType(ledger.rawTokenType(domain, faucet.address));
  await delay(15_000);
  const { publicDataProvider, proofProvider, walletProvider, zkConfigProvider, midnightProvider } =
    await walletModule.createProviders(wallet);
  const compiledContract = CompiledContract.make('account', binding.Contract).pipe(
    CompiledContract.withWitnesses({
      held_coin: () => {
        throw Error('Sender has no owner private state');
      },
    }),
    CompiledContract.withCompiledFileAssets(join(ref, 'contracts/managed/account')),
  );
  const result = await depositByName(
    {
      name,
      networkId,
      requestId: receipt.requestId,
      color,
      amount,
      nonce: new Uint8Array(randomBytes(32)),
    },
    {
      names,
      sealCoin: sealInboxCoin,
      sleep: delay,
      chain: {
        async readAccount(address, { includeInbox } = {}) {
          const state = await publicDataProvider.queryContractState(address);
          if (!state) return undefined;
          const account = binding.ledger(state.data);
          return {
            booted: account.booted,
            specVersion: Number(account.spec_version),
            encKey: account.enc_key,
            ...(includeInbox && {
              inboxEntries: [...account.inbox]
                .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
                .map(([, entry]) => entry),
            }),
          };
        },
      },
      async review(intent) {
        receipt.review = { ...intent, amount: String(intent.amount) };
        console.log('Synthetic sender approval', JSON.stringify(receipt.review));
        save();
        return true;
      },
      async prepare({ account, coin, entry }) {
        const {
          private: { unprovenTx },
        } = await contracts.createUnprovenCallTx(
          { publicDataProvider, walletProvider, zkConfigProvider },
          {
            compiledContract,
            contractAddress: account,
            circuitId: 'deposit_shielded',
            args: [coin, entry],
          },
        );
        const proven = await proofProvider.proveTx({ version: 'v9', tx: unprovenTx });
        assert.equal(proven.version, 'v9');
        const balanced = await walletProvider.balanceTx(proven);
        assert.equal(balanced.version, 'v9');
        const raw = balanced.tx.serialize();
        receipt.identifiers = balanced.tx.identifiers();
        assert.ok(receipt.identifiers.length > 0);
        receipt.preparedSha256 = createHash('sha256').update(raw).digest('hex');
        writeFileSync(join(target, 'deposit.private.bin'), raw, { mode: 0o600, flag: 'wx' });
        save();
        return async () => {
          assert.equal(receipt.dispatches, 0);
          receipt.dispatches = 1;
          save();
          const submissionId = String(await midnightProvider.submitTx(balanced));
          receipt.submissionId = submissionId;
          save();
          const deadline = Date.now() + 120_000;
          while (Date.now() < deadline) {
            const included = await readHostConfirmation(
              { identifiers: receipt.identifiers, submissionId },
              { ledger, versionOfRecord, indexerUrl },
            );
            if (included?.succeeded) {
              receipt.txHash = included.txHash;
              receipt.blockHeight = included.blockHeight;
              assert.equal(receipt.txHash, balanced.tx.transactionHash());
              save();
              return { txId: included.txHash };
            }
            await delay(1000);
          }
          throw Error('Original named deposit finality unconfirmed');
        };
      },
    },
  );
  receipt.inboxIndex = result.inboxIndex;
  receipt.viewingKeyChanged = result.viewingKeyChanged;
  receipt.passed = true;
  save();
} catch (error) {
  receipt.error = String(error);
  save();
  throw error;
} finally {
  if (wallet) await wallet.wallet.stop();
}
