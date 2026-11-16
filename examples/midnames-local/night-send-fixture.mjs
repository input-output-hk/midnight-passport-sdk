import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import {
  NightPaymentDeclined,
  sendNightByName,
} from '../../apps/passport-dapp/src/midnames/night-send.ts';
import { createMidnamesNameService } from '../../apps/passport-dapp/src/midnames/resolver.ts';
import {
  assertExactNightBridgeSpend,
  exactNightBridgeOutput,
  hasExactNightBridgeCoin,
} from '../../apps/passport-dapp/src/midnames/night-bridge-output.ts';
import { readHostConfirmation } from '../../apps/passport-service/src/host-confirmation.ts';
import { prepareLocalnetNight } from '../../apps/passport-funding-service/src/night-preparation.ts';

import { createOnce } from './create-once.mts';
import { interactiveReviewRequested, reviewInTerminal } from './terminal-review.mjs';

function openJournal(directory) {
  const read = (name) => {
    const path = join(directory, name + '.json');
    return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : undefined;
  };
  const write = (name, value) => createOnce(join(directory, name + '.json'), JSON.stringify(value));
  return {
    readIntent: async () => read('intent'),
    createIntent: async (intent) => write('intent', intent),
    readLeg: async (leg) => read(leg),
    fenceLeg: async (leg, original) => write(leg, original),
  };
}

async function until(read, timeout = 120_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await read();
    if (value) return value;
    await delay(1_000);
  }
  return undefined;
}

async function post(url, body) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(4_000),
  });
  if (!response.ok) throw Error('Isolated finality endpoint unavailable');
  return response.json();
}

async function canonicalReceipt(original, ledger, versionOfRecord) {
  const indexerUrl = process.env.MN_INDEXER_URL;
  const first = await readHostConfirmation(original, { indexerUrl, ledger, versionOfRecord });
  if (!first?.succeeded || first.txHash !== original.hash) return undefined;
  const { data, errors } = await post(indexerUrl, {
    query:
      'query($offset:TransactionOffset!){transactions(offset:$offset){hash block{hash height} contractActions{address}}}',
    variables: { offset: { hash: first.txHash } },
  });
  if (errors || data?.transactions?.length !== 1) return undefined;
  const [row] = data.transactions;
  assert.equal(row.hash, original.hash);
  assert.equal(row.block.height, first.blockHeight);
  const rpc = async (method, params = []) =>
    (await post(process.env.MN_NODE_URL, { jsonrpc: '2.0', id: 1, method, params })).result;
  const finalizedHash = await rpc('chain_getFinalizedHead');
  if (!finalizedHash) return undefined;
  const header = await rpc('chain_getHeader', [finalizedHash]);
  if (!header || BigInt(header.number) < BigInt(row.block.height)) return undefined;
  if ((await rpc('chain_getBlockHash', [row.block.height])) !== '0x' + row.block.hash)
    return undefined;
  return {
    ...first,
    blockHash: row.block.hash,
    actions: row.contractActions.map((a) => a.address),
  };
}

