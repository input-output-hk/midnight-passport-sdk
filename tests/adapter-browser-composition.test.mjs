import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBrowserPassport } from '../packages/adapter-browser/dist/index.js';

test('the browser composition builds an account API without loading the binding or chain', () => {
  let bindingLoads = 0;
  const unused = () => Promise.reject(new Error('unused port'));
  const api = createBrowserPassport({
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
  });
  assert.equal(api.networkId, 'undeployed');
  assert.equal(api.bindingId, 'acc-test');
  assert.equal(bindingLoads, 0);
});
