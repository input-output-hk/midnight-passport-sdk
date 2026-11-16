import assert from 'node:assert/strict';
import { test } from 'node:test';
import { IDBFactory } from 'fake-indexeddb';
import type { PassportAccount } from '@input-output-hk/mn-passport-protocol';
import type { NetworkConfig, Prover } from '@input-output-hk/mn-passport-account/ports';
import { accModule } from '../src/acc-module.js';
import { createMidnamesNameService } from '../src/midnames/resolver.js';
import { createConnectedNightSend } from '../src/midnames/night-send-host.js';
import { openBrowserNightSendJournal } from '../src/midnames/night-send-journal.js';
import type { NightBridgeTransaction } from '../src/midnames/night-bridge-output.js';
import { NightDepositInterrupted, type NightSendRequest } from '../src/midnames/night-send.js';
import type { DevWallet } from '../src/wallet/contracts.js';

const source = 'a'.repeat(64);
const bridgeAddress = 'b'.repeat(64);
const target = 'c'.repeat(64);
const credentialId = 'd'.repeat(64);
const withdrawal = { hash: 'e'.repeat(64), identifiers: ['00' + 'e'.repeat(64)] };
const deposit = { hash: 'f'.repeat(64), identifiers: ['00' + 'f'.repeat(64)] };
const output = {
  transactionHash: withdrawal.hash,
  intentHash: '1'.repeat(64),
  outputNo: 0,
  owner: bridgeAddress,
  type: '00'.repeat(32),
  value: 4n,
};
const request: NightSendRequest = {
  requestId: 'a1234567-a123-4123-8123-a123456789ab',
  name: 'alice.night',
  networkId: 'undeployed',
  source,
  bridge: bridgeAddress,
  asset: 'NIGHT',
  amount: '4',
};
const scope = { networkId: 'undeployed' as const, source, credentialId };
const network: NetworkConfig = {
  networkId: 'undeployed',
  bindingId: 'acc-s3r1.1',
  manifestSha256: '2'.repeat(64),
  indexerUrl: 'http://indexer',
  indexerWsUrl: 'ws://indexer',
  nodeUrl: 'http://node',
  artefactUrl: 'http://artefacts',
};

