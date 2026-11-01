// Real public handlers/client/channel and crypto; fake chain, synthetic PRF and window routing.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { m } from '@laceio/sdk/experimental';
import { addJubjubAuthorisingDevice } from '@input-output-hk/mn-passport-account';
import { hostedJubjubAuthoriser } from '@input-output-hk/mn-passport-adapter-browser/hosted-jubjub';
import { pureCircuits as pure } from '@input-output-hk/mn-passport-contract/bindings/acc-s3r1.1';
import {
  PRF_LABEL_AUTHORISER,
  PRF_LABEL_ROOT,
  prfSalt,
  recipeJubjubAuthoriser,
} from '@input-output-hk/mn-passport-keys';
import { createPublicSignerHarness } from './public-signer-harness.js';
const [root, bundle] = process.argv.slice(2);
const source = await import(pathToFileURL(bundle).href);
const requireKeys = createRequire(import.meta.resolve('@input-output-hk/mn-passport-keys'));
const { jubjub } = await import(pathToFileURL(requireKeys.resolve('@noble/curves/misc.js')).href);
const material = {
  id: randomBytes(16).toString('base64url'),
  device: randomBytes(32).toString('hex'),
  root: randomBytes(32).toString('hex'),
};
writeFileSync(join(root, 'synthetic-credential.private.json'), JSON.stringify(material) + '\n', {
  flag: 'wx',
  mode: 0o600,
});
let draws = 0,
  cancel = false;
const owner = m.createPasskeySessionKeySource({
  credentialId: material.id,
  rpId: 'localhost',
  credentials: {
    create: async () => {
      throw Error('existing synthetic credential only');
    },
    get: async (options) => {
      assert.equal(options.publicKey.rpId, 'localhost');
      assert.deepEqual(
        Buffer.from(options.publicKey.allowCredentials[0].id),
        Buffer.from(material.id, 'base64url'),
      );
      const salts = options.publicKey.extensions.prf.eval;
      assert.deepEqual(new Uint8Array(salts.first), prfSalt(PRF_LABEL_AUTHORISER));
      assert.deepEqual(new Uint8Array(salts.second), prfSalt(PRF_LABEL_ROOT));
      draws++;
      if (cancel)
        throw Object.assign(Error('synthetic WebAuthn cancellation'), { name: 'NotAllowedError' });
      return {
        rawId: Uint8Array.from(Buffer.from(material.id, 'base64url')).buffer,
        getClientExtensionResults: () => ({
          prf: {
            results: {
              first: Uint8Array.from(Buffer.from(material.device, 'hex')).buffer,
              second: Uint8Array.from(Buffer.from(material.root, 'hex')).buffer,
            },
          },
        }),
      };
    },
  },
});
let timeout;
const h = await createPublicSignerHarness({
  source,
  owner,
  root,
  forbiddenSecrets: [material.device, material.root],
  timers: {
    setTimeout: (fn) => {
      timeout = fn;
      return 1;
    },
    clearTimeout: () => {
      timeout = undefined;
    },
  },
});
const conversions = {
  account: source.AccAddress,
  epoch: source.DeviceEpoch,
  counter: source.UseCounter,
  flow: (v) => {
    source.decodeSignerFlow(v);
    return structuredClone(v);
  },
};
const sdk = hostedJubjubAuthoriser(h.seams.authoriser, conversions);
const account = 'ab'.repeat(32),
  self = { bytes: Buffer.from(account, 'hex') },
  epoch = 0n,
  nonce = 0n;
const joining = pure.compute_public_point_with_jubjub(19n);
let point,
  entries = [],
  calls = 0,
  record;
