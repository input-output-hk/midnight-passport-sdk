import assert from 'node:assert/strict';
import { test } from 'node:test';
import { jubjub } from '@noble/curves/misc.js';
import { createSessionJubjubAuthoriser } from '../packages/keys/dist/index.js';
import { prepareJubjubGrant } from '../packages/account/dist/index.js';
import { parseGrantU128 } from '../packages/account/dist/grant-decimal.js';
import { pureCircuits } from '../packages/contract/generated/acc-s3r1.1/index.js';

test('Node Buffer session derivations survive repeated key use and clear only at disposal', async () => {
  const derived = Buffer.alloc(32, 9);
  const session = await createSessionJubjubAuthoriser(
    {
      withSession: (work) => work(),
      deviceSecret: async () => {
        throw Error('Session must never request its owner key.');
      },
      deriveSecret: async () => derived,
    },
    pureCircuits,
    {
      account: '12'.repeat(32),
      networkId: 'undeployed',
      bindingId: 'acc-s3r1.1',
      origin: 'localhost',
      sessionId: '34'.repeat(32),
      expiresAt: 900_000,
    },
    () => 1000,
  );
  try {
    assert.ok(derived.every((byte) => byte === 9));
    assert.ok(session.authoriser.devicePublicKeyHex);
    for (let use = 0; use < 2; use++) {
      assert.equal(await session.authoriser.devicePublicKeyHex(), session.publicKey);
      assert.ok(
        derived.every((byte) => byte === 9),
        'temporary signer cleanup must not lock the session',
      );
    }
    const signature = await session.authoriser.authorise({
      account: '12'.repeat(32),
      circuit: 'withdraw_unshielded_with_grant_jubjub',
      args: [],
      witnessValues: [],
      authNonce: 0n,
      useCounter: 0n,
      challenge: () => Uint8Array.from({ length: 32 }, (_value, index) => (index === 0 ? 1 : 0)),
    });
    assert.equal(signature.scheme, 'jubjub-schnorr');
    assert.ok(derived.every((byte) => byte === 9));
    const publicKey = await session.authoriser.devicePublicKey();
    session.dispose();
    assert.ok(
      derived.every((byte) => byte === 0),
      'the provider derivation is adopted for disposal',
    );
    assert.equal(
      Buffer.from(jubjub.Point.fromAffine(publicKey).toBytes()).toString('hex'),
      session.publicKey,
    );
    await assert.rejects(session.authoriser.devicePublicKey(), /locked or expired/);
  } finally {
    session.dispose();
  }
});

test('grant decimal conversion bounds text first and preserves each existing encoding policy', () => {
  const maximum = ((1n << 128n) - 1n).toString();
  for (const value of ['0', '1', maximum]) assert.equal(parseGrantU128(value), BigInt(value));
  assert.equal(parseGrantU128('0001'), 1n);
  assert.equal(parseGrantU128('0001', true), undefined);
  for (const value of ['', '-1', '1e3', ' 1', '1\n', '1.0', (1n << 128n).toString(), null, 1])
    assert.equal(parseGrantU128(value), undefined);

  const nativeBigInt = globalThis.BigInt;
  let conversions = 0;
  globalThis.BigInt = Object.assign(
    (/** @type {Parameters<BigIntConstructor>[0]} */ value) => {
      conversions++;
      return nativeBigInt(value);
    },
    { asIntN: nativeBigInt.asIntN, asUintN: nativeBigInt.asUintN },
  );
  try {
    for (const value of ['9'.repeat(100_000), '0'.repeat(100_000), '1e3', '-1'])
      assert.equal(parseGrantU128(value), undefined);
    assert.equal(conversions, 0, 'oversized and malformed text must never reach BigInt');
  } finally {
    globalThis.BigInt = nativeBigInt;
  }
});

test('public grant preparation enforces u128 bounds for every cap before binding work', () => {
  const publicKey = Buffer.from(
    jubjub.Point.fromAffine(pureCircuits.compute_public_point_with_jubjub(7n)).toBytes(),
  ).toString('hex');
  const maximum = ((1n << 128n) - 1n).toString();
  const scope = {
    grantee: { scheme: /** @type {const} */ ('jubjub-schnorr'), publicKey },
    operations: /** @type {const} */ (['withdraw-unshielded']),
    color: '34'.repeat(32),
    recipient: { kind: /** @type {const} */ ('any') },
    maxCoinValue: maximum,
    perCallCap: maximum,
    cap: maximum,
    expiresAt: 2000,
  };
  const input = {
    account: '12'.repeat(32),
    origin: 'localhost',
    scope,
    activeGrantIds: [],
    nowSeconds: 1000,
  };
  const prepared = prepareJubjubGrant(input, pureCircuits, () => new Uint8Array(32).fill(9));
  assert.equal(prepared.scopeArgs[7], BigInt(maximum));
  for (const field of /** @type {const} */ (['maxCoinValue', 'perCallCap', 'cap'])) {
    for (const value of ['9'.repeat(100_000), (1n << 128n).toString(), '-1', '1e3']) {
      assert.throws(
        () => prepareJubjubGrant({ ...input, scope: { ...scope, [field]: value } }, pureCircuits),
        { code: 'GrantScopeInvalid' },
      );
    }
  }
  assert.throws(
    () => prepareJubjubGrant({ ...input, scope: { ...scope, cap: '0' } }, pureCircuits),
    { code: 'GrantScopeInvalid' },
  );
  const zero = prepareJubjubGrant(
    { ...input, scope: { ...scope, maxCoinValue: '0', perCallCap: '0', cap: '01' } },
    pureCircuits,
    () => new Uint8Array(32).fill(9),
  );
  assert.equal(zero.scopeArgs[7], 0n);
  assert.equal(zero.scopeArgs[8], 0n);
});
