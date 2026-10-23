import assert from 'node:assert/strict';
import { test } from 'node:test';
import { requireOwnedContainer } from '../scripts/qualification/live-outages.mjs';

const name = 'mn-passport-qual-20261023-indexer-1';
const owned = () => ({
  Id: 'ab'.repeat(32),
  NetworkSettings: { Ports: { '8088/tcp': [{ HostIp: '127.0.0.1', HostPort: '18098' }] } },
  Mounts: [{ Type: 'volume', Name: 'mn-passport-qual-20261023_indexer-data' }],
  Name: `/${name}`,
  Config: {
    Labels: {
      'com.docker.compose.project': 'mn-passport-qual-20261023',
      'com.docker.compose.service': 'indexer',
    },
  },
});
test('outage qualification controls only the exact dedicated project/service/container ID', () => {
  assert.equal(requireOwnedContainer(owned(), name), 'ab'.repeat(32));
  for (const other of ['mn-passport-sdk-localnet-indexer-1', 'other-indexer-1'])
    assert.throws(() => requireOwnedContainer(owned(), other), /Refusing/);
  const wrongProject = owned();
  wrongProject.Config.Labels['com.docker.compose.project'] = 'mn-passport-sdk-localnet';
  assert.throws(() => requireOwnedContainer(wrongProject, name), /Refusing/);
  const wrongService = owned();
  wrongService.Config.Labels['com.docker.compose.service'] = 'node';
  assert.throws(() => requireOwnedContainer(wrongService, name), /Refusing/);
  const wrongIdentity = owned();
  wrongIdentity.Name = '/renamed';
  assert.throws(() => requireOwnedContainer(wrongIdentity, name), /Refusing/);
});

test('outage RPC endpoints and retained volumes must belong to the inspected dedicated stack', () => {
  const port = owned();
  /** @type {any} */ (port.NetworkSettings.Ports['8088/tcp'][0]).HostPort = '18088';
  assert.throws(() => requireOwnedContainer(port, name), /mismatched/);
  const volume = owned();
  /** @type {any} */ (volume.Mounts[0]).Name = 'mn-passport-sdk-localnet_indexer-data';
  assert.throws(() => requireOwnedContainer(volume, name), /non-owned/);
});
