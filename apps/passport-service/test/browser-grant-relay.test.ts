import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';
import { z } from 'zod';
import {
  browserGrantRequestDigest,
  clientDataJSON,
  webauthnPolicy,
} from '@input-output-hk/mn-passport-adapter-webauthn';
import {
  createServer,
  fileMutationByteStore,
  serial,
  type Route,
} from '@input-output-hk/mn-passport-service';
import { loadConfig } from '../src/config.ts';
import { configuredHostMutations } from '../src/host-config.ts';
import { browserGrantRelay, type BrowserGrantRelayOptions } from '../src/routes/browser-grant.ts';

const issuer = 'https://passport.test';
const client = 'https://bank.example1';
const account = '43'.repeat(32);
const owner = '26'.repeat(32);
const time = 1794449000;
const intentSha256 = 'ab'.repeat(32);
const txHash = 'bc'.repeat(32);

function holder({ cap = '10', selected = account, nonce = '51'.repeat(32), issuedAt = time } = {}) {
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const jwk = publicKey.export({ format: 'jwk' });
  const key = Buffer.concat([
    Buffer.from(jwk.x!, 'base64url').reverse(),
    Buffer.from(jwk.y!, 'base64url').reverse(),
  ]);
  const request = Buffer.from(
    JSON.stringify({
      v: 1,
      chain: 'undeployed',
      aud: issuer,
      iat: issuedAt,
      exp: issuedAt + 20,
      client_id: client,
      redirect_uri: client + '/return',
      account: selected,
      grantee: { scheme: 'ecdsa_secp256r1_webauthn', pk: key.toString('hex') },
      grants: [
        {
          slot: 7,
          scope: ['midnight:account:withdraw_unshielded'],
          bounds: {
            color: '00'.repeat(32),
            per_call_cap: '1',
            cap,
            max_coin_value: '10',
            expires_at: issuedAt + 60,
            recipient: { kind: 'user', value: '72'.repeat(32) },
          },
        },
      ],
      state: Buffer.alloc(16, 3).toString('base64url'),
      nonce,
    }),
  ).toString('base64url');
  const rp = createHash('sha256').update(new URL(client).hostname).digest();
  const auth = Buffer.concat([rp, Buffer.from([5, 0, 0, 0, 0])]);
  const json = clientDataJSON(browserGrantRequestDigest(request), new TextEncoder().encode(client));
  const material = Buffer.concat([auth, createHash('sha256').update(json).digest()]);
  const proof = Buffer.from(
    JSON.stringify({
      type: 'webauthn',
      client_data_json: Buffer.from(json).toString('base64url'),
      authenticator_data: auth.toString('base64url'),
      signature: sign('sha256', material, privateKey).toString('base64url'),
    }),
  ).toString('base64url');
  return '#request=' + request + '&proof=' + proof;
}

async function relay(t: TestContext, options: BrowserGrantRelayOptions, route?: Route) {
  const server = createServer({ host: '127.0.0.1', corsOrigin: issuer }, [
    route ?? browserGrantRelay(options),
  ]);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address() as AddressInfo;
  const close = () => new Promise<void>((resolve) => server.close(() => resolve()));
  t.after(close);
  return {
    close,
    async send(action: string, body: unknown, headers?: Record<string, string>) {
      const response = await fetch(
        'http://127.0.0.1:' + address.port + '/v1/browser-grant/' + action,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            origin: issuer,
            'sec-fetch-site': 'same-origin',
            cookie: 'fixture-owner=valid',
            ...headers,
          },
          body: JSON.stringify(body),
        },
      );
      return {
        status: response.status,
        cache: response.headers.get('cache-control'),
        body: await response.json(),
      };
    },
  };
}

async function fixture(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), 'passport-browser-grant-relay-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  let credential = owner;
  let alive = true;
  let current = time;
  let issued = 0;
  let observed = 0;
  const options: BrowserGrantRelayOptions = {
    issuer,
    store: fileMutationByteStore(directory),
    nowSeconds: () => current,
    async authenticate(request, selected) {
      if (request.headers.cookie !== 'fixture-owner=valid' || selected !== account) return;
      return {
        credential,
        account,
        networkId: 'undeployed',
        bindingId: 'acc-s3r1.1',
        current: async () => alive,
      };
    },
    sponsor: {
      async execute(proved, request) {
        issued++;
        assert.deepEqual(proved, Buffer.from('abcd', 'hex'));
        assert.equal(request.address, account);
        assert.equal(request.circuit, 'issue_grant_with_p256');
        assert.equal(request.validUntilSeconds, time + 20);
        throw new Error('Original response lost');
      },
      async reconcile(request) {
        observed++;
        assert.equal(request.intentSha256, intentSha256);
        return { txHash, blockHeight: 3, privateInput: 'redact' };
      },
    },
  };
  return {
    options,
    changeOwner: () => {
      credential = '34'.repeat(32);
    },
    revoke: () => {
      alive = false;
    },
    advance: () => {
      current = time + 25;
    },
    expireGrant: () => {
      current = time + 65;
    },
    counts: () => [issued, observed],
  };
}

