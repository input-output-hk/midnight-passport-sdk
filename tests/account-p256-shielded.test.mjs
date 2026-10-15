import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createPassportAccounts } from '../packages/account/dist/index.js';
import { createFakePorts } from '../packages/account/dist/testing/index.js';
import { recipeDeviceKeyring } from '../packages/keys/dist/index.js';
import { pureCircuits } from '../packages/contract/generated/acc-s3r1.1/index.js';

test('P-256 shielded spend signs the qualified coin and sends the same private witness', async () => {
  const fake = createFakePorts({ binding: { pureCircuits } });
  const marker = new Uint8Array(192);
  marker[0] = 1;
  marker[1] = 1;
  const coin = {
    nonce: new Uint8Array(32).fill(5),
    color: new Uint8Array(32).fill(7),
    value: 7n,
    mt_index: 9n,
  };
  const keyring = recipeDeviceKeyring({
    withSession: (/** @type {() => Promise<any>} */ operation) => operation(),
    deriveSecret: async () => new Uint8Array(32).fill(9),
    deviceSecret: async () => new Uint8Array(32).fill(9),
  });
  const viewingKey = {
    ...keyring,
    openInbox: async (
      /** @type {string} */ network,
      /** @type {import('../packages/account/dist/ports/index.js').AccountKeyring} */ ring,
      /** @type {readonly Uint8Array[]} */ entries,
    ) => {
      const opened = await keyring.openInbox(network, ring, entries);
      return opened.map((item, index) =>
        entries[index] === marker ? { kind: /** @type {const} */ ('coin'), coin } : item,
      );
    },
  };
  /** @type {Array<import('../packages/account/dist/ports/index.js').FlowDescriptor | undefined>} */
  const sessions = [];
  /** @type {import('../packages/account/dist/ports/index.js').AuthorisationRequest[]} */
  const signatures = [];
  /** @type {import('../packages/account/dist/ports/index.js').CallRequest[]} */
  const transfers = [];
  let selectedIndex = -1;
  const ports = {
    ...fake,
    network: { ...fake.network, bindingId: 'acc-s3r1.1' },
    viewingKey,
    holdings: {
      selectHeldEntries: async () => [selectedIndex],
      selectQualifiedHeldCoins: async () => [{ inboxIndex: selectedIndex, coin }],
    },
    authoriser: {
      ...fake.authoriser,
      withKeySession: async (
        /** @type {() => Promise<any>} */ operation,
        /** @type {import('../packages/account/dist/ports/index.js').FlowDescriptor | undefined} */ flow,
      ) => {
        sessions.push(flow);
        return operation();
      },
      authorise: async (
        /** @type {import('../packages/account/dist/ports/index.js').AuthorisationRequest} */ request,
      ) => {
        signatures.push(request);
        return fake.authoriser.authorise(request);
      },
    },
    chain: {
      ...fake.chain,
      call: async (
        /** @type {import('../packages/account/dist/ports/index.js').CallRequest} */ request,
      ) => {
        if (request.circuit === 'withdraw_shielded_with_p256') {
          transfers.push(request);
          return { txHash: 'shielded-tx' };
        }
        return fake.chain.call(request);
      },
    },
  };
  const account = await createPassportAccounts(ports).createAccount({
    userName: 'shielded',
    retireAuthority: true,
  });
  const ledger = fake.ledger.get(account.address);
  const hint = [...fake.directory.hints.values()][0];
  assert.ok(ledger && hint);
  ledger.specVersion = 3;
  selectedIndex = ledger.inboxEntries.push(marker) - 1;
  const nonce = ledger.authNonce;
  const request = {
    inboxIndex: selectedIndex,
    color: Buffer.from(coin.color).toString('hex'),
    amount: '7',
    recipient: '02'.repeat(32),
  };
  assert.ok(account.withdrawShielded);
  const tx = await account.withdrawShielded(request);
  assert.equal(tx.txHash, 'shielded-tx');
  assert.deepEqual(sessions.at(-1), {
    kind: 'withdraw-shielded',
    account: account.address,
    ...request,
  });
  const signed = signatures.at(-1);
  const call = transfers[0];
  assert.ok(signed && call);
  assert.deepEqual(signed.witnessValues, [coin]);
  assert.deepEqual(call.heldCoin, coin);
  assert.deepEqual(
    signed.challenge,
    pureCircuits.challenge_withdraw_shielded_with_p256(
      { bytes: Buffer.from(account.address, 'hex') },
      { ...hint.publicKey, identity: false },
      { bytes: Buffer.from(request.recipient, 'hex') },
      coin.color,
      7n,
      coin,
      nonce,
    ),
  );
  assert.equal(call.args[2], 7n);
  const signatureCount = signatures.length;
  await assert.rejects(account.withdrawShielded({ ...request, amount: '13' }), {
    code: 'TransferInvalid',
  });
  await assert.rejects(account.withdrawShielded({ ...request, amount: '6' }), {
    code: 'TransferInvalid',
  });
  await assert.rejects(account.withdrawShielded({ ...request, inboxIndex: 999 }), {
    code: 'TransferInvalid',
  });
  assert.equal(transfers.length, 1);
  assert.equal(signatures.length, signatureCount);
});
