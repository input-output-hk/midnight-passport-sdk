import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBrowserPassport } from '../packages/adapter-browser/dist/index.js';
import { createAuthenticatedJubjubOwner } from '../packages/keys/dist/index.js';
import { pureCircuits } from '../packages/contract/generated/acc-s3r1.1/index.js';
import { routeBrowserValueCalls } from '../packages/adapter-browser/dist/value-call-routing.js';

test('browser value routing preserves the direct finalized-ID fence', async () => {
  /** @type {string[]} */
  const calls = [];
  /** @type {import('../packages/account/dist/ports/index.js').Chain} */
  const direct = {
    supportsBeforeSubmit: true,
    readAccount: async () => undefined,
    call: async (request) => {
      calls.push(`direct:${request.circuit}`);
      return { txHash: '1'.repeat(64) };
    },
  };
  /** @type {Pick<import('../packages/account/dist/ports/index.js').Chain, 'call'>} */
  const hosted = {
    call: async (request) => {
      calls.push(`hosted:${request.circuit}`);
      return { txHash: '2'.repeat(64) };
    },
  };
  const chain = routeBrowserValueCalls(direct, hosted);
  assert.equal(chain.supportsBeforeSubmit, true);
  assert.equal(
    (await chain.call({ address: 'a', circuit: 'withdraw_unshielded_with_jubjub', args: [] }))
      .txHash,
    '2'.repeat(64),
  );
  assert.equal(
    (
      await chain.call({
        address: 'a',
        circuit: 'withdraw_unshielded_with_jubjub',
        args: [],
        beforeSubmit: async () => {},
      })
    ).txHash,
    '1'.repeat(64),
  );
  assert.deepEqual(calls, [
    'hosted:withdraw_unshielded_with_jubjub',
    'direct:withdraw_unshielded_with_jubjub',
  ]);
  const fencedHost = routeBrowserValueCalls(direct, {
    ...hosted,
    supportsBeforeSubmit: true,
  });
  await fencedHost.call({
    address: 'a',
    circuit: 'withdraw_unshielded_with_jubjub',
    args: [],
    beforeSubmit: async () => {},
  });
  assert.equal(calls.at(-1), 'hosted:withdraw_unshielded_with_jubjub');
});

for (const arm of /** @type {const} */ (['p256', 'jubjub']))
  test(`${arm} browser composition is lazy`, () => {
    let bindingLoads = 0;
    let journalFactories = 0;
    const unused = () => Promise.reject(new Error('unused port'));
    const api = createBrowserPassport({
      arm,
      network: {
        networkId: 'undeployed',
        bindingId: 'acc-test',
        manifestSha256: 'a'.repeat(64),
        indexerUrl: 'http://indexer',
        indexerWsUrl: 'ws://indexer',
        nodeUrl: 'http://node',
        artefactUrl: 'http://artefacts',
      },
      binding: async () => {
        bindingLoads++;
        throw new Error('binding loaded before a flow');
      },
      passkey: { rpId: 'localhost', origin: 'http://localhost:5173' },
      prover: { proveTx: unused },
      sponsor: { balanceAndSign: unused },
      sponsorKeys: { coinPublicKey: 'coin', encryptionPublicKey: 'encryption' },
      submitter: { submit: unused },
      deployer: { deploy: unused },
      directory: { get: async () => undefined, put: async () => {} },
      grantJournalFactory: () => {
        journalFactories++;
        return {
          stage: async () => {},
          load: async () => undefined,
          markPublished: async () => {},
        };
      },
    });
    assert.equal(api.networkId, 'undeployed');
    assert.equal(api.bindingId, 'acc-test');
    assert.equal(bindingLoads, 0);
    assert.equal(journalFactories, 1);
  });

