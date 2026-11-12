import assert from 'node:assert/strict';
import { createHash, randomUUID, sign } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { p256 } from '@noble/curves/nist.js';
import {
  createBrowserGrantNonceStore,
  createP256GranteeIssueFence,
  createP256GranteeIssueJournal,
} from '../packages/account/dist/index.js';
import {
  authoriseBrowserP256Grant,
  browserP256GrantCallbackUrl,
  verifyBrowserP256GrantCallback,
} from '../packages/adapter-browser/dist/index.js';
import { createMidnightGrantSource } from '../packages/adapter-midnight-js/dist/index.js';
import {
  browserGrantRequestDigest,
  clientDataJSON,
} from '../packages/adapter-webauthn/dist/index.js';
import { pureCircuits } from '../packages/contract/generated/acc-s3r1.1/index.js';
import { signJubjubChallenge } from '../packages/keys/dist/jubjub-signing.js';
import {
  fileMutationByteStore,
  protectedMutationByteStore,
} from '../packages/service/dist/index.js';
import { AccSimulator, simulationDevice } from '../scripts/qualification/acc-simulator.mjs';

const issuer = 'https://passport.example';
const client = 'https://bank.example1';
const networkId = 'undeployed';
const bindingId = 'acc-s3r1.1';

function deferred() {
  let resolve = () => {};
  const promise = new Promise((settle) => {
    resolve = () => settle(undefined);
  });
  return { promise, resolve };
}

/** @param {string} account @param {number} now */
function holderRequest(account, now) {
  const device = simulationDevice('p256');
  assert.equal(device.arm, 'p256');
  const point = p256.Point.fromAffine(device.pk).toBytes(false);
  const wireKey = Buffer.concat([point.slice(1, 33).reverse(), point.slice(33).reverse()]);
  const rp = createHash('sha256').update(new URL(client).hostname).digest();
  const auth = Buffer.concat([rp, Buffer.from([5, 0, 0, 0, 0])]);
  /** @param {{nonce?: string, cap?: string, slot?: number}} [changes] */
  return ({ nonce = '51'.repeat(32), cap = '10', slot = 7 } = {}) => {
    const request = Buffer.from(
      JSON.stringify({
        v: 1,
        chain: networkId,
        aud: issuer,
        iat: now,
        exp: now + 20,
        client_id: client,
        redirect_uri: client + '/return',
        account,
        grantee: { scheme: 'ecdsa_secp256r1_webauthn', pk: wireKey.toString('hex') },
        grants: [
          {
            slot,
            scope: ['midnight:account:withdraw_unshielded'],
            bounds: {
              color: '00'.repeat(32),
              per_call_cap: '1',
              cap,
              max_coin_value: '10',
              expires_at: now + 60,
              recipient: { kind: 'user', value: '72'.repeat(32) },
            },
          },
        ],
        state: Buffer.alloc(16, 3).toString('base64url'),
        nonce,
      }),
    ).toString('base64url');
    const json = clientDataJSON(
      browserGrantRequestDigest(request),
      new TextEncoder().encode(client),
    );
    const material = Buffer.concat([auth, createHash('sha256').update(json).digest()]);
    const proof = Buffer.from(
      JSON.stringify({
        type: 'webauthn',
        client_data_json: Buffer.from(json).toString('base64url'),
        authenticator_data: auth.toString('base64url'),
        signature: sign('sha256', material, device.privateKey).toString('base64url'),
      }),
    ).toString('base64url');
    return '#request=' + request + '&proof=' + proof;
  };
}

/** @param {string} url @param {string} key @param {string} value */
function replaceCallbackParameter(url, key, value) {
  const target = new URL(url);
  const fields = new URLSearchParams(target.hash.slice(1));
  fields.set(key, value);
  target.hash = fields.toString();
  return target.href;
}

/**
 * @param {string} url
 * @param {import('../packages/adapter-browser/dist/index.js').PendingBrowserP256Grant} pending
 * @param {Parameters<typeof verifyBrowserP256GrantCallback>[2]} ports
 */
