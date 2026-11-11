import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { sendNightByName } from '../../apps/passport-dapp/src/midnames/night-send.ts';
import { createMidnamesNameService } from '../../apps/passport-dapp/src/midnames/resolver.ts';
import { readHostConfirmation } from '../../apps/passport-service/src/host-confirmation.ts';
import { prepareLocalnetNight } from '../../apps/passport-funding-service/src/night-preparation.ts';

import { createOnce } from './create-once.mts';

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

function unshieldedOffers(transaction) {
  return [...transaction.intents].flatMap(([segment, intent]) =>
    [intent.guaranteedUnshieldedOffer, intent.fallibleUnshieldedOffer]
      .filter(Boolean)
      .map((offer) => ({ offer, intentHash: intent.intentHash(segment) })),
  );
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
  const openPorts = (beforeDeposit) => ({
    names,
    journal: openJournal(directory),
    isSupportedRecipient: (address, network) => reads.isSupportedAccount(address, network),
    async readSourceBalance(address) {
      return (await reads.isSupportedAccount(address, networkId)) ? balance(address) : undefined;
    },
    async review(intent) {
      approvals++;
      assert.equal(intent.target, target);
      assert.notEqual(intent.target, defaultField.value);
      console.log('Synthetic owner approval', JSON.stringify(intent));
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
      assert.equal(original.transactionHash(), withdrawal.hash);
      const offers = unshieldedOffers(original).filter(({ offer }) => offer.outputs.length > 0);
      assert.equal(offers.length, 1);
      const [{ intentHash, offer }] = offers;
      assert.equal(offer.outputs.length, 1);
      assert.equal(offer.outputs[0].value, BigInt(intent.amount));
      assert.equal(offer.outputs[0].owner, bridge);
      const matches = (coin) =>
        coin.intentHash === intentHash &&
        coin.outputNo === 0 &&
        coin.value === BigInt(intent.amount) &&
        coin.type === offer.outputs[0].type;
      assert.ok(
        await until(async () => (await availableNight()).some(({ utxo }) => matches(utxo))),
      );
      const balanced = await makeCall(target, intent.operations[1], [color, BigInt(intent.amount)]);
      const inputs = unshieldedOffers(balanced.tx).flatMap(({ offer: item }) => item.inputs);
      assert.equal(inputs.length, 1);
      assert.ok(matches(inputs[0]), 'Deposit must consume the original exact NIGHT output');
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
  step('withdraw-then-interrupt-before-deposit');
  await assert.rejects(
    sendNightByName(
      request,
      openPorts(() => {
        throw interrupted;
      }),
    ),
    (error) => error.cause === interrupted,
  );
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
    sent,
    withdrawal,
    deposit,
    exactBridgeOutputConsumed: true,
    replayBroadcasts: 0,
  };
}
