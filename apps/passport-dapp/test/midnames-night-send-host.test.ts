import assert from 'node:assert/strict';
import { test } from 'node:test';
import { IDBFactory } from 'fake-indexeddb';
import type { PassportAccount } from '@input-output-hk/mn-passport-protocol';
import {
  PassportNameError,
  type PassportNameService,
} from '@input-output-hk/mn-passport-account/names';
import type { NetworkConfig, Prover } from '@input-output-hk/mn-passport-account/ports';
import { accModule } from '../src/acc-module.js';
import { createMidnamesNameService } from '../src/midnames/resolver.js';
import { createConnectedNightSend } from '../src/midnames/night-send-host.js';
import { openBrowserNightSendJournal } from '../src/midnames/night-send-journal.js';
import type { NightBridgeTransaction } from '../src/midnames/night-bridge-output.js';
import {
  NightDepositInterrupted,
  NightSendPreflightError,
  type NightSendRequest,
} from '../src/midnames/night-send.js';
import type { DevWallet } from '../src/wallet/contracts.js';

const source = 'a'.repeat(64);
const bridgeAddress = 'b'.repeat(64);
const target = 'c'.repeat(64);
const credentialId = 'd'.repeat(32);
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
  manifestSha256: '77fb9c17b0d59047456c43115d9a58f5cb99a226ee73b6b974fd724930c3153f',
  indexerUrl: 'http://indexer',
  indexerWsUrl: 'ws://indexer',
  nodeUrl: 'http://node',
  artefactUrl: 'http://artefacts',
};

test('provisional named NIGHT send refuses before wallet access or owner withdrawal', async () => {
  let walletTouched = false;
  const candidate = {
    ...network,
    bindingId: 'acc-s3r1.1-zkir036',
    manifestSha256: '590d3c97db7fce05d5ea85a9bf37c82b7032c498703a2807276ca7ae0ca52e5f',
  };
  const account = {
    address: source,
    networkId: candidate.networkId,
    bindingId: candidate.bindingId,
    scheme: 'jubjub-schnorr',
    credentialId: new Uint8Array(16).fill(0xdd),
  } as PassportAccount;
  const wallet = {
    descriptor: {
      async connect() {
        walletTouched = true;
        throw new Error('Candidate wallet must not be connected.');
      },
    },
  } as unknown as DevWallet;
  const options = {
    account,
    scope,
    wallet,
    names: {} as PassportNameService,
    isSupportedRecipient: async () => true,
    readSourceBalance: async () => 10n,
    review: async () => true,
    checkScope: () => {},
    checkApproved: () => {},
    network: candidate,
    binding: accModule,
    prover: {
      proveTx: async () => {
        throw new Error('No candidate proof.');
      },
    },
  };
  await assert.rejects(
    () => createConnectedNightSend(options, new IDBFactory()),
    /cannot send NIGHT by name/,
  );
  await assert.rejects(
    () => createConnectedNightSend({ ...options, provisionalLocal: true }, new IDBFactory()),
    /cannot send NIGHT by name/,
  );
  assert.equal(walletTouched, false);
});

test('stable NIGHT host refuses a candidate-pinned journal scope before wallet access', async () => {
  let walletTouched = false;
  const account = {
    address: source,
    networkId: 'undeployed',
    bindingId: network.bindingId,
    scheme: 'jubjub-schnorr',
    credentialId: new Uint8Array(16).fill(0xdd),
  } as PassportAccount;
  const wallet = {
    descriptor: {
      async connect() {
        walletTouched = true;
        throw new Error('The wallet must not be connected.');
      },
    },
  } as unknown as DevWallet;
  await assert.rejects(
    () =>
      createConnectedNightSend(
        {
          account,
          scope: {
            ...scope,
            bindingId: 'acc-s3r1.1-zkir036',
            manifestSha256: '590d3c97db7fce05d5ea85a9bf37c82b7032c498703a2807276ca7ae0ca52e5f',
          },
          wallet,
          names: {} as PassportNameService,
          isSupportedRecipient: async () => true,
          readSourceBalance: async () => 10n,
          review: async () => true,
          checkScope: () => {},
          checkApproved: () => {},
          network,
          binding: accModule,
          prover: {
            proveTx: async () => {
              throw new Error('No proof');
            },
          },
        },
        new IDBFactory(),
      ),
    /cannot send NIGHT by name/,
  );
  assert.equal(walletTouched, false);
});

