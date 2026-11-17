import assert from 'node:assert/strict';
import { test } from 'node:test';
import { IDBFactory } from 'fake-indexeddb';
import { WalletFacade } from '@midnightntwrk/wallet-sdk-facade';
import { openBrowserNightSendJournal } from '../src/midnames/night-send-journal.js';
import {
  exactFencedNightDeposit,
  journaledNightBridgeOutput,
} from '../src/wallet/night-deposit-fence.js';
import { deviceNightDeposit } from '../src/wallet/night-deposit.js';
import { NIGHT_SEND_OPERATIONS, type NightSendIntent } from '../src/midnames/night-send.js';
import type { NightBridgeTransaction } from '../src/midnames/night-bridge-output.js';
import type { readFinalizedNightLeg } from '../src/midnames/night-finality.js';

const scope = {
  networkId: 'undeployed' as const,
  source: 'a'.repeat(64),
  credentialId: 'b'.repeat(64),
};
const output = {
  transactionHash: 'c'.repeat(64),
  intentHash: 'd'.repeat(64),
  outputNo: 0,
  owner: 'e'.repeat(64),
  type: '00'.repeat(32),
  value: 4n,
};
const intent: NightSendIntent = {
  requestId: 'a1234567-a123-4123-8123-a123456789ab',
  networkId: 'undeployed',
  source: scope.source,
  bridge: output.owner,
  asset: 'NIGHT',
  amount: '4',
  name: 'alice.night',
  target: 'f'.repeat(64),
  providerId: `midnames:${'1'.repeat(64)}`,
  namespace: 'night',
  operations: NIGHT_SEND_OPERATIONS,
};
const withdrawal = { hash: output.transactionHash, identifiers: ['00' + '1'.repeat(64)] };
const deposit = { hash: '2'.repeat(64), identifiers: ['01' + '3'.repeat(64)] };

test('worker dispatch requires the matching committed original in IndexedDB', async () => {
  const factory = new IDBFactory();
  const journal = await openBrowserNightSendJournal(factory, scope);
  assert.equal(
    await exactFencedNightDeposit(scope, deposit, output, intent.target, factory),
    false,
  );
  await journal.createIntent(intent);
  await journal.fenceLeg('withdraw', withdrawal);
  assert.equal(
    await exactFencedNightDeposit(scope, deposit, output, intent.target, factory),
    false,
  );
  await journal.fenceLeg('deposit', deposit);
  assert.equal(await exactFencedNightDeposit(scope, deposit, output, intent.target, factory), true);
  for (const [changedScope, changedDeposit, changedOutput, changedTarget] of [
    [scope, { ...deposit, hash: '4'.repeat(64) }, output, intent.target],
    [scope, deposit, { ...output, owner: '5'.repeat(64) }, intent.target],
    [scope, deposit, { ...output, value: 3n }, intent.target],
    [scope, deposit, output, '6'.repeat(64)],
  ] as const)
    assert.equal(
      await exactFencedNightDeposit(
        changedScope,
        changedDeposit,
        changedOutput,
        changedTarget,
        factory,
      ),
      false,
    );
  await assert.rejects(
    () =>
      exactFencedNightDeposit(
        { ...scope, credentialId: '7'.repeat(64) },
        deposit,
        output,
        intent.target,
        factory,
      ),
    /credential|Stored NIGHT|scope/i,
  );
  journal.close();
});

test('worker refuses a same-value coin from another withdrawal before signing or deposit fencing', async () => {
  const factory = new IDBFactory();
  const journal = await openBrowserNightSendJournal(factory, scope);
  await journal.createIntent(intent);
  await journal.fenceLeg('withdraw', withdrawal);
  const alien = { ...output, intentHash: '9'.repeat(64) };
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
            outputs: [{ owner: output.owner, type: output.type, value: output.value }],
          },
        },
      ],
    ]),
  };
  const finalized: typeof readFinalizedNightLeg = async (_indexer, _node, original) => {
    assert.deepEqual(original, withdrawal);
    return { transaction: originalTransaction, blockHash: '8'.repeat(64), blockHeight: 7 };
  };
  let adopted = 0;
  const facade = Object.assign(Object.create(WalletFacade.prototype) as WalletFacade, {
    adoptTransaction: () => {
      adopted++;
      throw new Error('A swapped coin must never reach the wallet signer.');
    },
  });
  const verify = (candidate: typeof output) =>
    journaledNightBridgeOutput(
      scope,
      intent.target,
      candidate,
      'indexer',
      'node',
      factory,
      finalized,
    );
  const signer = deviceNightDeposit(
    facade,
    async () => {
      throw new Error('A swapped coin must never request a signature.');
    },
    async () => [{ utxo: { ...alien } }],
    output.owner,
    'undeployed',
    true,
    (_scope, _target, candidate) => verify(candidate),
    async () => true,
  );
  await assert.rejects(
    () =>
      signer.prepare({
        scope,
        target: intent.target,
        output: alien,
        proven: Uint8Array.of(1),
      }),
    /does not come from the journaled withdrawal/,
  );
  assert.equal(adopted, 0);
  assert.deepEqual(await verify(output), output);
  await journal.fenceLeg('deposit', deposit);
  assert.equal(await exactFencedNightDeposit(scope, deposit, alien, intent.target, factory), true);
  journal.close();
});
