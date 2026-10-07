// The parts of src/config.ts that zk.test.ts leaves out: where the registry lives by default,
// the other defaults and overrides, the required variables, and the numeric edge cases.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { LOCALNET_ID, loadConfig, loadStack, localnetStack } from '../src/config.ts';

const BASE = { PASSPORT_CONTRACT_DIR: '/contracts', PASSPORT_MANIFEST_SHA256: 'ab'.repeat(32) };

test('the registry defaults to ~/.midnight-passport/registry.json, under the HOME given', () => {
  const config = loadConfig({ ...BASE, HOME: '/home/demo' });
  assert.equal(config.registryFile, join('/home/demo', '.midnight-passport', 'registry.json'));
  // Outside the repository and the contract tree, so a rebuild or a fresh export keeps accounts.
  assert.ok(!config.registryFile.startsWith('/contracts'));
});

test('without HOME in the environment the registry follows the process home directory', () => {
  const saved = process.env.HOME;
  process.env.HOME = '/home/process';
  try {
    assert.equal(
      loadConfig(BASE).registryFile,
      join(homedir(), '.midnight-passport', 'registry.json'),
    );
    assert.equal(
      loadConfig(BASE).registryFile,
      join('/home/process', '.midnight-passport', 'registry.json'),
    );
  } finally {
    if (saved === undefined) delete process.env.HOME;
    else process.env.HOME = saved;
  }
});

test('PASSPORT_REGISTRY_FILE replaces the default, and HOME then plays no part', () => {
  const config = loadConfig({
    ...BASE,
    HOME: '/home/demo',
    PASSPORT_REGISTRY_FILE: '/srv/passport/accounts.json',
  });
  assert.equal(config.registryFile, '/srv/passport/accounts.json');
});

test('loading the configuration does not write to the environment', () => {
  const env = { ...BASE, HOME: '/nonexistent-home-for-test' };
  const before = JSON.stringify(env);
  loadConfig(env);
  assert.equal(JSON.stringify(env), before, 'the environment is not written to');
});

test('the contract directory and the manifest pin are required, and named when missing or empty', () => {
  assert.throws(() => loadConfig({ PASSPORT_MANIFEST_SHA256: 'ab' }), /set PASSPORT_CONTRACT_DIR/);
  assert.throws(() => loadConfig({ PASSPORT_CONTRACT_DIR: '/c' }), /set PASSPORT_MANIFEST_SHA256/);
  assert.throws(
    () => loadConfig({ ...BASE, PASSPORT_CONTRACT_DIR: '' }),
    /set PASSPORT_CONTRACT_DIR/,
  );
  assert.throws(
    () => loadConfig({ ...BASE, PASSPORT_MANIFEST_SHA256: '' }),
    /set PASSPORT_MANIFEST_SHA256/,
  );
});

test('the artefacts are read from contracts/managed/account in the contract directory', () => {
  const config = loadConfig({ ...BASE, PASSPORT_CONTRACT_DIR: '/work/acc' });
  assert.equal(config.contractDir, '/work/acc');
  assert.equal(config.artefactDir, '/work/acc/contracts/managed/account');
  assert.equal(config.manifestSha256, 'ab'.repeat(32));
});

test('the dapp origin, the binding id and the deploy cap have defaults and can each be set', () => {
  const defaults = loadConfig(BASE);
  assert.equal(defaults.corsOrigin, 'http://localhost:5173');
  assert.equal(defaults.bindingId, 'acc-45721e1');
  assert.equal(defaults.maxDeploys, 20);
  const set = loadConfig({
    ...BASE,
    PASSPORT_DAPP_ORIGIN: 'https://dapp.example',
    PASSPORT_BINDING_ID: 'acc-other',
    PASSPORT_MAX_DEPLOYS: '5',
  });
  assert.equal(set.corsOrigin, 'https://dapp.example');
  assert.equal(set.bindingId, 'acc-other');
  assert.equal(set.maxDeploys, 5);
});

test('the port accepts the whole 1 to 65535 range and nothing that is not plain digits', () => {
  for (const ok of ['1', '80', '8787', '65535']) {
    assert.equal(loadConfig({ ...BASE, PASSPORT_SERVICE_PORT: ok }).port, Number(ok));
  }
  for (const bad of [
    ' 80',
    '80 ',
    '+80',
    '0x50',
    '1e3',
    '8_0',
    '65536',
    '100000',
    '-0',
    '8080.0',
  ]) {
    assert.throws(
      () => loadConfig({ ...BASE, PASSPORT_SERVICE_PORT: bad }),
      /PASSPORT_SERVICE_PORT/,
      bad,
    );
  }
});