async function connectedJourney(
  network: NetworkConfig,
  provisionalLocal = false,
  refusal?:
    'repoint-after-review' | 'non-contract-target' | 'unsupported-asset' | 'recipient-old-binding',
  recoverRepoint = false,
  recoverUnavailable = false,
  mixedRecipient = false,
) {
  const factory = new IDBFactory();
  const finalized = new Set<string>();
  const calls: string[] = [];
  let address = bridgeAddress;
  let indexerUri = network.indexerUrl;
  let failProof = true;
  let loseDepositReply = false;
  let selected = true;
  let namedTarget = target;
  let nameUnavailable = false;
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
    bindingId: network.bindingId,
    scheme: 'jubjub-schnorr',
    credentialId: new Uint8Array(16).fill(0xdd),
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
            indexerWsUri: network.indexerWsUrl,
            substrateNodeUri: network.nodeUrl,
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
        if (loseDepositReply) throw new Error('deposit response lost after dispatch');
        return '00' + 'f'.repeat(64);
      },
      balanceWithdrawalFee: async () => {
        throw new Error('The receive fixture must not balance a withdrawal.');
      },
      prepareDustRegistration: async () => {
        throw new Error('The receive fixture must not register DUST.');
      },
      submitDustRegistration: async () => {
        throw new Error('The receive fixture must not submit DUST registration.');
      },
    },
    stop: async () => {},
  };
  const names = createMidnamesNameService(
    { networkId: 'undeployed', namespace: 'night', registryAddress: '3'.repeat(64) },
    {
      readTarget: async () => {
        if (nameUnavailable) throw new Error('name indexer unavailable');
        return {
          kind: refusal === 'non-contract-target' ? 'other' : 'contract',
          address: namedTarget,
        };
      },
      isSupportedAccount: async () => true,
    },
  );
  const selectedScope = provisionalLocal
    ? { ...scope, bindingId: network.bindingId, manifestSha256: network.manifestSha256 }
    : scope;
  const openHost = () =>
    createConnectedNightSend(
      {
        account,
        scope: selectedScope,
        wallet,
        names,
        isSupportedRecipient: async () =>
          refusal === 'recipient-old-binding' || mixedRecipient ? 'acc-s3r1.1' : network.bindingId,
        readSourceBalance: async () => 10n,
        review: async () => {
          calls.push('review');
          if (refusal === 'repoint-after-review') namedTarget = '6'.repeat(64);
          return true;
        },
        ...(recoverRepoint && {
          reviewOriginalDeposit: async (
            original: { target: string; requestId: string },
            current: { target: string },
            saved: { hash: string },
          ) => {
            assert.equal(original.target, target);
            assert.equal(original.requestId, request.requestId);
            assert.equal(current.target, '6'.repeat(64));
            assert.equal(saved.hash, withdrawal.hash);
            calls.push('recovery-review');
            return true;
          },
        }),
        ...(recoverUnavailable && {
          reviewUnresolvedOriginalDeposit: async (
            original: { target: string; requestId: string },
            observation: { reason: string },
            saved: { hash: string },
          ) => {
            assert.equal(original.target, target);
            assert.equal(original.requestId, request.requestId);
            assert.equal(observation.reason, 'Unavailable');
            assert.equal(saved.hash, withdrawal.hash);
            calls.push('repair-review');
            return true;
          },
        }),
        checkScope: () => {},
        checkApproved: () => calls.push('approved'),
        network,
        provisionalLocal,
        binding: accModule,
        ...(mixedRecipient && {
          oldRecipient: {
            network: {
              ...network,
              bindingId: 'acc-s3r1.1',
              manifestSha256: '77fb9c17b0d59047456c43115d9a58f5cb99a226ee73b6b974fd724930c3153f',
              artefactUrl: 'http://127.0.0.1:8788/v1/zk/acc-s3r1.1',
            },
            binding: accModule,
            prover: {
              proveTx: async () => ({ tx: Uint8Array.of(7), provenance: 'remote' as const }),
            } satisfies Prover,
          },
        }),
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
          assert.equal(value.provisionalLocal, mixedRecipient ? false : provisionalLocal);
          assert.equal(value.network.bindingId, mixedRecipient ? 'acc-s3r1.1' : network.bindingId);
          calls.push('prove-deposit');
          if (failProof) throw new Error('proof unavailable');
          return Uint8Array.of(7);
        },
      },
    );
  let host = await openHost();

  if (refusal) {
    await assert.rejects(
      () =>
        host.send(refusal === 'unsupported-asset' ? { ...request, asset: 'shielded' } : request),
      refusal === 'repoint-after-review'
        ? (error: unknown) =>
            error instanceof NightSendPreflightError && error.code === 'NightNameChanged'
        : refusal === 'recipient-old-binding'
          ? (error: unknown) =>
              error instanceof NightSendPreflightError && error.code === 'NightRecipientUnsupported'
          : refusal === 'non-contract-target'
            ? (error: unknown) =>
                error instanceof PassportNameError && error.code === 'InvalidRecord'
            : /Unsupported or invalid standalone NIGHT payment/,
    );
    assert.equal(await host.readActive(), undefined);
    const journal = await openBrowserNightSendJournal(factory, selectedScope);
    assert.equal(await journal.readIntent(), undefined);
    assert.equal(await journal.readLeg('withdraw'), undefined);
    assert.equal(await journal.readLeg('deposit'), undefined);
    assert.equal(
      (await journal.readRefused(request.requestId))?.reason,
      refusal === 'repoint-after-review' ? 'name-recheck' : undefined,
    );
    journal.close();
    assert.deepEqual(calls, refusal === 'repoint-after-review' ? ['review'] : []);
    return;
  }

  assert.equal((await host.send(request)).phase, 'withdrawal-pending');
  assert.deepEqual((await host.readActive())?.withdrawal, withdrawal);
  host = await openHost();
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
  host = await openHost();
  assert.deepEqual((await host.readActive())?.withdrawal, withdrawal);
  if (recoverUnavailable) nameUnavailable = true;
  else namedTarget = '6'.repeat(64);
  if (!recoverRepoint && !recoverUnavailable) {
    await assert.rejects(
      () => host.send(request),
      (error) => {
        assert.ok(error instanceof NightDepositInterrupted);
        assert.match(String(error.cause), /name changed after withdrawal/);
        return true;
      },
    );
    assert.deepEqual((await host.readActive())?.withdrawal, withdrawal);
    assert.equal((await host.readActive())?.deposit, undefined);
    namedTarget = target;
  }
  failProof = false;
  loseDepositReply = true;
  assert.equal((await host.send(request)).phase, 'deposit-pending');
  assert.deepEqual((await host.readActive())?.deposit, deposit);
  host = await openHost();
  assert.deepEqual((await host.readActive())?.deposit, deposit);
  loseDepositReply = false;
  finalized.add(deposit.hash);
  assert.equal((await host.send(request)).phase, 'completed');
  assert.equal(await host.readActive(), undefined);
  const journal = await openBrowserNightSendJournal(factory, selectedScope);
  const archived = await journal.readArchived(request.requestId);
  assert.equal(archived?.deposit?.hash, deposit.hash);
  assert.equal(
    archived?.intent.recipientBindingId,
    mixedRecipient ? 'acc-s3r1.1' : network.bindingId,
  );
  if (recoverUnavailable)
    assert.equal(archived?.recoveryReviews?.[0]?.unresolvedReason, 'Unavailable');
  journal.close();
  assert.deepEqual(calls, [
    'review',
    'owner',
    'approved',
    'observe-output',
    'prove-deposit',
    ...(recoverRepoint ? ['recovery-review'] : []),
    ...(recoverUnavailable ? ['repair-review'] : []),
    'observe-output',
    'prove-deposit',
    'prepare-deposit',
    'submit-deposit',
  ]);

  nameUnavailable = false;

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
          scope: selectedScope,
          wallet,
          names,
          isSupportedRecipient: async () => true,
          readSourceBalance: async () => 10n,
          review: async () => true,
          checkScope: () => {},
          checkApproved: () => {},
          network,
          provisionalLocal,
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
      scope: selectedScope,
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
      provisionalLocal,
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
}

