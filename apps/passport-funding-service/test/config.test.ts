import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BINDING_VERSION, resolveBinding } from '@input-output-hk/mn-passport-contract';
import { loadFundingConfig } from '../src/config.ts';
import { deployedAddresses } from '../src/deployments.ts';

const dir = mkdtempSync(join(tmpdir(), 'passport-funding-config-'));
const tokenFile = join(dir, 'token');
const assetsFile = join(dir, 'assets.json');
const seedFile = join(dir, 'seed');
const deploymentsFile = join(dir, 'deployments.json');
writeFileSync(tokenFile, 'secret'.repeat(8));
writeFileSync(
  assetsFile,
  JSON.stringify([{ color: 'cd'.repeat(32), maxPerRequest: '10', maxPerUtcDay: '100' }]),
);
writeFileSync(seedFile, 'ab'.repeat(32));

const base = {
  PASSPORT_CONTRACT_DIR: '/pinned-contract',
  PASSPORT_FUNDING_TOKEN_FILE: tokenFile,
  PASSPORT_FUNDING_ASSETS_FILE: assetsFile,
  HOME: dir,
};

test('localnet uses the development wallet and the package manifest pin', () => {
  const config = loadFundingConfig(base);
  assert.equal(config.networkId, 'undeployed');
  assert.equal(config.bindingId, BINDING_VERSION);
  assert.equal(config.manifestSha256, resolveBinding(BINDING_VERSION).manifestSha256);
  assert.equal(config.walletSeed, '0'.repeat(63) + '1');
  assert.equal(config.assets[0]?.color, 'cd'.repeat(32));
  assert.equal(config.assets[0]?.maxPerRequest, 10n);
  assert.equal(config.port, 8789);
  assert.equal(config.host, '127.0.0.1');
  assert.equal(
    config.reservationsFile,
    join(dir, '.midnight-passport', 'funding-reservations.json'),
  );
});

test('non-standalone needs an explicit funded wallet and deployment list', () => {
  assert.throws(
    () => loadFundingConfig({ ...base, MN_NETWORK_ID: 'testnet' }),
    /FUNDING_SEED_FILE/,
  );
  assert.throws(
    () =>
      loadFundingConfig({
        ...base,
        MN_NETWORK_ID: 'testnet',
        PASSPORT_FUNDING_SEED_FILE: seedFile,
      }),
    /FUNDING_DEPLOYMENTS_FILE/,
  );
  const config = loadFundingConfig({
    ...base,
    MN_NETWORK_ID: 'testnet',
    PASSPORT_FUNDING_SEED_FILE: seedFile,
    PASSPORT_FUNDING_DEPLOYMENTS_FILE: deploymentsFile,
  });
  assert.equal(config.walletSeed, 'ab'.repeat(32));
  assert.equal(config.deploymentsFile, deploymentsFile);
});

test('startup refuses a changed binding, manifest, weak token and NIGHT outside localnet', () => {
  assert.throws(() => loadFundingConfig({ ...base, PASSPORT_BINDING_ID: 'other' }), /package pin/);
  assert.throws(
    () => loadFundingConfig({ ...base, PASSPORT_MANIFEST_SHA256: '00'.repeat(32) }),
    /package pin/,
  );
  const weakToken = join(dir, 'weak-token');
  writeFileSync(weakToken, 'short');
  assert.throws(
    () => loadFundingConfig({ ...base, PASSPORT_FUNDING_TOKEN_FILE: weakToken }),
    /32 characters/,
  );
  const night = join(dir, 'night.json');
  writeFileSync(
    night,
    JSON.stringify([{ color: '00'.repeat(32), maxPerRequest: '1', maxPerUtcDay: '2' }]),
  );
  assert.equal(
    loadFundingConfig({ ...base, PASSPORT_FUNDING_ASSETS_FILE: night }).assets[0]?.color,
    '00'.repeat(32),
  );
  assert.throws(
    () =>
      loadFundingConfig({
        ...base,
        MN_NETWORK_ID: 'testnet',
        PASSPORT_FUNDING_SEED_FILE: seedFile,
        PASSPORT_FUNDING_DEPLOYMENTS_FILE: deploymentsFile,
        PASSPORT_FUNDING_ASSETS_FILE: night,
      }),
    /NIGHT requires/,
  );
});

test('deployment eligibility is network scoped and a corrupt log fails closed', () => {
  const address = 'ab'.repeat(32);
  writeFileSync(
    deploymentsFile,
    JSON.stringify({ undeployed: [address], testnet: ['cd'.repeat(32)] }),
  );
  assert.deepEqual([...deployedAddresses(deploymentsFile, 'undeployed')], [address]);
  assert.deepEqual([...deployedAddresses(deploymentsFile, 'testnet')], ['cd'.repeat(32)]);
  writeFileSync(deploymentsFile, JSON.stringify({ undeployed: ['bad'] }));
  assert.throws(() => deployedAddresses(deploymentsFile, 'undeployed'), /invalid/);
});
