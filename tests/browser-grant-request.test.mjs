import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { p256 } from '@noble/curves/nist.js';
import {
  browserGrantRequestDigest,
  verifyBrowserP256GrantRequest,
} from '../packages/adapter-webauthn/dist/index.js';

const authoriserOrigin = 'https://passport.example';
const client = 'https://bank.example1';
const account = 'aa'.repeat(32);
const nowSeconds = 1_790_000_000;
const context = { authoriserOrigin, networkId: 'undeployed', account, nowSeconds };
const key = new Uint8Array(32).fill(5);
const point = p256.Point.fromBytes(p256.getPublicKey(key));
const uncompressed = point.toBytes(false);
const wireKey = Buffer.concat([
  uncompressed.slice(1, 33).reverse(),
  uncompressed.slice(33).reverse(),
]).toString('hex');
const rpHash = createHash('sha256').update(new URL(client).hostname).digest();

/** @param {unknown} value */
const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');

function request() {
  return {
    v: 1,
    chain: 'midnight:undeployed',
    aud: authoriserOrigin,
    iat: nowSeconds - 1,
    exp: nowSeconds + 30,
    client_id: client,
    redirect_uri: client + '/passport/callback?flow=test',
    account,
    grantee: { scheme: 'ecdsa_secp256r1_webauthn', pk: wireKey },
    grants: [
      {
        slot: 7,
        scope: ['midnight:account:withdraw_unshielded'],
        bounds: {
          color: '00'.repeat(32),
          per_call_cap: '1',
          cap: '10',
          max_coin_value: '10',
          expires_at: nowSeconds + 90,
          recipient: { kind: 'user', value: 'ab'.repeat(32) },
        },
      },
    ],
    state: Buffer.alloc(16, 8).toString('base64url'),
    nonce: '45'.repeat(32),
  };
}

/** @param {string} parameter */
function referenceDigest(parameter) {
  const prefix = Buffer.alloc(64);
  prefix.write('midnight:account:grant:request:v1');
  return createHash('sha256').update(prefix).update(parameter, 'ascii').digest();
}

/** @param {string} parameter */
function proof(parameter, origin = client, authenticatorHash = rpHash, flags = 5) {
  const clientData = Buffer.from(
    JSON.stringify({
      type: 'webauthn.get',
      challenge: referenceDigest(parameter).toString('base64url'),
      origin,
      crossOrigin: false,
    }),
  );
  const authenticatorData = Buffer.concat([authenticatorHash, Buffer.from([flags, 0, 0, 0, 0])]);
  const message = Buffer.concat([
    authenticatorData,
    createHash('sha256').update(clientData).digest(),
  ]);
  return {
    type: 'webauthn',
    client_data_json: clientData.toString('base64url'),
    authenticator_data: authenticatorData.toString('base64url'),
    signature: Buffer.from(p256.sign(message, key, { format: 'der' })).toString('base64url'),
  };
}

/** @param {string} parameter */
const fragment = (parameter, signedProof = proof(parameter)) =>
  '#request=' + parameter + '&proof=' + encode(signedProof);

test('verifies a direct browser grantee against the exact request and maps the pinned scope', () => {
  const input = request();
  const wire = Buffer.from(JSON.stringify(input, null, 2)).toString('base64url');
  assert.deepEqual(Buffer.from(browserGrantRequestDigest(wire)), referenceDigest(wire));
  const result = verifyBrowserP256GrantRequest(fragment(wire), context);
  assert.deepEqual(result, {
    requestDigest: referenceDigest(wire).toString('hex'),
    nonce: input.nonce,
    validUntilSeconds: input.exp,
    redirectUri: input.redirect_uri,
    slot: 7,
    state: input.state,
    scope: {
      account,
      grantee: {
        scheme: 'p256-webauthn',
        publicKey: Buffer.from(point.toBytes(true)).toString('hex'),
        origin: client,
        rpIdHash: rpHash.toString('hex'),
      },
      color: '00'.repeat(32),
      recipient: 'ab'.repeat(32),
      maxCoinValue: '10',
      perCallCap: '1',
      cap: '10',
      expiresAt: nowSeconds + 90,
    },
  });
  assert.equal(Reflect.set(result.scope.grantee, 'origin', authoriserOrigin), false);
  const { account: _, ...withoutAccount } = input;
  const wireBare = encode({ ...withoutAccount, chain: 'undeployed' });
  assert.equal(verifyBrowserP256GrantRequest(fragment(wireBare), context).scope.account, account);
});