test('connected NIGHT host reopens the original journal through withdrawal, deposit and archive', async () => {
  await connectedJourney(network);
});

test('connected NIGHT host resumes only the reviewed original deposit after a name repoint', async () => {
  await connectedJourney(network, false, undefined, true);
});

test('connected NIGHT host repairs the exact original deposit during a name outage', async () => {
  await connectedJourney(network, false, undefined, false, true);
});

test('pinned local candidate reopens the same two-leg original and rejects a nonlocal endpoint', async () => {
  const candidate = {
    ...network,
    bindingId: 'acc-s3r1.1-zkir036',
    manifestSha256: '590d3c97db7fce05d5ea85a9bf37c82b7032c498703a2807276ca7ae0ca52e5f',
    indexerUrl: 'http://127.0.0.1:8088/api/v4/graphql',
    indexerWsUrl: 'ws://127.0.0.1:8088/api/v4/graphql/ws',
    nodeUrl: 'http://127.0.0.1:9944/',
    artefactUrl: 'http://127.0.0.1:3000/v1/zk/acc-s3r1.1-zkir036',
  };
  await connectedJourney(candidate, true);
  await connectedJourney(candidate, true, undefined, true);
  await connectedJourney(candidate, true, undefined, false, false, true);
  await connectedJourney(candidate, true, undefined, true, false, true);
  await assert.rejects(
    () => connectedJourney({ ...candidate, indexerUrl: 'http://remote/api/v4/graphql' }, true),
    /Unsupported pinned NIGHT deposit request/,
  );
});

test('pinned local connected host refuses moved, non-contract and unsupported-asset routes before owner signing', async () => {
  const candidate = {
    ...network,
    bindingId: 'acc-s3r1.1-zkir036',
    manifestSha256: '590d3c97db7fce05d5ea85a9bf37c82b7032c498703a2807276ca7ae0ca52e5f',
    indexerUrl: 'http://127.0.0.1:8088/api/v4/graphql',
    indexerWsUrl: 'ws://127.0.0.1:8088/api/v4/graphql/ws',
    nodeUrl: 'http://127.0.0.1:9944/',
    artefactUrl: 'http://127.0.0.1:3000/v1/zk/acc-s3r1.1-zkir036',
  };
  for (const refusal of [
    'repoint-after-review',
    'non-contract-target',
    'unsupported-asset',
    'recipient-old-binding',
  ] as const)
    await connectedJourney(candidate, true, refusal);
});