export async function qualifyNightSend({
  output,
  get,
  walletModule,
  wallet,
  providers,
  accountCompiled,
  contracts,
  ledger,
  binding,
  reads,
  source,
  device,
  jubjubChallenges,
  registryAddress,
  target,
  repointTarget,
  repointName,
  defaultField,
  priorSplitId,
  step,
}) {
  const [{ versionOfRecord }, rx] = await Promise.all([
    get('@midnight-ntwrk/midnight-js-protocol'),
    get('rxjs'),
  ]);
  const directory = join(output, 'night-send');
  mkdirSync(directory, { mode: 0o700 });
  const networkId = 'undeployed';
  const names = createMidnamesNameService(
    { networkId, namespace: 'night', registryAddress },
    reads,
  );
  const color = new Uint8Array(32);
  const bridgeBytes = walletModule.userAddressBytes(wallet);
  const bridge = Buffer.from(bridgeBytes).toString('hex');
  const fund = 10n,
    amount = 4n;
  const state = async (address) =>
    binding.ledger((await providers.publicDataProvider.queryContractState(address)).data);
  const balance = async (address) => {
    const { unshielded_balances: holdings } = await state(address);
    return holdings.member(color) ? holdings.lookup(color) : 0n;
  };
  const makeCall = async (address, circuitId, args) => {
    const { privateStateProvider, ...publicProviders } = providers;
    const {
      private: { unprovenTx },
    } = await contracts.createUnprovenCallTx(publicProviders, {
      compiledContract: accountCompiled,
      contractAddress: address,
      circuitId,
      args,
    });
    const proven = await providers.proofProvider.proveTx({ version: 'v9', tx: unprovenTx });
    assert.equal(proven.version, 'v9');
    const balanced = await providers.walletProvider.balanceTx(proven);
    assert.equal(balanced.version, 'v9');
    return balanced;
  };
  const request = {
    requestId: randomUUID(),
    name: 'alice.night',
    networkId,
    source,
    bridge,
    asset: 'NIGHT',
    amount: String(amount),
  };
  step(priorSplitId ? 'observe-original-funding-night' : 'split-exact-funding-night');
  const splitId =
    priorSplitId ??
    (await prepareLocalnetNight(
      wallet.wallet,
      bridgeBytes,
      (bytes) => wallet.unshieldedKeystore.signDataAsync(bytes),
      color,
      fund,
    ));
  createOnce(join(directory, 'funding-split-id.json'), JSON.stringify(splitId));
  // Wallet state can temporarily report unsynced while it catches the next block.
  // For funding and deposit we require the exact coin, then verify the input on
  // the finalized, balanced transaction before broadcasting.
  const availableNight = async () => {
    const view = await rx
      .firstValueFrom(wallet.wallet.state().pipe(rx.timeout(5_000)))
      .catch(() => undefined);
    return view?.unshielded.availableCoins ?? [];
  };
  assert.ok(
    await until(async () => (await availableNight()).some(({ utxo }) => utxo.value === fund)),
    'Exact setup funding output is unavailable in the wallet',
  );
  step('fund-source-acc-night');
  const funding = await makeCall(source, 'deposit_unshielded', [color, fund]);
  await providers.midnightProvider.submitTx(funding);
  assert.ok(await until(() => balance(source).then((value) => value === fund)));
  assert.equal(await balance(target), 0n);

  let approvals = 0,
    signatures = 0;
  const sent = { withdraw: 0, deposit: 0 };
  const finals = new Map();
  const browserReviewRequested = process.env.PASSPORT_MIDNAMES_BROWSER_REVIEW === '1';
  const manualBrowserReview = process.env.PASSPORT_MIDNAMES_BROWSER_MANUAL === '1';
  const browserDecline = process.env.PASSPORT_MIDNAMES_BROWSER_DECISION === 'decline';
  const browserRepoint = process.env.PASSPORT_MIDNAMES_BROWSER_REPOINT === '1';
  assert.ok(!browserDecline || (browserReviewRequested && !manualBrowserReview));
  assert.ok(!browserRepoint || (browserReviewRequested && !manualBrowserReview && !browserDecline));
  assert.equal(!!repointName, browserRepoint);
  let browserReview;
  const openPorts = (beforeDeposit) => ({
    names,
    journal: openJournal(directory),
    isSupportedRecipient: (address, network) => reads.isSupportedAccount(address, network),
    async readSourceBalance(address) {
      return (await reads.isSupportedAccount(address, networkId)) ? balance(address) : undefined;
    },
    async review(intent) {
      assert.equal(intent.target, target);
      assert.notEqual(intent.target, defaultField.value);
      if (browserReviewRequested) {
        assert.equal(signatures, 0);
        assert.deepEqual(sent, { withdraw: 0, deposit: 0 });
        assert.equal(await openJournal(directory).readIntent(), undefined);
        const { reviewNamedNightSendInBrowser } = await import('./browser-value-review.mjs');
        browserReview = await reviewNamedNightSendInBrowser(
          intent,
          registryAddress,
          join(directory, 'browser-review.png'),
          manualBrowserReview ? undefined : browserDecline ? 'decline' : 'approve',
        );
        assert.equal(signatures, 0);
        assert.deepEqual(sent, { withdraw: 0, deposit: 0 });
        createOnce(
          join(directory, 'browser-review.json'),
          JSON.stringify({
            intent,
            registryAddress,
            decision: browserReview,
            signaturesBefore: signatures,
            dispatchesBefore: sent,
          }),
        );
        if (browserReview.approved) {
          approvals++;
          if (browserRepoint) await repointName();
        }
        return browserReview.approved;
      }
      if (interactiveReviewRequested()) {
        const approved = await reviewInTerminal(intent, intent.target);
        if (approved) approvals++;
        return approved;
      }
      console.log('Synthetic owner approval', JSON.stringify(intent));
      approvals++;
      return true;
    },
    async prepareWithdrawal(intent) {
      const current = await state(source);
      const contractAddress = new Uint8Array(Buffer.from(source, 'hex'));
      assert.ok(current.devices.member(device.entryAt(contractAddress, current.device_epoch, 0n)));
      signatures++;
      const auth = device.sign(
        jubjubChallenges.withdrawUnshielded(
          { contractAddress, authNonce: current.auth_nonce },
          device.pk,
          color,
          BigInt(intent.amount),
          bridgeBytes,
        ),
        0n,
      );
      const balanced = await makeCall(source, intent.operations[0], [
        color,
        BigInt(intent.amount),
        { bytes: bridgeBytes },
        auth.pk,
        auth.use_counter,
        auth.sig_r,
        auth.sig_s,
        auth.grind_nonce,
      ]);
      return prepared('withdraw', balanced);
    },
    async prepareDeposit(intent, withdrawal) {
      beforeDeposit();
      const original = ledger.Transaction.deserialize(
        'signature',
        'proof',
        'binding',
        readFileSync(join(directory, 'withdraw-' + withdrawal.hash + '.private.bin')),
      );
      const expected = exactNightBridgeOutput(intent, withdrawal, original);
      assert.ok(await until(async () => hasExactNightBridgeCoin(await availableNight(), expected)));
      const balanced = await makeCall(target, intent.operations[1], [color, BigInt(intent.amount)]);
      assertExactNightBridgeSpend(balanced.tx, expected, ledger.addressFromKey);
      return prepared('deposit', balanced);
    },
    async finalized(original) {
      const confirmed = await until(() =>
        canonicalReceipt(original, ledger, versionOfRecord).catch(() => undefined),
      );
      if (confirmed) finals.set(original.hash, confirmed);
      return !!confirmed;
    },
  });
  function prepared(leg, balanced) {
    const raw = balanced.tx.serialize();
    const original = {
      hash: balanced.tx.transactionHash(),
      identifiers: balanced.tx.identifiers(),
    };
    createOnce(join(directory, leg + '-' + original.hash + '.private.bin'), raw);
    return {
      original,
      async dispatch() {
        sent[leg]++;
        await providers.midnightProvider.submitTx(balanced);
      },
    };
  }
  const interrupted = new Error('Injected interruption after withdrawal finality');
  step(browserDecline ? 'review-before-owner-signature' : 'withdraw-then-interrupt-before-deposit');
  /** @type {unknown} */ let failure;
  try {
    await sendNightByName(
      request,
      openPorts(() => {
        throw interrupted;
      }),
    );
  } catch (error) {
    failure = error;
  }
  if (failure === undefined) assert.fail('Expected an interrupted withdrawal.');
  if (
    (interactiveReviewRequested() || browserReviewRequested) &&
    failure instanceof NightPaymentDeclined
  ) {
    assert.equal(signatures, 0);
    assert.deepEqual(sent, { withdraw: 0, deposit: 0 });
    createOnce(
      join(directory, 'decline.json'),
      JSON.stringify({ reviewDecision: 'declined', approvals, signatures, sent }),
    );
    if (!browserDecline) throw failure;
    assert.equal(approvals, 0);
    assert.deepEqual(browserReview, { approved: false, displayed: true, mode: 'automated' });
    assert.equal(await openJournal(directory).readIntent(), undefined);
    assert.equal(await openJournal(directory).readLeg('withdraw'), undefined);
    assert.equal(await openJournal(directory).readLeg('deposit'), undefined);
    const final = { source: String(await balance(source)), target: String(await balance(target)) };
    assert.deepEqual(final, { source: '10', target: '0' });
    return {
      declined: true,
      source,
      target,
      name: request.name,
      fundingHash: funding.tx.transactionHash(),
      browserReview,
      approvals,
      signatures,
      sent,
      final,
    };
  }
  if (browserDecline) assert.fail('The browser decline did not stop the named payment.');
  if (browserRepoint) {
    assert.match(String(failure), /The original payment scope changed/);
    assert.equal(approvals, 1);
    assert.equal(signatures, 0);
    assert.deepEqual(sent, { withdraw: 0, deposit: 0 });
    assert.ok(repointTarget);
    assert.equal(
      (await names.resolve({ name: request.name, networkId }))?.accountAddress,
      repointTarget,
    );
    const journal = openJournal(directory);
    assert.equal((await journal.readIntent())?.target, target);
    assert.equal(await journal.readLeg('withdraw'), undefined);
    assert.equal(await journal.readLeg('deposit'), undefined);
    const final = {
      source: String(await balance(source)),
      target: String(await balance(target)),
      repoint: String(await balance(repointTarget)),
    };
    assert.deepEqual(final, { source: '10', target: '0', repoint: '0' });
    createOnce(
      join(directory, 'repoint.json'),
      JSON.stringify({
        name: request.name,
        originalTarget: target,
        repointTarget,
        approvals,
        signatures,
        sent,
        final,
      }),
    );
    return {
      repointed: true,
      source,
      target,
      repointTarget,
      name: request.name,
      fundingHash: funding.tx.transactionHash(),
      browserReview,
      approvals,
      signatures,
      sent,
      final,
    };
  }
  assert.ok(failure instanceof Error);
  assert.equal(failure.cause, interrupted);
  const intermediate = {
    source: String(await balance(source)),
    target: String(await balance(target)),
  };
  assert.deepEqual(intermediate, { source: '6', target: '0' });
  assert.deepEqual(sent, { withdraw: 1, deposit: 0 });
  assert.equal(await openJournal(directory).readLeg('deposit'), undefined);
  step('reopen-durable-intent-and-deposit');
  const result = await sendNightByName(
    request,
    openPorts(() => {}),
  );
  assert.equal(result.phase, 'completed');
  const replay = await sendNightByName(
    request,
    openPorts(() => assert.fail('unexpected deposit replay')),
  );
  assert.deepEqual(replay, result);
  assert.equal(approvals, 1);
  assert.equal(signatures, 1);
  if (browserReviewRequested)
    assert.deepEqual(browserReview, {
      approved: true,
      displayed: true,
      mode: manualBrowserReview ? 'manual' : 'automated',
    });
  assert.deepEqual(sent, { withdraw: 1, deposit: 1 });
  const final = { source: String(await balance(source)), target: String(await balance(target)) };
  assert.deepEqual(final, { source: '6', target: '4' });
  const withdrawal = finals.get(result.withdrawal.hash);
  const deposit = finals.get(result.deposit.hash);
  assert.deepEqual(withdrawal.actions, [source]);
  assert.deepEqual(deposit.actions, [target]);
  return {
    source,
    target,
    bridge,
    name: request.name,
    requestId: request.requestId,
    splitId,
    amount: String(amount),
    fundingHash: funding.tx.transactionHash(),
    defaultField: defaultField.value,
    before: { source: '10', target: '0' },
    intermediate,
    final,
    approvals,
    signatures,
    browserReview,
    sent,
    withdrawal,
    deposit,
    exactBridgeOutputConsumed: true,
    replayBroadcasts: 0,
  };
}