const cases = [];
const check = async (name, fn) => {
  await fn();
  cases.push(name);
};
const refused = (fn, code) => assert.rejects(fn, (e) => e.code === code);
try {
  await check('authenticated hint comes from approved sign-in over real handlers', async () => {
    point = await sdk.withKeySession(() => sdk.devicePublicKey(), { kind: 'sign-in' });
    const local = await recipeJubjubAuthoriser(owner, pure).devicePublicKey();
    assert.deepEqual(point, local);
    entries = [pure.derive_device_entry_with_jubjub(self, point, epoch, 0n)];
    record = {
      bindingId: 'acc-s3r1.1',
      address: account,
      scheme: 'jubjub-schnorr',
      credentialId: Buffer.from(material.id, 'base64url'),
      localUseCounter: 0n,
    };
  });
  const view = () => ({
    booted: true,
    specVersion: 3,
    deviceEpoch: epoch,
    authNonce: nonce,
    hasEntry: (e) => entries.some((v) => Buffer.from(e).equals(Buffer.from(v))),
  });
  const ports = {
    bindingId: 'acc-s3r1.1',
    pure,
    authoriser: sdk,
    records: {
      read: async () => record,
      write: async (v) => {
        record = v;
      },
    },
    chain: {
      readAccount: async () => view(),
      call: async (request) => {
        assert.equal(request.address, account);
        assert.equal(request.circuit, 'add_device_with_jubjub');
        const [entry, pk, counter, R, S, grind] = request.args;
        assert.deepEqual(pk, point);
        assert.equal(counter, 0n);
        const c = BigInt(
          '0x' +
            Buffer.from(pure.challenge_add_device_with_jubjub(self, R, pk, entry, nonce, grind))
              .reverse()
              .toString('hex'),
        );
        assert.ok(c < jubjub.Point.Fn.ORDER);
        assert.ok(S > 0n && S < jubjub.Point.Fn.ORDER);
        const G = jubjub.Point.fromAffine(pure.compute_public_point_with_jubjub(1n));
        assert.ok(
          G.multiply(S).equals(
            jubjub.Point.fromAffine(R).add(jubjub.Point.fromAffine(pk).multiply(c)),
          ),
        );
        calls++;
        entries = [pure.derive_device_entry_with_jubjub(self, point, epoch, counter + 1n), entry];
        return { txId: '00' + 'cd'.repeat(32) };
      },
    },
  };
  const input = () => ({
    hint: {
      address: account,
      scheme: 'jubjub-schnorr',
      status: 'active',
      publicKey: point,
      credentialId: Buffer.from(material.id, 'base64url'),
    },
    joiningPublicKey: joining,
  });
  await check('rejected SDK add-device cannot draw PRF sign or mutate chain', async () => {
    const before = draws,
      requests = h.stats().requests.length;
    h.setDecision('reject');
    await refused(() => addJubjubAuthorisingDevice(input(), ports), 'UserCancelled');
    assert.equal(draws, before);
    assert.equal(calls, 0);
    assert.equal(record.localUseCounter, 0n);
    assert.deepEqual(
      h
        .stats()
        .requests.slice(requests)
        .map((r) => r.kind),
      ['flow-open'],
    );
    h.setDecision('approve');
  });
  await check('origin refusal happens before consent and PRF', async () => {
    const before = draws,
      approvals = h.stats().approvals.length;
    h.setOriginAllowed(false);
    await assert.rejects(
      () => addJubjubAuthorisingDevice(input(), ports),
      (e) => e.code === 'InternalError' && e.cause?.code === 'origin-denied',
    );
    assert.equal(draws, before);
    assert.equal(h.stats().approvals.length, approvals);
    assert.equal(calls, 0);
    h.setOriginAllowed(true);
  });
  await check(
    'SDK add-device uses exact consent and independently verified real signature',
    async () => {
      const start = h.stats().requests.length;
      const result = await addJubjubAuthorisingDevice(input(), ports);
      assert.equal(calls, 1);
      assert.equal(result.nextUseCounter, 1n);
      assert.equal(record.localUseCounter, 1n);
      const approval = h.stats().approvals.at(-1);
      assert.deepEqual(approval.flow, {
        kind: 'add-device',
        account,
        commitmentHex: result.commitmentHex,
      });
      assert.deepEqual(
        h
          .stats()
          .requests.slice(start)
          .map((r) => r.kind),
        ['flow-open', 'authorise', 'flow-close'],
      );
      assert.equal(
        h.storageSnapshot().some(([name]) => name === 'passport-account'),
        true,
      );
      assert.equal(await h.readRecord(), undefined); // Authorising-only: no account key or reader delivery.
    },
  );
  await check('outside-session access is refused', async () => {
    await refused(() => h.client.request('device-public-key', {}), 'key-session-required');
  });
  await check('add-device scope refuses public-key disclosure and wrong account', async () => {
    await sdk.withKeySession(
      async () => {
        await refused(() => sdk.devicePublicKey(), 'flow-scope');
        await refused(
          () =>
            sdk.authorise({
              account: 'ac'.repeat(32),
              circuit: 'add_device_with_jubjub',
              args: [new Uint8Array(32)],
              witnessValues: [],
              authNonce: 0n,
              useCounter: 1n,
            }),
          'flow-scope',
        );
      },
      { kind: 'add-device', account, commitmentHex: 'dc'.repeat(32) },
    );
    assert.equal(calls, 1);
  });
  await check('missing consent field and unknown flow are rejected before PRF', async () => {
    const before = draws;
    assert.throws(() => sdk.withKeySession(async () => {}, { kind: 'add-device', account }));
    await refused(
      () => h.client.request('flow-open', { flow: { kind: 'withdraw-shielded', account } }),
      'malformed-payload',
    );
    assert.equal(draws, before);
  });
  await check('unsupported SDK flows and lossy conversion never reach transport', async () => {
    const before = h.stats().requests.length;
    for (const kind of ['rotate-encryption-key', 'withdraw-unshielded', 'withdraw-shielded'])
      assert.throws(
        () => sdk.withKeySession(async () => {}, { kind, account }),
        /no .* consent descriptor/,
      );
    const lossy = hostedJubjubAuthoriser(h.seams.authoriser, {
      ...conversions,
      flow: () => ({ kind: 'sign-in' }),
    });
    assert.throws(
      () =>
        lossy.withKeySession(async () => {}, {
          kind: 'add-device',
          account,
          commitmentHex: 'cd'.repeat(32),
        }),
      /consent descriptor changed/,
    );
    assert.equal(h.stats().requests.length, before);
  });
  await check('overlapping open is busy and does not draw another PRF', async () => {
    await h.seams.authoriser.withKeySession(
      async () => {
        const before = draws;
        await refused(
          () => h.client.request('flow-open', { flow: { kind: 'sign-in' } }),
          'signer-busy',
        );
        assert.equal(draws, before);
      },
      { kind: 'sign-in' },
    );
  });
  await check('expiry refuses further signatures and closes held key session', async () => {
    await h.client.request('flow-open', { flow: { kind: 'sign-in' } });
    assert.equal(typeof timeout, 'function');
    timeout();
    await new Promise((r) => setTimeout(r, 0));
    await refused(() => h.client.request('device-public-key', {}), 'session-expired');
    await refused(() => h.client.request('flow-close', { outcome: 'failed' }), 'session-expired');
    assert.equal(h.stats().expired, 1);
  });
  await check(
    'WebAuthn cancellation refuses callback and a fresh approved session recovers',
    async () => {
      cancel = true;
      let called = false;
      await assert.rejects(() =>
        sdk.withKeySession(
          async () => {
            called = true;
          },
          { kind: 'sign-in' },
        ),
      );
      assert.equal(called, false);
      cancel = false;
      await sdk.withKeySession(() => sdk.devicePublicKey(), { kind: 'sign-in' });
    },
  );
  await check('operation error is closed as failed without a chain mutation', async () => {
    const error = Object.assign(Error('controlled callback error'), { code: 'controlled-failure' });
    await assert.rejects(
      () =>
        sdk.withKeySession(
          async () => {
            throw error;
          },
          { kind: 'sign-in' },
        ),
      (e) => e === error,
    );
    assert.equal(calls, 1);
    assert.equal(h.stats().requests.at(-1).kind, 'flow-close');
  });
} finally {
  await h.close();
}
writeFileSync(
  join(root, 'protocol-result.json'),
  JSON.stringify(
    {
      schemaVersion: 1,
      kind: 'public-signer-protocol',
      testsPassed: cases.length,
      cases,
      chainCalls: calls,
      draws,
      realHandlers: true,
      nativeMessageChannel: true,
      simulatedWindowRouting: true,
      syntheticCredentials: true,
      fakeChain: true,
      nativeProof: false,
      signerPage: false,
      realProvider: false,
      fullCompatibility: false,
      ...h.stats(),
    },
    null,
    2,
  ) + '\n',
  { flag: 'wx', mode: 0o600 },
);
console.log(JSON.stringify({ testsPassed: cases.length, chainCalls: calls }));
