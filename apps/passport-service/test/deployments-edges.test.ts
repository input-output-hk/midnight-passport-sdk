// Failure edges of src/deployments.ts, which fails closed: a file the service cannot trust ends
// the sponsor's scope, it is never read as "nothing deployed" and never overwritten.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
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

function setup(networkId = 'undeployed') {
  const dir = mkdtempSync(join(tmpdir(), 'acc-dep-edges-'));
  const registryFile = join(dir, 'registry.json');
  return { dir, registryFile, config: { registryFile, networkId } };
}

test('the deployments file name replaces a trailing .json only', () => {
  assert.equal(deploymentsFile('/x/registry.json'), '/x/registry.deployments.json');
  assert.equal(deploymentsFile('/x/registry'), '/x/registry.deployments.json');
  assert.equal(deploymentsFile('/x/registry.json.bak'), '/x/registry.json.bak.deployments.json');
  assert.equal(deploymentsFile('/x/a.json/registry'), '/x/a.json/registry.deployments.json');
});

test('a deployments file of the wrong shape is refused whatever the shape is', () => {
  const { config, registryFile } = setup();
  const file = deploymentsFile(registryFile);
  for (const body of [
    '[]',
    'null',
    '"text"',
    '7',
    'true',
    '{"undeployed": "aa"}',
    '{"undeployed": {"0": "aa"}}',
    '{"undeployed": [1, 2]}',
    '{"undeployed": ["aa", null]}',
    '{"undeployed": ["aa"], "testnet": [["bb"]]}', // another network's bad entry spoils the file too
    '',
    '{"undeployed": ["aa"]',
  ]) {
    writeFileSync(file, body);
    assert.throws(() => new DeploymentLog(config).list(), Error, JSON.stringify(body));
  }
});

test('a failed add leaves a corrupt file as it was, and never leaves a temporary file', () => {
  const { config, registryFile } = setup();
  const file = deploymentsFile(registryFile);
  writeFileSync(file, '{"undeployed": "nope"}');
  assert.throws(() => new DeploymentLog(config).add(A), /deployments file/);
  assert.equal(readFileSync(file, 'utf8'), '{"undeployed": "nope"}');
  assert.equal(existsSync(`${file}.tmp`), false);
});

test('add keeps what other networks and earlier calls recorded', () => {
  const { config, registryFile } = setup();
  const file = deploymentsFile(registryFile);
  writeFileSync(file, JSON.stringify({ testnet: [B], undeployed: [A] }));
  new DeploymentLog(config).add('cc'.repeat(32));
  const stored = JSON.parse(readFileSync(file, 'utf8')) as Record<string, string[]>;
  assert.deepEqual(stored.testnet, [B]);
  assert.deepEqual([...(stored.undeployed ?? [])].sort(), [A, 'cc'.repeat(32)]);
});

test('addresses are stored lower-case, once, whatever case they arrive in', () => {
  const { config, registryFile } = setup();
  const log = new DeploymentLog(config);
  log.add(A.toUpperCase());
  log.add(A);
  log.add(A.toUpperCase());
  const stored = JSON.parse(readFileSync(deploymentsFile(registryFile), 'utf8')) as Record<
    string,
    string[]
  >;
  assert.deepEqual(stored.undeployed, [A]);
});

test('the deployments directory is created private, and a missing file reads as nothing deployed', () => {
  const { dir } = setup();
  const registryFile = join(dir, 'nested', 'deeper', 'registry.json');
  const log = new DeploymentLog({ registryFile, networkId: 'undeployed' });
  assert.deepEqual([...log.list()], []);
  log.add(A);
  assert.deepEqual([...log.list()], [A]);
  assert.equal(statSync(join(dir, 'nested', 'deeper')).mode & 0o077, 0, 'no group or other access');
});

test('registeredAddresses skips records without a string address and matches the network prefix exactly', () => {
  const { registryFile } = setup();
  writeFileSync(
    registryFile,
    JSON.stringify({
      'undeployed/01': { address: A },
      'undeployed/02': null,
      'undeployed/03': 'text',
      'undeployed/04': {},
      'undeployed/05': { address: 5 },
      'undeployed/06': { address: null },
      'undeployed-2/07': { address: B },
      undeployed: { address: B },
    }),
  );
  assert.deepEqual([...registeredAddresses(registryFile, 'undeployed')], [A]);
});

test('an unreadable registry file refuses, never reads as an empty registry', () => {
  const { registryFile } = setup();
  for (const body of ['not json', '', 'null', '7', '"x"']) {
    writeFileSync(registryFile, body);
    assert.throws(
      () => registeredAddresses(registryFile, 'undeployed'),
      Error,
      JSON.stringify(body),
    );
  }
});

test('the sponsor scope refuses when either file is unreadable, so the request is refused', () => {
  const { config, registryFile } = setup();
  const log = new DeploymentLog(config);
  log.add(A);
  writeFileSync(registryFile, JSON.stringify({ 'undeployed/01': { address: A } }));
  assert.deepEqual([...sponsoredAddresses(config, log)], [A]);

  writeFileSync(registryFile, '{broken');
  assert.throws(() => sponsoredAddresses(config, log));
  writeFileSync(registryFile, JSON.stringify({ 'undeployed/01': { address: A } }));

  writeFileSync(deploymentsFile(registryFile), '{"undeployed": 3}');
  assert.throws(() => sponsoredAddresses(config, log), /deployments file/);
});

test('a registered account this service did not deploy is outside its scope, in any letter case', () => {
  const { config, registryFile } = setup();
  const log = new DeploymentLog(config);
  log.add(A);
  writeFileSync(
    registryFile,
    JSON.stringify({
      'undeployed/01': { address: A.toUpperCase() },
      'undeployed/02': { address: B.toUpperCase() },
    }),
  );
  assert.deepEqual([...sponsoredAddresses(config, log)], [A]);
});