async function checkInvalidCallbacks(url, pending, ports) {
  for (const changed of [
    url.replace('/return#', '/return?injected=1#'),
    url.replace('/return#', '/elsewhere#'),
    replaceCallbackParameter(url, 'state', Buffer.alloc(16, 5).toString('base64url')),
    replaceCallbackParameter(url, 'iss', 'https://attacker.example'),
    replaceCallbackParameter(url, 'chain', 'midnight:preview'),
    replaceCallbackParameter(url, 'account', 'bb'.repeat(32)),
    replaceCallbackParameter(url, 'grant_id', '88'.repeat(32)),
    replaceCallbackParameter(url, 'scope_salt', '72'.repeat(32)),
    url + '&state=duplicate',
  ]) {
    await assert.rejects(verifyBrowserP256GrantCallback(changed, pending, ports), {
      code: 'GrantScopeInvalid',
    });
  }
  const fields = new URLSearchParams(new URL(url).hash.slice(1));
  const scope = JSON.parse(Buffer.from(fields.get('scope') ?? '', 'base64url').toString());
  for (const changed of [
    { ...scope, cap: '100' },
    { ...scope, read: true },
    { ...scope, caller: '00'.repeat(32) },
  ]) {
    const encoded = Buffer.from(JSON.stringify(changed)).toString('base64url');
    await assert.rejects(
      verifyBrowserP256GrantCallback(
        replaceCallbackParameter(url, 'scope', encoded),
        pending,
        ports,
      ),
      { code: 'GrantScopeInvalid' },
    );
  }
}

