import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBrowserPassport } from '../packages/adapter-browser/dist/index.js';
import { createAuthenticatedJubjubOwner } from '../packages/keys/dist/index.js';
import { pureCircuits } from '../packages/contract/generated/acc-s3r1.1/index.js';

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
