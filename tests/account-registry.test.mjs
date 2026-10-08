import { test } from 'node:test';
import assert from 'node:assert/strict';

const a = await import(new URL('../packages/account/dist/index.js', import.meta.url).href);

const record = {
  credentialId: Uint8Array.of(1, 2, 3),
  address: 'ab'.repeat(32),
  publicKey: { x: 5n, y: 7n, identity: false },
  policy: {
    rp_id_hash: new Uint8Array(32).fill(9),
    origin: new TextEncoder().encode('http://localhost:5173'),
  },
  salt: new Uint8Array(32).fill(4),
  status: 'deployed',
};

function fakeFetch() {
  const store = new Map();
  /** @type {{ url: string; method: string; contentType: string | undefined }[]} */
  const calls = [];
  /**
   * @param {string} url
   * @param {{ method?: string; headers?: Record<string, string>; body?: string }} [init]
   */
  const fn = async (url, init = {}) => {
    calls.push({ url, method: init.method ?? 'GET', contentType: init.headers?.['content-type'] });
    const key = new URL(url).pathname;
    if ((init.method ?? 'GET') === 'PUT') {
      store.set(key, init.body);
      return { ok: true, status: 204, json: async () => ({}) };
    }
    if (!store.has(key)) return { ok: false, status: 404, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => JSON.parse(store.get(key)) };
  };
  return { fn, calls };
}

test('hex round-trips', () => {
  assert.deepEqual(a.fromHex(a.toHex(Uint8Array.of(0, 255, 16))), Uint8Array.of(0, 255, 16));
  assert.throws(() => a.fromHex('abc'), /hex/);
});

test('the registry client round-trips a record under its network and credential id', async () => {
  const { fn, calls } = fakeFetch();
  const reg = a.createRegistryClient('http://svc', fn);
  await reg.put('undeployed', record);
  const back = await reg.get('undeployed', record.credentialId);
  assert.deepEqual(back, record);
  assert.equal(
    /** @type {{ url: string }} */ (calls[0]).url,
    'http://svc/accounts/undeployed/010203',
  );
});

test('the registry PUT is application/json, which the service requires (I1)', async () => {
  const { fn, calls } = fakeFetch();
  await a.createRegistryClient('http://svc', fn).put('undeployed', record);
  assert.equal(calls[0]?.method, 'PUT');
  assert.equal(calls[0]?.contentType, 'application/json');
});

test('an unknown credential is undefined, not an error', async () => {
  const reg = a.createRegistryClient('http://svc', fakeFetch().fn);
  assert.equal(await reg.get('undeployed', Uint8Array.of(9)), undefined);
});

test('errors are typed and WebAuthn cancellation maps to UserCancelled', () => {
  const e = a.toPassportError(Object.assign(new Error('x'), { name: 'NotAllowedError' }));
  assert.equal(e.code, 'UserCancelled');
  assert.equal(e.type, 'PassportConnectorError');
  assert.ok(a.isPassportError(e));
  assert.equal(a.toPassportError(new Error('boom')).code, 'InternalError');
  const kept = new a.PassportConnectorError('NetworkMismatch', 'n');
  assert.equal(a.toPassportError(kept), kept);
});

test('a trailing slash on the base URL does not double the separator', async () => {
  const { fn, calls } = fakeFetch();
  const reg = a.createRegistryClient('http://svc/', fn);
  await reg.put('undeployed', record);
  assert.equal(
    /** @type {{ url: string }} */ (calls[0]).url,
    'http://svc/accounts/undeployed/010203',
  );
});

test('a connector error from another package copy keeps its code, message, cause and flags', () => {
  const foreign = Object.assign(new Error('x', { cause: 'c' }), {
    type: 'PassportConnectorError',
    code: 'NetworkMismatch',
  });
  const mapped = a.toPassportError(foreign);
  assert.ok(mapped instanceof a.PassportConnectorError);
  assert.deepEqual([mapped.code, mapped.message, mapped.cause], ['NetworkMismatch', 'x', 'c']);
  assert.equal(mapped.retryable, false, 'the code default, as it named none');
  const later = Object.assign(new Error('y'), { type: 'PassportConnectorError', code: 'Future' });
  const flagged = a.toPassportError(Object.assign(later, { retryable: true }), 'prove');
  assert.deepEqual(
    [flagged.code, flagged.retryable, flagged.step],
    ['InternalError', true, 'prove'],
  );
  // This copy's own error passes through unchanged.
  const own = new a.PassportConnectorError('Aborted', 'z', { step: 'deploy' });
  assert.equal(a.toPassportError(own, 'prove'), own);
});