test('refuses transformed, duplicate, and malformed wire members', () => {
  const input = request();
  const wire = encode(input);
  const originalProof = proof(wire);
  const duplicate = Buffer.from(
    JSON.stringify(input).replace('"slot":7', '"slot":7,"\\u0073lot":7'),
  ).toString('base64url');
  const duplicateProof = Buffer.from(
    JSON.stringify(originalProof).replace('"type":', '"type":"webauthn","type":'),
  ).toString('base64url');
  for (const value of [
    fragment(Buffer.from(JSON.stringify(input, null, 2)).toString('base64url'), originalProof),
    fragment(duplicate),
    '#request=' + wire + '&proof=' + duplicateProof,
    fragment(wire) + '&proof=' + encode(originalProof),
    fragment(wire) + '\n',
    fragment(wire).replace('#request=', '#request=%45'),
    fragment(wire).replace('#request=', '#request=='),
    fragment(encode({ ...input, unexpected: true })),
    fragment(encode({ ...input, nonce: input.nonce + '\n' })),
  ]) {
    assert.throws(() => verifyBrowserP256GrantRequest(value, context), {
      code: 'GrantScopeInvalid',
    });
  }
});

test('refuses the wrong origin, RP, user verification, chain, account or audience', () => {
  const wire = encode(request());
  for (const invalidProof of [
    proof(wire, 'https://attacker.test'),
    proof(wire, client, Buffer.alloc(32)),
    proof(wire, client, rpHash, 1),
    { ...proof(wire), type: 'signature' },
    { ...proof(wire), signature: proof(encode({ changed: true })).signature },
  ]) {
    assert.throws(() => verifyBrowserP256GrantRequest(fragment(wire, invalidProof), context), {
      code: 'GrantScopeInvalid',
    });
  }
  for (const otherContext of [
    { ...context, networkId: 'preview' },
    { ...context, account: 'bb'.repeat(32) },
    { ...context, authoriserOrigin: 'https://attacker.test' },
    { ...context, nowSeconds: nowSeconds + 31 },
    { ...context, nowSeconds: nowSeconds - 2 },
  ]) {
    assert.throws(() => verifyBrowserP256GrantRequest(fragment(wire), otherContext), {
      code: 'GrantScopeInvalid',
    });
  }
});

test('refuses unsafe redirects, invalid bounds and scope widening', () => {
  const input = request();
  const grant = input.grants[0];
  assert.ok(grant);
  for (const mutated of [
    { ...input, redirect_uri: client + '@attacker.test/path' },
    { ...input, redirect_uri: client + '/#fragment' },
    { ...input, redirect_uri: 'https://user@bank.example1/path' },
    { ...input, state: 'a'.repeat(22) },
    { ...input, exp: nowSeconds + 600 },
    { ...input, grants: [{ ...grant, scope: [...grant.scope, 'midnight:account:read'] }] },
    { ...input, grants: [{ ...grant, bounds: { ...grant.bounds, caller: 'bb'.repeat(32) } }] },
    { ...input, grants: [{ ...grant, bounds: { ...grant.bounds, expires_at: 0 } }] },
    { ...input, grants: [{ ...grant, bounds: { ...grant.bounds, cap: '0' } }] },
    {
      ...input,
      grants: [{ ...grant, bounds: { ...grant.bounds, cap: (1n << 128n).toString() } }],
    },
  ]) {
    assert.throws(() => verifyBrowserP256GrantRequest(fragment(encode(mutated)), context), {
      code: 'GrantScopeInvalid',
    });
  }
});
