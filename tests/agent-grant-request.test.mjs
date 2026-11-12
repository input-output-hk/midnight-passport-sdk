import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { jubjub } from '@noble/curves/misc.js';
import {
  grantOriginHash,
  grantRequestDigest,
  issueJubjubGrantCall,
  prepareJubjubGrant,
  verifyAgentJubjubGrantRequest,
} from '../packages/account/dist/index.js';
import {
  browserGrantRequestDigest,
  verifyBrowserP256GrantRequest,
} from '../packages/adapter-webauthn/dist/index.js';
import { generatedGrantAccount } from './fixtures/generated-grant-account.mjs';
import { pureCircuits } from '../packages/contract/generated/acc-s3r1.1/index.js';

const account = '17'.repeat(32);
const authoriserOrigin = 'https://passport.example';
const nowSeconds = 1_790_000_000;
const context = { account, authoriserOrigin, networkId: 'undeployed', nowSeconds };
const order = 0xe7db4ea6533afa906673b0101343b00a6682093ccc81082d0970e5ed6f72cb7n;

/** @param {bigint} value */
const le = (value) => Buffer.from(value.toString(16).padStart(64, '0'), 'hex').reverse();
/** @param {{x: bigint, y: bigint}} point */
const affine = ({ x, y }) => Buffer.concat([le(x), le(y)]).toString('hex');
/** @param {unknown} value */
const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');

/** @param {string} parameter */
function referenceDigest(parameter) {
  const domain = Buffer.alloc(64);
  domain.write('midnight:account:grant:request:v1');
  return createHash('sha256').update(domain).update(parameter, 'ascii').digest();
}

function request() {
  return {
    v: 1,
    chain: 'midnight:undeployed',
    aud: authoriserOrigin,
    iat: nowSeconds - 1,
    exp: nowSeconds + 90,
    client_id: 'rdns:com.example.agent',
    account,
    grantee: {
      scheme: 'schnorr_jubjub',
      pk: affine(pureCircuits.compute_public_point_with_jubjub(7n)),
    },
    grants: [
      {
        slot: 7,
        scope: ['midnight:account:withdraw_unshielded'],
        bounds: {
          color: '00'.repeat(32),
          per_call_cap: '1',
          cap: '10',
          max_coin_value: '10',
          expires_at: nowSeconds + 300,
          recipient: { kind: 'user', value: '72'.repeat(32) },
        },
      },
    ],
    nonce: '3c'.repeat(32),
  };
}

/**
 * Independent Node SHA-256 and the shipped Compact public point function.
 * @param {string} requestParam
 * @param {string} publicKey
 * @param {ReturnType<typeof jubjub.Point.fromAffine>} [base]
 */
function makeProof(requestParam, publicKey, base) {
  const nonce = 11n;
  const point = base
    ? base.multiply(nonce).toAffine()
    : pureCircuits.compute_public_point_with_jubjub(nonce);
  const r = affine(point);
  const digest = createHash('sha256')
    .update(Buffer.from(r, 'hex'))
    .update(Buffer.from(publicKey, 'hex'))
    .update(referenceDigest(requestParam))
    .digest()
    .reverse()
    .toString('hex');
  const c = BigInt('0x' + digest) % order;
  return {
    type: 'signature',
    key_signature: r + le((nonce + c * 7n) % order).toString('hex'),
  };
}

/** @param {Omit<ReturnType<typeof request>, 'account'> & {account?: string}} [value] */
function packet(value = request()) {
  const encoded = encode(value);
  return { request: encoded, proof: encode(makeProof(encoded, value.grantee.pk)) };
}

/** @param {unknown} input @param {typeof context} [pins] */
function rejects(input, pins = context) {
  assert.throws(() => verifyAgentJubjubGrantRequest(input, pins), {
    code: 'GrantScopeInvalid',
    message: 'Invalid or unsupported agent grant request.',
  });
}

