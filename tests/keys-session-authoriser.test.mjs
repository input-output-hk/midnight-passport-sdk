import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createSessionJubjubAuthoriser,
  deriveSymmetricSecret,
} from '../packages/keys/dist/index.js';
import { pureCircuits } from '../packages/contract/generated/acc-s3r1.1/index.js';
const context = {
  account: '12'.repeat(32),
  networkId: 'undeployed',
  bindingId: 'acc-s3r1.1',
  origin: 'localhost',
  sessionId: '34'.repeat(32),
  expiresAt: 900_000,
};
/** @returns {import('../packages/account/dist/ports/index.js').PrfKeySource} */
const source = () => ({
  withSession: (work) => work(),
  deviceSecret: async () => {
    throw Error('owner key requested');
  },
  deriveSecret: async (params) => deriveSymmetricSecret(new Uint8Array(64).fill(7), params),
});

test('session derivation is deterministic, separate by every authority context and renewal ID', async () => {
  const a = await createSessionJubjubAuthoriser(source(), pureCircuits, context, () => 1000);
  const b = await createSessionJubjubAuthoriser(source(), pureCircuits, context, () => 1000);
  assert.equal(a.publicKey, b.publicKey);
  for (const change of [
    { account: '13'.repeat(32) },
    { networkId: 'preview' },
    { bindingId: 'other' },
    { origin: 'other.example' },
    { sessionId: '35'.repeat(32) },
  ]) {
    const other = await createSessionJubjubAuthoriser(
      source(),
      pureCircuits,
      { ...context, ...change },
      () => 1000,
    );
    assert.notEqual(a.publicKey, other.publicKey);
    other.dispose();
  }
  a.dispose();
  b.dispose();
});

test('retained child bytes are cleared on lock and expiry; owner circuits and foreign accounts are refused', async () => {
  let time = 1000;
  const retained = new Uint8Array(32).fill(9);
  const s = await createSessionJubjubAuthoriser(
    { ...source(), deriveSecret: async () => retained },
    pureCircuits,
    context,
    () => time,
  );
  const request = {
    account: context.account,
    circuit: 'withdraw_unshielded_with_grant_jubjub',
    args: [],
    witnessValues: [],
    authNonce: 0n,
    useCounter: 0n,
    challenge: () => new Uint8Array(32).fill(1),
  };
  for (const change of [
    { circuit: 'remove_device_with_jubjub' },
    { circuit: 'issue_grant_with_jubjub' },
    { circuit: 'withdraw_unshielded_with_jubjub' },
    { account: 'ff'.repeat(32) },
  ])
    await assert.rejects(s.authoriser.authorise({ ...request, ...change }), /cannot authorize/);
  time = context.expiresAt;
  await assert.rejects(s.authoriser.devicePublicKey(), /locked or expired/);
  assert.ok(retained.every((b) => b === 0));
  time = 1000;
  assert.ok(s.authoriser.withKeySession);
  await assert.rejects(
    s.authoriser.withKeySession(async () => {}),
    /locked or expired/,
  );
  const bytes = new Uint8Array(32).fill(8);
  const locked = await createSessionJubjubAuthoriser(
    { ...source(), deriveSecret: async () => bytes },
    pureCircuits,
    context,
    () => 1000,
  );
  locked.dispose();
  locked.dispose();
  assert.ok(bytes.every((b) => b === 0));
  await assert.rejects(locked.authoriser.devicePublicKey(), /locked or expired/);
});

test('rollback, expired derivation and malformed lifetime cannot return a usable key', async () => {
  let time = 1000;
  const key = await createSessionJubjubAuthoriser(source(), pureCircuits, context, () => time);
  time = 999;
  await assert.rejects(key.authoriser.devicePublicKey(), /locked or expired/);
  for (const expiresAt of [1000, 1_802_000, NaN])
    await assert.rejects(
      createSessionJubjubAuthoriser(source(), pureCircuits, { ...context, expiresAt }, () => 1000),
    );
  let bytes = new Uint8Array(0);
  time = 1000;
  await assert.rejects(
    createSessionJubjubAuthoriser(
      {
        ...source(),
        deriveSecret: async () => {
          bytes = new Uint8Array(32).fill(8);
          time = 900_000;
          return bytes;
        },
      },
      pureCircuits,
      context,
      () => time,
    ),
    /locked or expired/,
  );
  assert.ok(bytes.every((b) => b === 0));
});
