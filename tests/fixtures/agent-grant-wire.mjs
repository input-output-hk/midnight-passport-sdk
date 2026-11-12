import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { jubjub } from '@noble/curves/misc.js';
import {
  createAgentGrantIssueJournal,
  createAgentGrantNonceStore,
} from '../../packages/account/dist/index.js';
import {
  fileMutationByteStore,
  protectedMutationByteStore,
} from '../../packages/service/dist/index.js';
import { pureCircuits } from '../../packages/contract/generated/acc-s3r1.1/index.js';
import { generatedGrantAccount } from './generated-grant-account.mjs';

export const account = '17'.repeat(32);
export const authoriserOrigin = 'https://passport.example';
export const nowSeconds = 1_790_000_000;
export const context = { account, authoriserOrigin, networkId: 'undeployed', nowSeconds };
export const order = 0xe7db4ea6533afa906673b0101343b00a6682093ccc81082d0970e5ed6f72cb7n;

/** @param {bigint} value */
export const le = (value) => Buffer.from(value.toString(16).padStart(64, '0'), 'hex').reverse();
/** @param {{x: bigint, y: bigint}} point */
export const affine = ({ x, y }) => Buffer.concat([le(x), le(y)]).toString('hex');
/** @param {unknown} value */
export const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');

/** @param {string} parameter */
export function referenceDigest(parameter) {
  const domain = Buffer.alloc(64);
  domain.write('midnight:account:grant:request:v1');
  return createHash('sha256').update(domain).update(parameter, 'ascii').digest();
}

export function request() {
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
export function makeProof(requestParam, publicKey, base) {
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
export function packet(value = request()) {
  const encoded = encode(value);
  return { request: encoded, proof: encode(makeProof(encoded, value.grantee.pk)) };
}

/** @param {'jubjub'|'p256'} [arm] */
export async function ownerFixture(arm = 'jubjub') {
  const fixture = await generatedGrantAccount(arm);
  const { sim, account, initial, chain, grants } = fixture;
  assert.ok(initial.records && initial.grantJournal && initial.directory);
  const identity = await initial.credentials.identify();
  const owner = await initial.directory.get(initial.network.networkId, {
    kind: 'credential-id',
    credentialId: identity.credentialId,
  });
  assert.ok(owner);
  const draft = request();
  const value = {
    ...draft,
    account,
    chain: initial.network.networkId,
    iat: sim.now - 1,
    exp: sim.now + 60,
    grants: draft.grants.map((grant) => ({
      ...grant,
      bounds: { ...grant.bounds, expires_at: sim.now + 300 },
    })),
  };
  return {
    fixture,
    value,
    ports: {
      owner,
      authoriserOrigin,
      networkId: initial.network.networkId,
      chain: {
        ...chain,
        submitDeadlineFencedGrantIssue: chain.call,
        networkId: initial.network.networkId,
        bindingId: 'acc-s3r1.1',
      },
      grants: grants({ readReadPublicKey: async () => undefined }),
      pure: pureCircuits,
      authoriser: initial.authoriser,
      records: initial.records,
      journal: initial.grantJournal,
      nowSeconds: () => sim.now,
      isCurrent: () => true,
    },
  };
}

/** @param {import('node:test').TestContext} t */
export async function storage(t) {
  const root = await mkdtemp(join(tmpdir(), 'passport-agent-grant-'));
  const key = new Uint8Array(32).fill(9);
  const protectedStore = protectedMutationByteStore(join(root, 'opening'), key);
  const bytes = fileMutationByteStore(join(root, 'nonces'));
  t.after(async () => {
    protectedStore.close();
    await rm(root, { recursive: true, force: true });
  });
  return {
    bytes,
    nonces: createAgentGrantNonceStore(bytes, randomUUID),
    originalIssues: createAgentGrantIssueJournal(protectedStore),
  };
}
