import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import { test, type TestContext } from 'node:test';
import {
  browserGrantRequestDigest,
  clientDataJSON,
  verifyBrowserP256GrantRequest,
  webauthnPolicy,
} from '@input-output-hk/mn-passport-adapter-webauthn';
import { openDemoBrowserGrantRelay } from '../src/browser-grant-relay.js';

const issuer = 'https://passport.test';
const holderOrigin = 'https://bank.example1';
const account = '31'.repeat(32);
const now = 1794449000;
const requestId = '0b2b9d8a-87b9-46d0-9e90-2c8d493abeb7';
const session = randomBytes(32).toString('base64url');
const original = {
  requestId,
  address: account,
  intentSha256: '13'.repeat(32),
  validUntilSeconds: now + 20,
  circuit: 'issue_grant_with_p256',
};

function software(origin: string) {
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const jwk = publicKey.export({ format: 'jwk' });
  const x = Buffer.from(jwk.x!, 'base64url');
  const y = Buffer.from(jwk.y!, 'base64url');
  const policy = webauthnPolicy(new URL(origin).hostname, origin);
  const credentialId = Uint8Array.from([7, 12, 19]);
  return {
    wire: Buffer.concat([Buffer.from(x).reverse(), Buffer.from(y).reverse()]).toString('hex'),
    credential: {
      credentialId,
      policy,
      publicKey: {
        x: BigInt('0x' + x.toString('hex')),
        y: BigInt('0x' + y.toString('hex')),
        identity: false as const,
      },
    },
    assert(challenge: Uint8Array) {
      const client = clientDataJSON(challenge, policy.origin);
      const auth = Buffer.concat([policy.rp_id_hash, Buffer.from([5, 0, 0, 0, 0])]);
      const signature = sign(
        'sha256',
        Buffer.concat([auth, createHash('sha256').update(client).digest()]),
        privateKey,
      );
      return { client, auth, signature };
    },
  };
}

function holderRequest() {
  const holder = software(holderOrigin);
  const request = Buffer.from(
    JSON.stringify({
      v: 1,
      chain: 'undeployed',
      aud: issuer,
      iat: now,
      exp: now + 20,
      client_id: holderOrigin,
      redirect_uri: holderOrigin + '/return',
      account,
      grantee: { scheme: 'ecdsa_secp256r1_webauthn', pk: holder.wire },
      grants: [
        {
          slot: 7,
          scope: ['midnight:account:withdraw_unshielded'],
          bounds: {
            color: '00'.repeat(32),
            per_call_cap: '1',
            cap: '10',
            max_coin_value: '10',
            expires_at: now + 60,
            recipient: { kind: 'user', value: '72'.repeat(32) },
          },
        },
      ],
      state: Buffer.alloc(16, 3).toString('base64url'),
      nonce: '51'.repeat(32),
    }),
  ).toString('base64url');
  const proof = holder.assert(browserGrantRequestDigest(request));
  const encoded = Buffer.from(
    JSON.stringify({
      type: 'webauthn',
      client_data_json: Buffer.from(proof.client).toString('base64url'),
      authenticator_data: proof.auth.toString('base64url'),
      signature: proof.signature.toString('base64url'),
    }),
  ).toString('base64url');
  return '#request=' + request + '&proof=' + encoded;
}