test('browser relay requires same origin and a live account-bound owner before nonce admission', async (t) => {
  const f = await fixture(t);
  const host = await relay(t, f.options);
  const input = { account, fragment: holder() };
  assert.equal((await host.send('claim', input, { origin: 'https://wrong.example' })).status, 403);
  assert.equal((await host.send('claim', input, { 'sec-fetch-site': 'cross-site' })).status, 403);
  assert.equal((await host.send('claim', input, { cookie: '' })).status, 401);
  assert.equal(
    (await host.send('claim', { ...input, fragment: holder({ selected: '78'.repeat(32) }) }))
      .status,
    400,
  );
  assert.equal((await host.send('claim?fragment=private', input)).status, 404);
  f.revoke();
  assert.equal((await host.send('claim', input)).status, 401);
  assert.deepEqual(f.counts(), [0, 0]);
});

test('browser relay fences the proved original and recovers it across restart after request expiry', async (t) => {
  const f = await fixture(t);
  const host = await relay(t, f.options);
  const input = { account, fragment: holder() };
  const claims = await Promise.all([host.send('claim', input), host.send('claim', input)]);
  const admissions = claims.map(({ body }) =>
    z.object({ requestId: z.uuid(), first: z.boolean() }).parse(body),
  );
  assert.equal(admissions.filter(({ first }) => first).length, 1);
  const { requestId } = admissions[0]!;
  assert.equal(admissions[1]!.requestId, requestId);
  const dispatch = { ...input, requestId, intentSha256, proved: 'abcd' };
  assert.equal((await host.send('execute', { ...dispatch, requestId: randomUUID() })).status, 409);
  assert.equal((await host.send('reconcile', { ...input, requestId, intentSha256 })).status, 409);
  assert.deepEqual(f.counts(), [0, 0]);
  const racing = await Promise.all([
    host.send('execute', dispatch),
    host.send('execute', dispatch),
  ]);
  assert.deepEqual(
    racing.map(({ status }) => status),
    [409, 409],
  );
  assert.deepEqual(f.counts(), [1, 0]);
  await host.close();
  f.advance();
  const restarted = await relay(t, f.options);
  assert.equal((await restarted.send('execute', { ...dispatch, proved: 'ffff' })).status, 409);
  assert.equal((await restarted.send('claim', input)).status, 409);
  assert.equal(
    (await restarted.send('reconcile', { ...input, requestId, intentSha256: 'aa'.repeat(32) }))
      .status,
    409,
  );
  const recovered = await restarted.send('reconcile', { ...input, requestId, intentSha256 });
  assert.deepEqual(recovered, { status: 200, cache: 'no-store', body: { txHash, blockHeight: 3 } });
  f.expireGrant();
  assert.deepEqual(
    (await restarted.send('reconcile', { ...input, requestId, intentSha256 })).body,
    { txHash, blockHeight: 3 },
  );
  assert.equal((await restarted.send('execute', dispatch)).status, 400);
  f.changeOwner();
  assert.equal(
    (await restarted.send('reconcile', { ...input, requestId, intentSha256 })).status,
    409,
  );
  assert.deepEqual(f.counts(), [1, 2]);
});

test('browser relay refuses a changed request under the same signed nonce', async (t) => {
  const f = await fixture(t);
  const host = await relay(t, f.options);
  assert.equal((await host.send('claim', { account, fragment: holder() })).status, 200);
  assert.equal((await host.send('claim', { account, fragment: holder({ cap: '2' }) })).status, 409);
  assert.deepEqual(f.counts(), [0, 0]);
});