test('the deploy cap is a positive safe integer', () => {
  assert.equal(loadConfig({ ...BASE, PASSPORT_MAX_DEPLOYS: '1' }).maxDeploys, 1);
  assert.equal(
    loadConfig({ ...BASE, PASSPORT_MAX_DEPLOYS: '9007199254740991' }).maxDeploys,
    9007199254740991,
  );
  for (const bad of ['9007199254740992', '1e2', '0x10', ' 3', '3 ', '+3', '00']) {
    assert.throws(
      () => loadConfig({ ...BASE, PASSPORT_MAX_DEPLOYS: bad }),
      /PASSPORT_MAX_DEPLOYS/,
      bad,
    );
  }
});

test('the network id is a bech32-safe name: lower-case letters, digits and inner hyphens', () => {
  for (const ok of ['undeployed', 'preview', 'preprod', 'a', '0', 'dev-2', 'a-b-c', '1-1']) {
    assert.equal(loadStack({ MN_NETWORK_ID: ok }).networkId, ok);
  }
  for (const bad of ['-a', 'A', 'a_b', 'a b', 'a/b', 'a.b', 'é', 'a\n']) {
    assert.throws(() => loadStack({ MN_NETWORK_ID: bad }), /MN_NETWORK_ID/, JSON.stringify(bad));
  }
});

test('the localnet stack is built from the three host ports, and from nothing else in the environment', () => {
  assert.deepEqual(localnetStack({}), {
    networkId: LOCALNET_ID,
    nodeUri: 'http://localhost:19944',
    indexerUri: 'http://localhost:18088/api/v4/graphql',
    indexerWsUri: 'ws://localhost:18088/api/v4/graphql/ws',
    proofServerUri: 'http://127.0.0.1:16300',
  });
  // A custom network id does not move the ports, and the ports ignore the MN_*_URL variables.
  const moved = localnetStack({
    MN_NETWORK_ID: 'preview',
    MN_NODE_URL: 'https://node.example',
    MN_NODE_PORT: '1',
    MN_INDEXER_PORT: '2',
    MN_PROOF_PORT: '3',
  });
  assert.equal(moved.networkId, LOCALNET_ID);
  assert.equal(moved.nodeUri, 'http://localhost:1');
  assert.equal(moved.indexerUri, 'http://localhost:2/api/v4/graphql');
  assert.equal(moved.indexerWsUri, 'ws://localhost:2/api/v4/graphql/ws');
  assert.equal(moved.proofServerUri, 'http://127.0.0.1:3');
});

test('a malformed port variable surfaces as a malformed URL for the value it feeds', () => {
  assert.throws(() => loadStack({ MN_NODE_PORT: 'not a port' }), /MN_NODE_URL/);
  assert.throws(() => loadStack({ MN_INDEXER_PORT: 'x y' }), /MN_INDEXER_URL/);
  assert.throws(() => loadStack({ MN_PROOF_PORT: 'a b' }), /MN_PROOF_SERVER_URL/);
});

test('each stack URL error names its variable and the accepted schemes', () => {
  assert.throws(
    () => loadStack({ MN_NODE_URL: 'ws://node.example' }),
    /MN_NODE_URL must be a http or https URL, got "ws:\/\/node.example"/,
  );
  assert.throws(
    () => loadStack({ MN_INDEXER_WS_URL: 'https://indexer.example' }),
    /MN_INDEXER_WS_URL must be a ws or wss URL/,
  );
  assert.throws(
    () => loadStack({ MN_PROOF_SERVER_URL: 'prover:6300' }),
    /MN_PROOF_SERVER_URL must be a http or https URL/,
  );
  assert.throws(() => loadStack({ MN_INDEXER_URL: 'javascript:alert(1)' }), /MN_INDEXER_URL/);
  assert.throws(() => loadStack({ MN_INDEXER_URL: 'file:///etc/passwd' }), /MN_INDEXER_URL/);
});

test('the refusal of the default sponsor seed names the network and the variable', () => {
  assert.throws(
    () => loadConfig({ ...BASE, MN_NETWORK_ID: 'preprod' }),
    (e) => {
      const message = (e as Error).message;
      assert.match(message, /set PASSPORT_SPONSOR_SEED/);
      assert.match(message, /"preprod"/);
      return true;
    },
  );
});

test('the localnet default seed is a 32-byte hex value, and an explicit seed is used as given', () => {
  const dev = loadConfig(BASE).sponsorSeed;
  assert.match(dev, /^[0-9a-f]{64}$/);
  assert.equal(
    loadConfig({ ...BASE, PASSPORT_SPONSOR_SEED: 'ab'.repeat(32) }).sponsorSeed,
    'ab'.repeat(32),
  );
});