test('agent verification hashes the original wire and binds a signed slot to generated ACC preparation', () => {
  const input = packet();
  const verified = verifyAgentJubjubGrantRequest(input, context);
  assert.equal(verified.requestDigest, referenceDigest(input.request).toString('hex'));
  assert.deepEqual(grantRequestDigest(input.request), browserGrantRequestDigest(input.request));
  assert.equal(verified.account, account);
  assert.equal(verified.accountSource, 'signed-request');
  const { account: signedAccount, ...withoutAccount } = request();
  assert.equal(signedAccount, account);
  const selected = verifyAgentJubjubGrantRequest(packet(withoutAccount), context);
  assert.equal(selected.account, account);
  assert.equal(selected.accountSource, 'owner-selected');
  assert.equal(verified.networkId, 'undeployed');
  assert.equal(verified.clientId, 'rdns:com.example.agent');
  assert.equal(verified.identity, 'operator-asserted');
  assert.equal(verified.slot, 7);
  assert.equal(Object.isFrozen(verified.scope.recipient), true);
  const prepare = {
    account,
    origin: verified.clientId,
    requestedSlot: verified.slot,
    nowSeconds,
    activeGrantIds: [],
    scope: verified.scope,
  };
  const prepared = prepareJubjubGrant(prepare, pureCircuits, () => Buffer.alloc(32, 5));
  assert.equal(prepared.slot, 7);
  const expected = pureCircuits.derive_grant_id_with_jubjub(
    { bytes: Buffer.from(account, 'hex') },
    pureCircuits.compute_public_point_with_jubjub(7n),
    grantOriginHash(verified.clientId),
    7n,
  );
  assert.equal(prepared.grantId, Buffer.from(expected).toString('hex'));
  assert.throws(
    () => prepareJubjubGrant({ ...prepare, activeGrantIds: [prepared.grantId] }, pureCircuits),
    {
      code: 'GrantLimitReached',
    },
  );
  assert.throws(() => prepareJubjubGrant({ ...prepare, requestedSlot: NaN }, pureCircuits), {
    code: 'GrantScopeInvalid',
  });
  for (const [client_id, identity] of /** @type {const} */ ([
    ['mais:agent_1', 'operator-asserted'],
    ['self:owner-test', 'owner-label'],
  ])) {
    assert.equal(
      verifyAgentJubjubGrantRequest(packet({ ...request(), client_id }), context).identity,
      identity,
    );
  }
});

test('agent proof refuses serialization changes, wrong generators, invalid points and noncanonical scalars', () => {
  const valid = packet();
  const value = request();
  rejects({ ...valid, request: Buffer.from(JSON.stringify(value, null, 2)).toString('base64url') });
  const substitutedKey = affine(pureCircuits.compute_public_point_with_jubjub(8n));
  rejects(packet({ ...value, grantee: { ...value.grantee, pk: substitutedKey } }));
  const wrongKey = affine(jubjub.Point.BASE.multiply(7n).toAffine());
  const wrongRequest = encode({ ...value, grantee: { ...value.grantee, pk: wrongKey } });
  rejects({
    request: wrongRequest,
    proof: encode(makeProof(wrongRequest, wrongKey, jubjub.Point.BASE)),
  });
  const key = jubjub.Point.fromAffine(pureCircuits.compute_public_point_with_jubjub(7n));
  const mixed = key.add(jubjub.Point.fromAffine({ x: 0n, y: jubjub.Point.Fp.ORDER - 1n }));
  const noncanonical = le(jubjub.Point.Fp.ORDER).toString('hex') + '00'.repeat(32);
  for (const pk of [
    affine({ x: 0n, y: 1n }),
    affine(mixed.toAffine()),
    noncanonical,
    '00'.repeat(64),
  ]) {
    rejects(packet({ ...value, grantee: { ...value.grantee, pk } }));
  }
  const proof = makeProof(valid.request, value.grantee.pk);
  for (const key_signature of [
    proof.key_signature.slice(0, 128) + le(order).toString('hex'),
    affine({ x: 0n, y: 1n }) + proof.key_signature.slice(128),
    proof.key_signature.slice(0, 191) + (proof.key_signature.endsWith('0') ? '1' : '0'),
  ])
    rejects({ ...valid, proof: encode({ ...proof, key_signature }) });
});

