import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { PassportNameError, resolvePassportName } from '../packages/account/dist/names.js';

const query = { name: 'alice.passport.test', networkId: 'undeployed' };
const record = { ...query, namespace: 'partner-example', accountAddress: '11'.repeat(32) };
/** @type {import('../packages/account/dist/names.js').PassportNameProvider} */
const provider = { id: 'partner', namespace: record.namespace, mode: 'external' };
/** @param {(query: import('../packages/account/dist/names.js').PassportNameQuery) => Promise<unknown>} resolve */
const service = (resolve) => ({
  provider: { ...provider },
  // Negative cases deliberately emulate untyped provider responses at the adapter boundary.
  resolve:
    /** @type {import('../packages/account/dist/names.js').PassportNameService['resolve']} */ (
      resolve
    ),
});
/** @param {import('../packages/account/dist/names.js').PassportNameErrorCode} expected */
const code = (expected) => (/** @type {unknown} */ error) =>
  error instanceof PassportNameError && error.code === expected;

test('read-only name resolution has a public lightweight subpath in the existing account package', () => {
  const manifest = JSON.parse(
    readFileSync(new URL('../packages/account/package.json', import.meta.url), 'utf8'),
  );
  assert.equal(manifest.exports['./names'].default, './dist/names.js');
  assert.equal(manifest.dependencies.react, undefined);
});

test('custom provider supplies a checked network/namespace-scoped public hint', async () => {
  let calls = 0;
  const result = await resolvePassportName(
    service(async (request) => {
      calls++;
      assert.deepEqual(request, query);
      assert.equal(Object.isFrozen(request), true);
      return { ...record, privateProviderExtension: 'never-copy-this' };
    }),
    query,
  );
  assert.equal(calls, 1);
  assert.deepEqual(result, { ...record, providerId: provider.id, mode: 'external' });
  assert.equal(Object.isFrozen(result), true);
  assert.equal(JSON.stringify(result).includes('never-copy-this'), false);
});

test('absence is distinct from provider/transport failure and exceptions are redacted', async () => {
  assert.equal(
    await resolvePassportName(
      service(async () => undefined),
      query,
    ),
    undefined,
  );
  await assert.rejects(
    resolvePassportName(
      service(async () => {
        throw Error('secret bearer=do-not-leak');
      }),
      query,
    ),
    (error) => {
      assert.ok(error instanceof PassportNameError);
      assert.equal(error.code, 'Unavailable');
      assert.equal(error.message.includes('do-not-leak'), false);
      assert.equal(error.cause, undefined);
      return true;
    },
  );
});

test('invalid queries refuse before invoking a provider; no implicit trim/case/Unicode normalisation', async () => {
  let calls = 0;
  const adapter = service(async () => {
    calls++;
    return record;
  });
  for (const change of [
    { name: '' },
    { name: ' alice.passport.test' },
    { name: 'a\nb' },
    { name: 'a\u202eb' },
    { name: 'a'.repeat(257) },
    { networkId: '' },
    { networkId: 'undeployed\n' },
    { networkId: '../undeployed' },
  ])
    await assert.rejects(
      resolvePassportName(adapter, { ...query, ...change }),
      code('InvalidQuery'),
    );
  assert.equal(calls, 0);
  const exact = { ...query, name: 'Alice.passport.test' };
  await assert.rejects(resolvePassportName(adapter, exact), code('InvalidRecord'));
  assert.equal(exact.name, 'Alice.passport.test');
});

test('invalid provider descriptors refuse before lookup', async () => {
  for (const change of [{ id: '' }, { namespace: '' }, { mode: 'verified' }]) {
    let calls = 0;
    const adapter = service(async () => {
      calls++;
    });
    Object.assign(adapter.provider, change);
    await assert.rejects(resolvePassportName(adapter, query), code('InvalidQuery'));
    assert.equal(calls, 0);
  }
});

test('malformed and differently scoped records never become accepted hints', async () => {
  for (const bad of [
    null,
    false,
    'name',
    {},
    { ...record, networkId: 'preview' },
    { ...record, namespace: 'another-provider' },
    { ...record, name: 'bob.passport.test' },
    { ...record, accountAddress: 'mn_unshielded_not_an_acc' },
    { ...record, accountAddress: 'AB'.repeat(32) },
    { ...record, accountAddress: '1'.repeat(63) },
    { ...record, expiresAt: '123' },
    { ...record, expiresAt: NaN },
    { ...record, expiresAt: -1 },
    { ...record, expiresAt: 1.5 },
  ])
    await assert.rejects(
      resolvePassportName(
        service(async () => bad),
        query,
      ),
      code('InvalidRecord'),
    );
});

test('expiry is checked after lookup; equal expiry and delayed responses refuse', async () => {
  let now = 1000;
  const result = await resolvePassportName(
    service(async () => ({ ...record, expiresAt: 1001 })),
    query,
    { now: () => now },
  );
  assert.ok(result);
  assert.equal(result.expiresAt, 1001);
  for (const expiresAt of [999, 1000]) {
    await assert.rejects(
      resolvePassportName(
        service(async () => ({ ...record, expiresAt })),
        query,
        { now: () => now },
      ),
      code('Expired'),
    );
  }
  await assert.rejects(
    resolvePassportName(
      service(async () => {
        now = 2000;
        return { ...record, expiresAt: 1500 };
      }),
      query,
      { now: () => now },
    ),
    code('Expired'),
  );
  await assert.rejects(
    resolvePassportName(
      service(async () => record),
      query,
      { now: () => NaN },
    ),
    code('InvalidQuery'),
  );
});

test('caller and descriptor mutation during lookup cannot change the captured resolution scope', async () => {
  const mutableQuery = { ...query };
  const adapter = service(async (request) => {
    mutableQuery.networkId = 'preview';
    adapter.provider.namespace = 'changed';
    adapter.provider.mode = 'mock';
    await Promise.resolve();
    return { ...record, ...request };
  });
  const result = await resolvePassportName(adapter, mutableQuery);
  assert.ok(result);
  assert.equal(result.networkId, query.networkId);
  assert.equal(result.namespace, record.namespace);
  assert.equal(result.mode, 'external');
});
