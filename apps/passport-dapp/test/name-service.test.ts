import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import {
  resolvePassportName,
  type PassportNameService,
} from '@input-output-hk/mn-passport-account/names';
import { createMockNameService } from '../src/mock-name-service.ts';
import { nameLookupMessage, showDemoNameService } from '../src/name-service.ts';

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

test('external name login rechecks the contract target and refuses changed or unavailable records', async (t) => {
  class FakeNode extends EventTarget {
    value = '';
    textContent = '';
    disabled = false;
    hidden = false;
  }
  const ids = [
    'name-service-form',
    'name-service-name',
    'name-service-resolve',
    'name-service-status',
    'name-service-result',
    'name-service-open',
    'name-service-title',
    'name-service-help',
  ];
  const nodes = Object.fromEntries(ids.map((id) => [id, new FakeNode()])) as Record<
    string,
    FakeNode
  >;
  const node = (id: string): FakeNode => nodes[id]!;
  node('name-service-open').hidden = true;
  node('name-service-open').disabled = true;
  const priorDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: { getElementById: (id: string) => nodes[id] ?? null },
  });
  t.after(() => {
    if (priorDocument) Object.defineProperty(globalThis, 'document', priorDocument);
    else Reflect.deleteProperty(globalThis, 'document');
  });
  let target = 'aa'.repeat(32);
  let unavailable = false;
  const operations: Array<string | undefined> = [];
  const opened: string[] = [];
  const service: PassportNameService = {
    provider: { id: `midnames:${'33'.repeat(32)}`, namespace: 'night', mode: 'external' },
    async resolve(query) {
      operations.push(query.operation);
      if (unavailable) throw new Error('private provider error');
      if (query.name !== 'alice.night') return undefined;
      return {
        name: query.name,
        networkId: query.networkId,
        namespace: 'night',
        accountAddress: target,
        ...(query.operation && {
          addressClass: 'contract' as const,
          resolvedOperation: query.operation,
        }),
      };
    },
  };
  const dispose = showDemoNameService(service, 'undeployed', (address) => {
    opened.push(address);
    return true;
  });
  t.after(dispose);
  const waitFor = async (predicate: () => boolean) => {
    for (let i = 0; i < 100; i++) {
      if (predicate()) return;
      await delay(5);
    }
    assert.equal(predicate(), true);
  };
  const lookup = async () => {
    node('name-service-name').value = 'alice.night';
    node('name-service-form').dispatchEvent(new Event('submit', { cancelable: true }));
    await waitFor(() => node('name-service-status').textContent.includes('Provider record found'));
    assert.equal(node('name-service-open').hidden, false);
  };
  await lookup();
  node('name-service-open').dispatchEvent(new Event('click'));
  await waitFor(() => opened.length === 1);
  assert.deepEqual(opened, ['aa'.repeat(32)]);
  assert.equal(operations.at(-1), 'contract-call');

  node('name-service-name').value = 'other.night';
  node('name-service-name').dispatchEvent(new Event('input'));
  assert.equal(node('name-service-open').hidden, true);
  assert.equal(node('name-service-result').textContent, '');
  await lookup();
  target = 'bb'.repeat(32);
  node('name-service-open').dispatchEvent(new Event('click'));
  await waitFor(() => node('name-service-status').textContent.includes('Name target changed'));
  assert.deepEqual(opened, ['aa'.repeat(32)]);
  assert.equal(node('name-service-open').hidden, true);

  target = 'aa'.repeat(32);
  await lookup();
  unavailable = true;
  node('name-service-open').dispatchEvent(new Event('click'));
  await waitFor(() => node('name-service-status').textContent.startsWith('Unavailable'));
  assert.deepEqual(opened, ['aa'.repeat(32)]);
  assert.equal(node('name-service-open').hidden, true);
});
