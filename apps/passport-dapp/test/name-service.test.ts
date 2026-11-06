import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolvePassportName } from '@input-output-hk/mn-passport-account/names';
import { createMockNameService } from '../src/mock-name-service.ts';
import { nameLookupMessage } from '../src/name-service.ts';

test('injected external naming adapters are not described as synthetic mock records', () => {
  assert.match(nameLookupMessage('mock', true), /Mock record found.*Synthetic ACC/);
  assert.match(
    nameLookupMessage('external', true),
    /Provider record found.*ownership is not verified/,
  );
  assert.doesNotMatch(nameLookupMessage('external', true), /mock|synthetic/i);
  for (const mode of ['mock', 'external'] as const) {
    assert.match(nameLookupMessage(mode, false), /Name not found/);
    assert.doesNotMatch(nameLookupMessage(mode, false), /mock|synthetic/i);
  }
});

test('mock adapter supplies isolated synthetic fixtures through the public SDK interface', async () => {
  const mock = createMockNameService('undeployed');
  const query = { name: 'alice.passport.test', networkId: 'undeployed' };
  const result = await resolvePassportName(mock, query);
  assert.equal(result?.mode, 'mock');
  assert.equal(result?.providerId, 'demo-memory');
  assert.equal(result?.namespace, 'passport-demo');
  assert.equal(result?.accountAddress, '11'.repeat(32));
  assert.equal(
    await resolvePassportName(mock, { ...query, name: 'absent.passport.test' }),
    undefined,
  );
  assert.equal(await resolvePassportName(mock, { ...query, networkId: 'preview' }), undefined);
  assert.equal(await resolvePassportName(createMockNameService('preview'), query), undefined);
  assert.equal('register' in mock, false);
  assert.equal('sign' in mock, false);
  assert.equal(Object.isFrozen(mock.provider), true);
});