function fixture(t: TestContext) {
  t.mock.timers.enable({ apis: ['Date'], now: now * 1000 });
  const location = Object.getOwnPropertyDescriptor(globalThis, 'location');
  Object.defineProperty(globalThis, 'location', {
    configurable: true,
    value: new URL(issuer),
  });
  t.after(() => {
    if (location) Object.defineProperty(globalThis, 'location', location);
    else Reflect.deleteProperty(globalThis, 'location');
  });
  const fragment = holderRequest();
  const signed = verifyBrowserP256GrantRequest(fragment, {
    account,
    networkId: 'undeployed',
    authoriserOrigin: issuer,
    nowSeconds: now,
  });
  const intent = {
    issuer,
    account,
    networkId: 'undeployed',
    requestDigest: signed.requestDigest,
    validUntilSeconds: signed.validUntilSeconds,
    nonce: signed.nonce,
  };
  const owner = software(issuer);
  const challenge = randomBytes(32);
  const ticket = randomBytes(32).toString('base64url');
  const calls: string[] = [];
  const ceremonies: string[] = [];
  let gets = 0;
  let retained = false;
  let stale = false;
  let dropClaim = false;
  const credentials: CredentialsContainer = {
    async get(options) {
      gets++;
      assert.equal(options?.publicKey?.rpId, 'passport.test');
      assert.deepEqual(
        options?.publicKey?.allowCredentials?.[0]?.id,
        owner.credential.credentialId,
      );
      const result = owner.assert(new Uint8Array(options?.publicKey?.challenge as Uint8Array));
      return {
        rawId: owner.credential.credentialId.buffer,
        response: {
          clientDataJSON: result.client,
          authenticatorData: result.auth,
          signature: result.signature,
        },
      } as unknown as Credential;
    },
    async create() {
      throw new Error('Unexpected create');
    },
    async preventSilentAccess() {},
    async store() {},
  };
  const request: typeof fetch = async (url, init) => {
    const target = new URL(String(url));
    assert.equal(target.origin, issuer);
    assert.equal(init?.mode, 'same-origin');
    assert.equal(init?.redirect, 'error');
    assert.equal(init?.credentials, 'omit');
    assert.equal(init?.referrerPolicy, 'no-referrer');
    const action = target.pathname.slice('/v1/browser-grant/'.length);
    calls.push(action);
    const headers = new Headers(init?.headers);
    const body = JSON.parse(String(init?.body));
    if (action.startsWith('session/')) {
      assert.equal(headers.has('authorization'), false);
      assert.equal(body.credentialId, '070c13');
      if (action.endsWith('challenge'))
        return Response.json({
          challenge: challenge.toString('base64url'),
          ticket,
          expiresAt: now + 60,
        });
      assert.equal(body.challengeTicket, ticket);
      assert.equal(body.challengeExpiresAt, now + 60);
      assert.equal(body.clientDataJSON.length, 268);
      return Response.json({ session, expiresAt: now + 300 });
    }
    assert.equal(headers.get('authorization'), 'PassportGrant ' + session);
    assert.equal(body.fragment, fragment);
    if (action === 'claim') {
      const first = !retained;
      retained = true;
      if (dropClaim) throw new Error('PRIVATE PAYLOAD');
      return Response.json({ requestId, first });
    }
    if (action === 'read') return Response.json(retained ? { requestId } : {});
    assert.equal(body.requestId, requestId);
    assert.equal(body.intentSha256, original.intentSha256);
    if (action === 'execute') {
      assert.equal(body.proved, 'ab');
      throw new Error('PRIVATE PAYLOAD');
    }
    assert.equal(action, 'reconcile');
    assert.equal('proved' in body, false);
    return Response.json({ txHash: '43'.repeat(32), blockHeight: 7 });
  };
  return {
    intent,
    calls,
    ceremonies,
    gets: () => gets,
    dropClaim: () => {
      dropClaim = true;
    },
    options: {
      issuer,
      account,
      fragment,
      credentials,
      fetch: request,
      credential: owner.credential,
      beforeCeremony: async ({ purpose }: { purpose: string }) => {
        ceremonies.push(purpose);
      },
      checkCurrent() {
        if (stale) throw new Error('Selection changed');
      },
    },
    stale: () => {
      stale = true;
    },
  };
}

test('browser grant transport sends the approved original once and reconciles after expiry', async (t) => {
  const f = fixture(t);
  const relay = await openDemoBrowserGrantRelay(f.options);
  assert.deepEqual(f.ceremonies, ['authenticate-grant-relay']);
  assert.deepEqual(await relay.nonces.claim(f.intent), { requestId, first: true });
  await assert.rejects(relay.sponsor.execute(new Uint8Array([0xab]), original), {
    code: 'MutationUnsettled',
  });
  await assert.rejects(relay.sponsor.execute(new Uint8Array([0xcd]), original), {
    code: 'MutationUnsettled',
  });
  t.mock.timers.setTime((now + 65) * 1000);
  assert.deepEqual(await relay.reconcile(requestId, original.intentSha256), {
    txHash: '43'.repeat(32),
    blockHeight: 7,
  });
  assert.deepEqual(f.calls, [
    'session/challenge',
    'session/verify',
    'claim',
    'execute',
    'reconcile',
  ]);
  relay.close();
  await assert.rejects(relay.nonces.read(f.intent), { code: 'MutationUnsettled' });
});

test('a lost nonce response can recover the UUID without permitting issue', async (t) => {
  const f = fixture(t);
  f.dropClaim();
  const relay = await openDemoBrowserGrantRelay(f.options);
  await assert.rejects(relay.nonces.claim(f.intent), { code: 'MutationUnsettled' });
  assert.deepEqual(await relay.nonces.claim(f.intent), { requestId, first: false });
  await assert.rejects(relay.sponsor.execute(new Uint8Array([0xab]), original), {
    code: 'MutationUnsettled',
  });
  assert.deepEqual(f.calls, ['session/challenge', 'session/verify', 'claim', 'read']);
  relay.close();
});

test('a changed selected owner during consent prevents credential access', async (t) => {
  const f = fixture(t);
  await assert.rejects(
    openDemoBrowserGrantRelay({
      ...f.options,
      beforeCeremony: async () => f.stale(),
    }),
  );
  assert.equal(f.gets(), 0);
  assert.deepEqual(f.calls, ['session/challenge']);
});
