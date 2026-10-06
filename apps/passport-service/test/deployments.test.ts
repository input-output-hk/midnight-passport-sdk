import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  DeploymentLog,
  deploymentsFile,
  registeredAddresses,
  sponsoredAddresses,
} from '../src/deployments.ts';

const A = 'aa'.repeat(32);
const B = 'bb'.repeat(32);
const C = 'cc'.repeat(32);

function setup(networkId = 'undeployed') {
  const dir = mkdtempSync(join(tmpdir(), 'acc-dep-'));
  const registryFile = join(dir, 'registry.json');
  return { config: { registryFile, networkId }, registryFile, dir };
}

const entry = (address: string) => ({ address, status: 'active' });

test('the deployments file sits beside the registry and survives a restart', () => {
  const { config, registryFile } = setup();
  assert.equal(
    deploymentsFile(registryFile),
    registryFile.replace(/registry\.json$/, 'registry.deployments.json'),
  );
  const log = new DeploymentLog(config);
  assert.deepEqual([...log.list()], []);
  log.add(A.toUpperCase());
  log.add(B);
  log.add(A);
  assert.deepEqual([...new DeploymentLog(config).list()].sort(), [A, B]);
  assert.equal(existsSync(`${deploymentsFile(registryFile)}.tmp`), false, 'written by rename');
});

test('deployments are kept per network', () => {
  const { config, registryFile } = setup();
  new DeploymentLog(config).add(A);
  const other = new DeploymentLog({ registryFile, networkId: 'testnet' });
  assert.deepEqual([...other.list()], []);
  other.add(B);
  assert.deepEqual([...new DeploymentLog(config).list()], [A]);
});

test('a corrupt deployments file fails closed', () => {
  const { config, registryFile } = setup();
  writeFileSync(deploymentsFile(registryFile), '{"undeployed": "nope"}');
  assert.throws(() => new DeploymentLog(config).list(), /deployments file/);
  writeFileSync(deploymentsFile(registryFile), 'not json');
  assert.throws(() => new DeploymentLog(config).add(A));
});

test('registeredAddresses reads one network of the registry, read-only', () => {
  const { registryFile } = setup();
  assert.deepEqual([...registeredAddresses(registryFile, 'undeployed')], []);
  const body = JSON.stringify({
    'undeployed/0a0b': entry(A),
    'undeployed/0c': entry(B.toUpperCase()),
    'testnet/0a0b': entry(C),
    'undeployed-x/01': entry(C),
  });
  writeFileSync(registryFile, body);
  assert.deepEqual([...registeredAddresses(registryFile, 'undeployed')].sort(), [A, B]);
  assert.equal(readFileSync(registryFile, 'utf8'), body);
  writeFileSync(registryFile, '[]');
  assert.throws(() => registeredAddresses(registryFile, 'undeployed'), /plain object/);
});

test('the sponsor funds only accounts that are registered here and deployed by this service', () => {
  const { config, registryFile } = setup();
  writeFileSync(
    registryFile,
    JSON.stringify({
      'undeployed/01': entry(A), // registered and deployed by us
      'undeployed/02': entry(B), // registered, not deployed by us
      'testnet/03': entry(C), // registered on another network only
    }),
  );
  const log = new DeploymentLog(config);
  log.add(A);
  log.add(C); // deployed by us, but registered only on testnet
  log.add('dd'.repeat(32)); // deployed by us, not registered
  assert.deepEqual([...sponsoredAddresses(config, log)], [A]);
  // A registration made after the deployment counts at once.
  writeFileSync(
    registryFile,
    JSON.stringify({ 'undeployed/01': entry(A), 'undeployed/04': entry('dd'.repeat(32)) }),
  );
  assert.deepEqual([...sponsoredAddresses(config, log)].sort(), [A, 'dd'.repeat(32)]);
});