test('authenticated browser owner composition refuses context changes and never calls a credential provider', async () => {
  let accesses = 0;
  const unused = async () => {
    throw Error('unused binding');
  };
  const owner = createAuthenticatedJubjubOwner({
    context: {
      account: 'ab'.repeat(32),
      networkId: 'undeployed',
      bindingId: 'acc-s3r1.1',
      credentialId: Uint8Array.of(1),
    },
    authoriser: new Uint8Array(32).fill(7),
    walletSeed: new Uint8Array(64).fill(9),
    pure: pureCircuits,
    companionReader: false,
    check() {},
  });
  const config = {
    arm: /** @type {const} */ ('jubjub'),
    ownerSession: owner,
    network: {
      networkId: 'undeployed',
      bindingId: 'acc-s3r1.1',
      manifestSha256: 'a'.repeat(64),
      indexerUrl: 'http://indexer',
      indexerWsUrl: 'ws://indexer',
      nodeUrl: 'http://node',
      artefactUrl: 'http://artefacts',
    },
    binding: unused,
    passkey: {
      rpId: 'localhost',
      origin: 'http://localhost:5173',
      credentials:
        /** @type {NonNullable<import('../packages/adapter-browser/dist/index.js').BrowserPassportConfig['passkey']['credentials']>} */ ({
          create: async () => {
            accesses++;
            throw Error('unexpected passkey');
          },
          get: async () => {
            accesses++;
            throw Error('unexpected passkey');
          },
        }),
    },
    prover: { proveTx: unused },
    sponsor: { balanceAndSign: unused },
    sponsorKeys: { coinPublicKey: 'coin', encryptionPublicKey: 'enc' },
    submitter: { submit: unused },
    deployer: { deploy: unused },
    directory: { get: async () => undefined, put: async () => {} },
  };
  assert.throws(() => createBrowserPassport({ ...config, arm: 'p256' }), /context mismatch/);
  assert.throws(
    () => createBrowserPassport({ ...config, network: { ...config.network, networkId: 'other' } }),
    /context mismatch/,
  );
  const api = createBrowserPassport(config);
  const open = api.openAccountAt;
  assert.ok(open);
  assert.throws(() => open('cd'.repeat(32)), /account mismatch/);
  await assert.rejects(
    api.createAccount({ userName: 'bad', retireAuthority: true }),
    /create an account/,
  );
  await assert.rejects(open(owner.context.account), /unused binding/);
  assert.equal(accesses, 0);
  owner.dispose();
  assert.throws(() => open(owner.context.account), /locked/);
});

// These are the exact decorators wired into createBrowserPassport's chain and value paths.
// Deferred ports model expiry after signing while remote proof/sponsorship is pending.
for (const pending of ['proof', 'sponsor'])
  test(`authenticated owner expiry during ${pending} prevents the next dispatch`, async () => {
    const { authenticatedOwnerTransports } =
      await import('../packages/adapter-browser/dist/authenticated-transports.js');
    let active = true;
    /** @type {(() => void) | undefined} */
    let release;
    const paused = new Promise((resolve) => {
      release = () => resolve(undefined);
    });
    /** @type {string[]} */
    const calls = [];
    const ports = authenticatedOwnerTransports(
      () => {
        if (!active) throw Error('expired');
      },
      {
        prover: {
          async proveTx() {
            calls.push('proof');
            if (pending === 'proof') await paused;
            return { tx: new Uint8Array(), provenance: /** @type {const} */ ('remote') };
          },
        },
        sponsor: {
          supportsShieldedOffers: false,
          async balanceAndSign() {
            calls.push('sponsor');
            if (pending === 'sponsor') await paused;
            return new Uint8Array();
          },
        },
        submitter: {
          async submit() {
            calls.push('submit');
            return 'original-id';
          },
        },
      },
    );
    const flow = (async () => {
      const proof = await ports.prover.proveTx(new Uint8Array(), {
        networkId: 'undeployed',
        bindingId: 'acc-s3r1.1',
        circuits: ['rotate_with_jubjub'],
      });
      const tx = await ports.sponsor.balanceAndSign(proof.tx);
      return ports.submitter.submit(tx);
    })();
    if (pending === 'sponsor') await Promise.resolve();
    active = false;
    assert.ok(release);
    release();
    await assert.rejects(flow, /expired/);
    assert.deepEqual(calls, pending === 'proof' ? ['proof'] : ['proof', 'sponsor']);
    assert.equal(ports.sponsor.supportsShieldedOffers, false);
  });

for (const pending of ['submit', 'value'])
  test(`authenticated owner preserves ${pending} acknowledgement after dispatch and rejects another send`, async () => {
    const { authenticatedOwnerTransports } =
      await import('../packages/adapter-browser/dist/authenticated-transports.js');
    let active = true;
    /** @type {(() => void) | undefined} */
    let release;
    const paused = new Promise((resolve) => {
      release = () => resolve(undefined);
    });
    let calls = 0;
    const check = () => {
      if (!active) throw Error('expired');
    };
    const unused = async () => {
      throw Error('unused');
    };
    const ports = authenticatedOwnerTransports(check, {
      prover: { proveTx: unused },
      sponsor: { balanceAndSign: unused },
      submitter: {
        async submit() {
          calls++;
          await paused;
          return 'original-id';
        },
      },
      valueCalls: {
        async call() {
          calls++;
          await paused;
          return { txHash: 'ab'.repeat(32) };
        },
      },
    });
    assert.ok(ports.valueCalls);
    const valueCalls = ports.valueCalls;
    const send = () =>
      pending === 'submit'
        ? ports.submitter.submit(new Uint8Array())
        : valueCalls.call({
            address: 'ab'.repeat(32),
            circuit: 'withdraw_unshielded_with_jubjub',
            args: [],
          });
    const result = send();
    assert.equal(calls, 1);
    active = false;
    assert.ok(release);
    release();
    assert.deepEqual(
      await result,
      pending === 'submit' ? 'original-id' : { txHash: 'ab'.repeat(32) },
    );
    assert.throws(send, /expired/);
    assert.equal(calls, 1);
  });