test('live owner authorization is rechecked after wallet preparation and the original can recover', async (t) => {
  const f = await fixture(t);
  const directory = await mkdtemp(join(tmpdir(), 'passport-browser-grant-host-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  t.mock.timers.enable({ apis: ['Date'], now: time * 1000 });
  const keyFile = join(directory, 'host-key');
  const tokenFile = join(directory, 'host-token');
  await writeFile(keyFile, '31'.repeat(32), { mode: 0o600 });
  await writeFile(tokenFile, '32'.repeat(32), { mode: 0o600 });
  const env = {
    PASSPORT_CONTRACT_DIR: directory,
    PASSPORT_MANIFEST_SHA256: '77fb9c17b0d59047456c43115d9a58f5cb99a226ee73b6b974fd724930c3153f',
    PASSPORT_DAPP_ORIGIN: issuer,
    PASSPORT_HOST_GRANT_ISSUE: '1',
    PASSPORT_HOST_MUTATION_DIR: join(directory, 'host'),
    PASSPORT_HOST_MUTATION_KEY_FILE: keyFile,
    PASSPORT_HOST_MUTATION_TOKEN_FILE: tokenFile,
    PASSPORT_BROWSER_GRANT_DIR: join(directory, 'relay'),
  };
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const jwk = publicKey.export({ format: 'jwk' });
  const policy = webauthnPolicy(new URL(issuer).hostname, issuer);
  const credentialId = '33'.repeat(20);
  const selected = { account, credentialId };
  let enrolled = true;
  let submissions = 0;
  const watchId = 'cd'.repeat(32);
  const mounted = configuredHostMutations(
    loadConfig(env),
    {
      async prepare() {
        return { address: account, steps: 1, context: { fixture: true } };
      },
      async prepareStep() {
        enrolled = false;
        return { tx: 'abcd', identifiers: [watchId] };
      },
      async check() {
        return true;
      },
      async submit() {
        submissions++;
        t.mock.timers.setTime((time + 301) * 1000);
        return watchId;
      },
      async lookup() {
        return { identifier: watchId, txHash, succeeded: true };
      },
    },
    env,
    serial(4),
    () => {},
    async (candidate) => {
      if (!enrolled || candidate.account !== account || candidate.credentialId !== credentialId)
        return undefined;
      return {
        policy,
        deviceEpoch: 0n,
        publicKey: {
          x: BigInt('0x' + Buffer.from(jwk.x!, 'base64url').toString('hex')),
          y: BigInt('0x' + Buffer.from(jwk.y!, 'base64url').toString('hex')),
          identity: false,
        },
      };
    },
  );
  assert.ok(mounted);
  t.after(() => mounted.close());
  const host = await relay(t, f.options, mounted);
  // Unauthenticated clients cannot exhaust the process-wide challenge store.
  for (let index = 0; index < 129; index++) {
    assert.equal((await host.send('session/challenge', selected)).status, 200);
  }
  async function authenticate() {
    const challengeReply = await host.send('session/challenge', selected);
    const { challenge, expiresAt, ticket } = z
      .object({ challenge: z.string(), expiresAt: z.number(), ticket: z.string() })
      .parse(challengeReply.body);
    const clientData = clientDataJSON(Buffer.from(challenge, 'base64url'), policy.origin);
    const auth = Buffer.concat([policy.rp_id_hash, Buffer.from([5, 0, 0, 0, 0])]);
    const material = Buffer.concat([auth, createHash('sha256').update(clientData).digest()]);
    const assertion = {
      ...selected,
      challenge,
      challengeExpiresAt: expiresAt,
      challengeTicket: ticket,
      authenticatorData: auth.toString('hex'),
      clientDataJSON: Buffer.from(clientData).toString('hex'),
      signature: sign('sha256', material, privateKey).toString('hex'),
    };
    assert.equal(
      (await host.send('session/verify', { ...assertion, account: '79'.repeat(32) })).status,
      401,
    );
    const verified = await Promise.all([
      host.send('session/verify', assertion),
      host.send('session/verify', assertion),
    ]);
    assert.deepEqual(verified.map(({ status }) => status).sort(), [200, 401]);
    const { session } = z
      .object({ session: z.string() })
      .parse(verified.find(({ status }) => status === 200)?.body);
    assert.equal((await host.send('session/verify', assertion)).status, 401);
    return { authorization: 'PassportGrant ' + session };
  }
  const headers = await authenticate();
  const input = { account, fragment: holder() };
  const claimed = await host.send('claim', input, headers);
  const { requestId } = z.object({ requestId: z.uuid() }).parse(claimed.body);
  const original = { ...input, requestId, intentSha256 };
  assert.equal((await host.send('execute', { ...original, proved: 'abcd' }, headers)).status, 202);
  assert.equal(submissions, 0);
  assert.equal((await host.send('reconcile', original, headers)).status, 401);
  enrolled = true;
  assert.equal((await host.send('reconcile', original, headers)).status, 401);
  const renewed = await authenticate();
  assert.deepEqual((await host.send('reconcile', original, renewed)).body, { txHash });
  assert.equal((await host.send('reconcile', original, renewed)).status, 401);
  const active = await authenticate();
  assert.deepEqual((await host.send('reconcile', original, active)).body, { txHash });
  assert.equal(submissions, 1);

  const expiring = {
    account,
    fragment: holder({ nonce: '63'.repeat(32), issuedAt: time + 301 }),
  };
  const second = await host.send('claim', expiring, active);
  const pending = {
    ...expiring,
    requestId: z.object({ requestId: z.uuid() }).parse(second.body).requestId,
    intentSha256,
  };
  assert.equal((await host.send('execute', { ...pending, proved: 'abcd' }, active)).status, 202);
  enrolled = true;
  const fresh = await authenticate();
  t.mock.timers.setTime((time + 366) * 1000);
  assert.equal((await host.send('reconcile', pending, fresh)).status, 409);
  assert.equal(submissions, 1);
});
