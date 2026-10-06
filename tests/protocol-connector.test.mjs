import { test } from 'node:test';
import assert from 'node:assert/strict';

const p = await import(new URL('../packages/protocol/dist/index.js', import.meta.url).href);

test('the connector version and error vocabulary are fixed constants', () => {
  assert.equal(p.PASSPORT_CONNECTOR_VERSION, '0.1.0-prototype');
  assert.equal(p.PASSPORT_ERROR_TYPE, 'PassportConnectorError');
  assert.equal(p.PASSPORT_NETWORK_UNDEPLOYED, 'undeployed');
  assert.deepEqual([...p.PASSPORT_ERROR_CODES].sort(), [
    'AccountNotFound', 'ArtefactIntegrity', 'InternalError', 'NetworkMismatch',
    'ProverUnavailable', 'SponsorRejected', 'UnsupportedAuthenticator', 'UserCancelled',
  ]);
  assert.ok(Object.isFrozen(p.PASSPORT_ERROR_CODES));
});