test('connected NIGHT host reopens the original journal through withdrawal, deposit and archive', async () => {
  const factory = new IDBFactory();
  const finalized = new Set<string>();
  const calls: string[] = [];
  let address = bridgeAddress;
  let indexerUri = 'http://indexer';
  let failProof = true;
  let selected = true;
  let switchAt: 'review' | 'withdrawal' | undefined;
  const originalTransaction: NightBridgeTransaction = {
    transactionHash: () => withdrawal.hash,
    identifiers: () => [...withdrawal.identifiers],
    intents: new Map([
      [
        0,
        {
          intentHash: () => output.intentHash,
          guaranteedUnshieldedOffer: {
            inputs: [],
            outputs: [{ owner: bridgeAddress, type: output.type, value: output.value }],
          },
        },
      ],
    ]),
  };
  const account: PassportAccount = {
    address: source,
    networkId: 'undeployed',
    bindingId: 'acc-s3r1.1',
    scheme: 'jubjub-schnorr',
    credentialId: new Uint8Array(32).fill(0xdd),
    state: async () => ({
      booted: true,
      authNonce: 1n,
      deviceEpoch: 1n,
      entryCount: 1,
      specVersion: 3,
    }),
    rotateEncryptionKey: async () => ({ txHash: withdrawal.hash }),
    async withdrawUnshielded(value, options) {
      calls.push('owner');
      assert.deepEqual(value, { color: '00'.repeat(32), amount: '4', recipient: bridgeAddress });
      assert.ok(options?.beforeSubmit);
      if (switchAt === 'withdrawal') selected = false;
      await options.beforeSubmit({
        networkId: 'undeployed',
        account: source,
        circuit: 'withdraw_unshielded_with_jubjub',
        transactionHash: withdrawal.hash,
        identifiers: [...withdrawal.identifiers],
      });
      return { txHash: withdrawal.hash, nextUseCounter: 2n };
    },
  };
  const wallet: DevWallet = {
    descriptor: {
      name: 'test wallet',
      rdns: 'test.wallet',
      apiVersion: '4.1.0',
      async connect() {
        return {
          getConfiguration: async () => ({
            indexerUri,
            indexerWsUri: 'ws://indexer',
            substrateNodeUri: 'http://node',
            networkId: 'undeployed',
          }),
          getConnectionStatus: async () => ({ status: 'connected', networkId: 'undeployed' }),
          getShieldedAddresses: async () => ({
            shieldedAddress: 'shielded',
            shieldedCoinPublicKey: 'coin',
            shieldedEncryptionPublicKey: 'encryption',
          }),
          getUnshieldedAddress: async () => ({ unshieldedAddress: bridgeAddress }),
          getDustAddress: async () => ({ dustAddress: 'dust' }),
          getUnshieldedBalances: async () => ({}),
          getDustBalance: async () => ({ balance: 0n, cap: 0n }),
        };
      },
    },
    nightBridge: {
      getAddress: async () => address,
      hasOutput: async (candidate) => {
        assert.deepEqual(candidate, output);
        calls.push('observe-output');
        return true;
      },
      prepareDeposit: async (value) => {
        assert.deepEqual(value.output, output);
        assert.deepEqual(value.proven, Uint8Array.of(7));
        assert.deepEqual((await host.readActive())?.withdrawal, withdrawal);
        calls.push('prepare-deposit');
        return deposit;
      },
      submitDeposit: async (original) => {
        assert.deepEqual(original, deposit);
        assert.deepEqual((await host.readActive())?.deposit, deposit);
        calls.push('submit-deposit');
        return '00' + 'f'.repeat(64);
      },
    },
    stop: async () => {},
  };
  const names = createMidnamesNameService(
    { networkId: 'undeployed', namespace: 'night', registryAddress: '3'.repeat(64) },
    {
      readTarget: async () => ({ kind: 'contract', address: target }),
      isSupportedAccount: async () => true,
    },
  );
  const host = await createConnectedNightSend(
    {
      account,
      scope,
      wallet,
      names,
      isSupportedRecipient: async () => true,
      readSourceBalance: async () => 10n,
      review: async () => {
        calls.push('review');
        return true;
      },
      checkScope: () => {},
      checkApproved: () => calls.push('approved'),
      network,
      binding: accModule,
      prover: {
        proveTx: async () => {
          throw new Error('Proof is injected for this test.');
        },
      } satisfies Prover,
    },
    factory,
    {
      journal: openBrowserNightSendJournal,
      finalized: async (_indexer, _node, original) =>
        finalized.has(original.hash)
          ? { transaction: originalTransaction, blockHash: '4'.repeat(64), blockHeight: 7 }
          : undefined,
      prove: async (value) => {
        assert.equal(value.target, target);
        assert.equal(value.amount, 4n);
        calls.push('prove-deposit');
        if (failProof) throw new Error('proof unavailable');
        return Uint8Array.of(7);
      },
    },
  );

  assert.equal((await host.send(request)).phase, 'withdrawal-pending');
  assert.deepEqual((await host.readActive())?.withdrawal, withdrawal);
  finalized.add(withdrawal.hash);
  await assert.rejects(
    () => host.send(request),
    (error) => {
      assert.ok(error instanceof NightDepositInterrupted);
      assert.deepEqual(error.withdrawal, withdrawal);
      assert.match(String(error.cause), /proof unavailable/);
      return true;
    },
  );
  assert.deepEqual((await host.readActive())?.withdrawal, withdrawal);
  assert.equal((await host.readActive())?.deposit, undefined);
  failProof = false;
  assert.equal((await host.send(request)).phase, 'deposit-pending');
  assert.deepEqual((await host.readActive())?.deposit, deposit);
  finalized.add(deposit.hash);
  assert.equal((await host.send(request)).phase, 'completed');
  assert.equal(await host.readActive(), undefined);
  const journal = await openBrowserNightSendJournal(factory, scope);
  assert.equal((await journal.readArchived(request.requestId))?.deposit?.hash, deposit.hash);
  journal.close();
  assert.deepEqual(calls, [
    'review',
    'owner',
    'approved',
    'observe-output',
    'prove-deposit',
    'observe-output',
    'prove-deposit',
    'prepare-deposit',
    'submit-deposit',
  ]);

  Object.defineProperty(account, 'address', { value: '6'.repeat(64), configurable: true });
  await assert.rejects(() => host.send(request), /selected NIGHT owner changed/);
  await assert.rejects(() => host.readActive(), /selected NIGHT owner changed/);
  Object.defineProperty(account, 'address', { value: source, configurable: true });
  address = '5'.repeat(64);
  await assert.rejects(() => host.send(request), /bridge differs/);
  assert.equal(await host.readActive(), undefined);
  indexerUri = 'http://other-indexer';
  await assert.rejects(
    () =>
      createConnectedNightSend(
        {
          account,
          scope,
          wallet,
          names,
          isSupportedRecipient: async () => true,
          readSourceBalance: async () => 10n,
          review: async () => true,
          checkScope: () => {},
          checkApproved: () => {},
          network,
          binding: accModule,
          prover: {
            proveTx: async () => {
              throw new Error('Proof is injected for this test.');
            },
          } satisfies Prover,
        },
        factory,
      ),
    /configuration differ/,
  );

  address = bridgeAddress;
  indexerUri = network.indexerUrl;
  const switched = await createConnectedNightSend(
    {
      account,
      scope,
      wallet,
      names,
      isSupportedRecipient: async () => true,
      readSourceBalance: async () => 10n,
      review: async () => {
        if (switchAt === 'review') selected = false;
        return true;
      },
      checkScope: () => {
        if (!selected) throw new Error('The selected UI owner changed.');
      },
      checkApproved: () => calls.push('approved'),
      network,
      binding: accModule,
      prover: {
        proveTx: async () => {
          throw new Error('Proof must not start during an owner switch.');
        },
      } satisfies Prover,
    },
    new IDBFactory(),
  );
  const ownerCalls = calls.filter((call) => call === 'owner').length;
  switchAt = 'review';
  await assert.rejects(() => switched.send(request), /selected UI owner changed/);
  assert.equal(calls.filter((call) => call === 'owner').length, ownerCalls);
  selected = true;
  assert.equal(await switched.readActive(), undefined);

  switchAt = 'withdrawal';
  await assert.rejects(() => switched.send(request), /selected UI owner changed/);
  assert.equal(calls.filter((call) => call === 'owner').length, ownerCalls + 1);
  selected = true;
  assert.equal((await switched.readActive())?.withdrawal, undefined);
});