test('browser grant admission retains the original ID across concurrency, lost reply and expiry', async (t) => {
  const owner = simulationDevice('jubjub');
  assert.equal(owner.arm, 'jubjub');
  const sim = await AccSimulator.create({ owner });
  const root = await mkdtemp(join(tmpdir(), 'passport-browser-grant-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const bytes = () => fileMutationByteStore(join(root, 'nonces'));
  const encryptionKey = new Uint8Array(32).fill(9);
  const protectedStore = protectedMutationByteStore(join(root, 'opening'), encryptionKey);
  const journal = createP256GranteeIssueJournal(protectedStore);
  const fence = createP256GranteeIssueFence(fileMutationByteStore(join(root, 'fence')));
  t.after(() => protectedStore.close());
  const grants = createMidnightGrantSource({
    network: {
      networkId,
      bindingId,
      indexerUrl: 'http://localhost:8088/api/v1/graphql',
      indexerWsUrl: 'ws://localhost:8088/api/v1/graphql/ws',
    },
    binding: { ledger: () => sim.ledger() },
    openings: { readReadPublicKey: async () => undefined },
    publicDataProvider: /** @type {any} */ ({ queryContractState: async () => ({ data: {} }) }),
  });
  let reviews = 0;
  let sessions = 0;
  let signatures = 0;
  let submissions = 0;
  let now = sim.now;
  const request = holderRequest(sim.address, now);
  const fragment = request();
  const unsettledFragment = request({ nonce: '33'.repeat(32) });
  const waitForReview = deferred();
  const releaseReview = deferred();
  /** @type {import('../packages/adapter-browser/dist/index.js').BrowserGrantAuthoriserPorts} */
  const ports = {
    issuer,
    nonces: createBrowserGrantNonceStore(bytes(), randomUUID),
    issue: {
      networkId,
      grants,
      pure: pureCircuits,
      journal,
      fence,
      nowSeconds: () => now,
      owner: {
        scheme: 'jubjub-schnorr',
        address: sim.address,
        publicKey: owner.pk,
        status: 'active',
      },
      authoriser: {
        scheme: 'jubjub-schnorr',
        devicePublicKey: async () => owner.pk,
        withKeySession(work) {
          sessions++;
          return work();
        },
        async authorise(input) {
          signatures++;
          assert.ok(typeof input.challenge === 'function');
          return signJubjubChallenge(pureCircuits, owner.scalar, input.challenge, input.useCounter);
        },
      },
      chain: {
        networkId,
        bindingId,
        async readAccount() {
          const live = sim.ledger();
          return {
            booted: live.booted,
            specVersion: Number(live.spec_version),
            authNonce: live.auth_nonce,
            deviceEpoch: live.device_epoch,
            entryCount: Number(live.devices.size()),
            hasEntry: (entry) => live.devices.member(entry),
          };
        },
        async call({ circuit, args, mutation }) {
          assert.equal(mutation?.validUntilSeconds, sim.now + 20);
          submissions++;
          await sim.call(circuit, ...args);
          throw new Error('Lost original issue reply');
        },
      },
      async review() {
        reviews++;
        waitForReview.resolve();
        await releaseReview.promise;
        return true;
      },
    },
  };
  const first = authoriseBrowserP256Grant(fragment, ports);
  await Promise.race([
    waitForReview.promise,
    first.then(() => assert.fail('Expected owner review')),
  ]);
  try {
    const concurrent = await authoriseBrowserP256Grant(fragment, ports);
    assert.equal(concurrent.status, 'unresolved');
    assert.deepEqual([reviews, signatures, submissions], [1, 0, 0]);
    await assert.rejects(authoriseBrowserP256Grant(request({ cap: '9' }), ports), {
      code: 'GrantScopeInvalid',
    });
    releaseReview.resolve();
    assert.deepEqual(await first, concurrent);

    protectedStore.close();
    const reopened = protectedMutationByteStore(join(root, 'opening'), encryptionKey);
    t.after(() => reopened.close());
    const restarted = {
      ...ports,
      nonces: createBrowserGrantNonceStore(bytes(), randomUUID),
      issue: { ...ports.issue, journal: createP256GranteeIssueJournal(reopened) },
    };
    now = sim.now + 21;
    const recovered = await authoriseBrowserP256Grant(fragment, restarted);
    assert.equal(recovered.status, 'granted');
    assert.equal(recovered.requestId, concurrent.requestId);
    assert.equal(recovered.opening.slot, 7);
    assert.equal(recovered.opening.scope.grantee.origin, client);
    assert.equal(recovered.redirectUri, client + '/return');
    assert.equal(recovered.issuer, issuer);
    await assert.rejects(authoriseBrowserP256Grant(unsettledFragment, restarted), {
      code: 'GrantScopeInvalid',
    });
    assert.deepEqual([reviews, sessions, signatures, submissions], [1, 1, 1, 1]);

    const expiring = request({ nonce: 'a3'.repeat(32), slot: 8 });
    now = sim.now;
    await assert.rejects(
      authoriseBrowserP256Grant(expiring, {
        ...restarted,
        issue: {
          ...restarted.issue,
          async review() {
            now = sim.now + 21;
            return true;
          },
        },
      }),
      { code: 'GrantScopeInvalid' },
    );
    assert.equal((await authoriseBrowserP256Grant(expiring, restarted)).status, 'unresolved');
    assert.deepEqual([reviews, sessions, signatures, submissions], [1, 1, 1, 1]);
    const callback = browserP256GrantCallbackUrl(recovered);
    const pending = { issuer, originalFragment: fragment, account: sim.address };
    const holderPorts = { networkId, source: grants, pure: pureCircuits, nowSeconds: () => now };
    assert.deepEqual(
      await verifyBrowserP256GrantCallback(callback, pending, holderPorts),
      recovered.opening,
    );
    await checkInvalidCallbacks(callback, pending, holderPorts);
    await assert.rejects(
      verifyBrowserP256GrantCallback(
        callback,
        { ...pending, originalFragment: holderRequest(sim.address, sim.now)() },
        holderPorts,
      ),
      { code: 'GrantScopeInvalid' },
    );
    await assert.rejects(
      verifyBrowserP256GrantCallback(callback, pending, {
        ...holderPorts,
        nowSeconds: () => sim.now + 60,
      }),
      { code: 'GrantScopeInvalid' },
    );
    const live = await grants.readP256GrantSpendContext(sim.address, recovered.opening.grantId);
    assert.ok(live);
    await assert.rejects(
      verifyBrowserP256GrantCallback(callback, pending, {
        ...holderPorts,
        source: {
          ...grants,
          async readP256GrantSpendContext() {
            return { ...live, callerCommit: new Uint8Array(32).fill(9) };
          },
        },
      }),
      { code: 'GrantScopeInvalid' },
    );
    await sim.authorised(
      'revoke_grant',
      [Buffer.from(recovered.opening.grantId, 'hex')],
      owner,
      1n,
    );
    await assert.rejects(verifyBrowserP256GrantCallback(callback, pending, holderPorts), {
      code: 'GrantRevoked',
    });
  } finally {
    releaseReview.resolve();
    await first.catch(() => {});
  }
});

test('two issuers sharing a nonce store elect one original UUID', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'passport-grant-nonce-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const a = createBrowserGrantNonceStore(fileMutationByteStore(root), randomUUID);
  const b = createBrowserGrantNonceStore(fileMutationByteStore(root), randomUUID);
  const intent = {
    issuer,
    networkId,
    account: '61'.repeat(32),
    requestDigest: 'a1'.repeat(32),
    nonce: '92'.repeat(32),
    validUntilSeconds: 1_790_000_001,
  };
  const results = await Promise.all([a.claim(intent), b.claim(intent)]);
  assert.equal(results.filter(({ first }) => first).length, 1);
  assert.equal(results[0]?.requestId, results[1]?.requestId);
  assert.equal(await b.read(intent), results[0]?.requestId);
  await assert.rejects(b.read({ ...intent, account: '62'.repeat(32) }), {
    code: 'GrantScopeInvalid',
  });
  assert.equal(await b.read({ ...intent, nonce: '93'.repeat(32) }), undefined);
});