test('agent admission refuses browser transport, redirects, duplicates and mismatched or expired intent', () => {
  const valid = packet();
  const value = request();
  const fragment = '#request=' + valid.request + '&proof=' + valid.proof;
  rejects(fragment);
  assert.throws(() => verifyBrowserP256GrantRequest(fragment, context), {
    code: 'GrantScopeInvalid',
  });
  for (const unsupported of [
    { ...value, redirect_uri: 'https://bank.example/callback' },
    { ...value, state: 'm'.repeat(22) },
    { ...value, client_id: 'https://bank.example' },
    { ...value, client_id: 'rdns:com.example\n' },
    { ...value, client_id: 'rdns:-bad.example' },
    { ...value, client_id: 'mais:UPPER' },
    { ...value, client_id: 'self:' },
    { ...value, exp: nowSeconds - 1 },
    { ...value, iat: nowSeconds + 1 },
    { ...value, exp: nowSeconds + 601 },
    { ...value, chain: 'midnight:mainnet' },
    { ...value, aud: 'https://other.example' },
    { ...value, account: 'ff'.repeat(32) },
  ])
    rejects(packet(unsupported));
  const duplicate = Buffer.from(
    JSON.stringify(value).replace('"slot":7', '"slot":7,"\\u0073lot":7'),
  ).toString('base64url');
  rejects({ request: duplicate, proof: encode(makeProof(duplicate, value.grantee.pk)) });
  rejects({
    ...valid,
    proof: encode({ ...makeProof(valid.request, value.grantee.pk), type: 'webauthn' }),
  });
  rejects({ ...valid, request: valid.request + '=' });
  rejects({ ...valid, proof: 'A'.repeat(8193) });
  rejects({ ...valid, proof: Buffer.from([0xc3, 0x28]).toString('base64url') });
  rejects(valid, { ...context, authoriserOrigin: authoriserOrigin + '/' });
});

test('a verified agent scope reaches the generated ACC issue circuit under the owner key', async () => {
  const { sim, account, initial, chain, journal } = await generatedGrantAccount('jubjub');
  assert.ok(initial.records && initial.grants && initial.grantJournal && initial.directory);
  const identity = await initial.credentials.identify();
  const hint = await initial.directory.get(initial.network.networkId, {
    kind: 'credential-id',
    credentialId: identity.credentialId,
  });
  assert.ok(hint);
  const draft = request();
  const verified = verifyAgentJubjubGrantRequest(
    packet({
      ...draft,
      account,
      chain: initial.network.networkId,
      iat: sim.now - 1,
      exp: sim.now + 60,
      grants: draft.grants.map((grant) => ({
        ...grant,
        bounds: { ...grant.bounds, expires_at: sim.now + 300 },
      })),
    }),
    { ...context, account, networkId: initial.network.networkId, nowSeconds: sim.now },
  );
  const result = await issueJubjubGrantCall(
    {
      hint,
      origin: verified.clientId,
      requestedSlot: verified.slot,
      scope: verified.scope,
    },
    {
      bindingId: 'acc-s3r1.1',
      pure: pureCircuits,
      chain,
      authoriser: initial.authoriser,
      records: initial.records,
      grants: initial.grants,
      journal: initial.grantJournal,
      nowSeconds: () => sim.now,
    },
  );
  assert.equal(result.slot, 7);
  assert.equal(journal.get(result.grantId)?.origin, verified.clientId);
  assert.equal(journal.get(result.grantId)?.bookkeeping.slot, verified.slot);
  assert.ok((await initial.grants.readActiveGrantSnapshot(account)).ids.includes(result.grantId));
});
