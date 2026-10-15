import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createPassportAccounts } from '../packages/account/dist/index.js';
import { createFakePorts } from '../packages/account/dist/testing/index.js';
import { pureCircuits } from '../packages/contract/generated/acc-s3r1.1/index.js';

test('P-256 owner withdrawal pins the challenge, passkey, consent and circuit arguments', async () => {
  const fake = createFakePorts({ binding: { pureCircuits } });
  /** @type {Array<import('../packages/account/dist/ports/index.js').FlowDescriptor | undefined>} */
  const sessions = [];
  /** @type {import('../packages/account/dist/ports/index.js').AuthorisationRequest[]} */
  const signatures = [];
  /** @type {import('../packages/account/dist/ports/index.js').CallRequest[]} */
  const transfers = [];
  const ports = {
    ...fake,
    network: { ...fake.network, bindingId: 'acc-s3r1.1' },
    authoriser: {
      ...fake.authoriser,
      withKeySession: async (
        /** @type {() => Promise<any>} */ operation,
        /** @type {import('../packages/account/dist/ports/index.js').FlowDescriptor | undefined} */ descriptor,
      ) => {
        sessions.push(descriptor);
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
        if (request.circuit === 'withdraw_unshielded_with_p256') {
          transfers.push(request);
          return { txHash: 'withdraw-tx' };
        }
        return fake.chain.call(request);
      },
    },
  };
  const account = await createPassportAccounts(ports).createAccount({
    userName: 'withdraw',
    retireAuthority: true,
  });
  const ledger = fake.ledger.get(account.address);
  const hint = [...fake.directory.hints.values()][0];
  assert.ok(ledger && hint);
  ledger.specVersion = 3;
  const request = { color: '01'.repeat(32), amount: '7', recipient: '02'.repeat(32) };
  const expectedCounter = ledger.authNonce;
  assert.ok(account.withdrawUnshielded);
  const result = await account.withdrawUnshielded(request);
  assert.equal(result.txHash, 'withdraw-tx');
  assert.deepEqual(sessions.at(-1), {
    kind: 'withdraw-unshielded',
    account: account.address,
    ...request,
  });
  const signature = signatures.at(-1);
  const call = transfers[0];
  assert.ok(signature && call);
  assert.equal(signature.circuit, 'withdraw_unshielded_with_p256');
  assert.deepEqual(signature.credentialId, account.credentialId);
  assert.equal(
    signature.useCounter,
    /** @type {{use_counter: bigint}} */ (call.args[3]).use_counter,
  );
  assert.deepEqual(
    signature.challenge,
    pureCircuits.challenge_withdraw_unshielded_with_p256(
      { bytes: Buffer.from(account.address, 'hex') },
      { ...hint.publicKey, identity: false },
      Buffer.from(request.color, 'hex'),
      7n,
      { bytes: Buffer.from(request.recipient, 'hex') },
      expectedCounter,
    ),
  );
  assert.deepEqual(call.args.slice(0, 3), [
    Uint8Array.from(Buffer.from(request.color, 'hex')),
    7n,
    { bytes: Uint8Array.from(Buffer.from(request.recipient, 'hex')) },
  ]);
  for (const invalid of [
    { ...request, amount: '0' },
    { ...request, amount: String(1n << 128n) },
    { ...request, recipient: 'ff'.repeat(31) },
    { ...request, color: 'FF'.repeat(32) },
  ]) {
    await assert.rejects(account.withdrawUnshielded(invalid), { code: 'TransferInvalid' });
  }
  assert.equal(transfers.length, 1);
  assert.equal(sessions.length, 1);
});
