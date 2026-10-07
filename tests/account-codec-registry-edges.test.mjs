// Edges of the hex codec and the registry client that account-registry.test.mjs leaves out:
// what the codec accepts and refuses, the wire shape of a record, URL construction, and the
// failure of each registry status class.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const a = await import(new URL('../packages/account/dist/index.js', import.meta.url).href);

/** @typedef {{ url: string; init: { method?: string; headers?: Record<string, string>; body?: string } | undefined }} Call */

/**
 * A fetch that answers every request with `reply`.
 * @param {{ status: number; body?: unknown; unreadable?: boolean }} reply
 */
function answering(reply) {
  /** @type {Call[]} */
  const calls = [];
  const fn = async (/** @type {string} */ url, /** @type {Call['init']} */ init) => {
    calls.push({ url, init });
    return {
      ok: reply.status >= 200 && reply.status < 300,
      status: reply.status,
      json: async () => {
        if (reply.unreadable) throw new SyntaxError('Unexpected token <');
        return reply.body;
      },
    };
  };
  return { fn, calls };
}

const record = {
  credentialId: Uint8Array.of(0x0a, 0xff),
  address: 'ab'.repeat(32),
  publicKey: { x: 0x0fn, y: 0n, identity: /** @type {const} */ (false) },
  policy: { rp_id_hash: new Uint8Array(32).fill(1), origin: Uint8Array.of(0, 1) },
  salt: Uint8Array.of(0xde, 0xad),
  status: 'active',
};

test('toHex pads every byte to two digits and holds nothing for no bytes', () => {
  assert.equal(a.toHex(Uint8Array.of(0, 1, 15, 16, 255)), '00010f10ff');
  assert.equal(a.toHex(new Uint8Array(0)), '');
});

test('fromHex accepts a 0x prefix, either case and the empty string', () => {
  assert.deepEqual(a.fromHex('0xAbCd'), Uint8Array.of(0xab, 0xcd));
  assert.deepEqual(a.fromHex('ABCD'), Uint8Array.of(0xab, 0xcd));
  assert.deepEqual(a.fromHex(''), new Uint8Array(0));
  assert.deepEqual(a.fromHex('0x'), new Uint8Array(0));
});

test('fromHex refuses odd lengths, non-hex characters, whitespace and a doubled prefix', () => {
  for (const bad of [
    '0',
    '0x0',
    'abc',
    'zz',
    'ab cd',
    ' ab',
    'ab\n',
    '0x0xab',
    '0Xab',
    '-1',
    '１２',
  ]) {
    assert.throws(() => a.fromHex(bad), /invalid hex/, JSON.stringify(bad));
  }
});

test('the fromHex error quotes at most 16 characters of the input, so a long secret is not echoed whole', () => {
  const long = `zz${'ab'.repeat(40)}`;
  assert.throws(
    () => a.fromHex(long),
    (e) => {
      const message = /** @type {Error} */ (e).message;
      assert.equal(message, `invalid hex: ${long.slice(0, 16)}…`);
      assert.ok(!message.includes(long));
      return true;
    },
  );
});

test('a record goes on the wire as bare lower-case hex, with the status and without extra members', async () => {
  const { fn, calls } = answering({ status: 204 });
  await a.createRegistryClient('http://svc', fn).put('undeployed', record);
  const body = JSON.parse(calls[0]?.init?.body ?? 'null');
  assert.deepEqual(body, {
    credentialId: '0aff',
    address: 'ab'.repeat(32),
    publicKey: { x: 'f', y: '0' },
    policy: { rp_id_hash: '01'.repeat(32), origin: '0001' },
    salt: 'dead',
    status: 'active',
  });
});

test('a record round-trips its 256-bit coordinates, zero and leading-zero values included', async () => {
  const big = {
    ...record,
    publicKey: { x: (1n << 256n) - 1n, y: 1n << 255n, identity: /** @type {const} */ (false) },
  };
  for (const original of [record, big]) {
    /** @type {string | undefined} */
    let stored;
    const reg = a.createRegistryClient(
      'http://svc',
      async (/** @type {string} */ _url, /** @type {Call['init']} */ init) => {
        if (init?.method === 'PUT') stored = init.body;
        return { ok: true, status: 200, json: async () => JSON.parse(stored ?? 'null') };
      },
    );
    await reg.put('n', original);
    assert.deepEqual(await reg.get('n', original.credentialId), original);
  }
});

test('the network id is URL-encoded and trailing slashes of any number are dropped', async () => {
  const { fn, calls } = answering({ status: 404 });
  const reg = a.createRegistryClient('http://svc/base///', fn);
  await reg.get('a/b c', Uint8Array.of(1));
  assert.equal(calls[0]?.url, 'http://svc/base/accounts/a%2Fb%20c/01');
  assert.equal(calls[0]?.init, undefined, 'a GET carries no body or method');
});

test('a registry that answers 404 has no record, and any other failure is an error naming the status', async () => {
  assert.equal(
    await a
      .createRegistryClient('http://svc', answering({ status: 404 }).fn)
      .get('n', Uint8Array.of(1)),
    undefined,
  );
  for (const status of [400, 401, 403, 500, 503]) {
    const reg = a.createRegistryClient('http://svc', answering({ status }).fn);
    await assert.rejects(
      reg.get('n', Uint8Array.of(1)),
      new RegExp(`registry GET failed: ${status}`),
    );
    await assert.rejects(reg.put('n', record), new RegExp(`registry PUT failed: ${status}`));
  }
});

test('a PUT answered with any 2xx succeeds, an unchanged re-PUT (204) included', async () => {
  for (const status of [200, 201, 204]) {
    await a.createRegistryClient('http://svc', answering({ status }).fn).put('n', record);
  }
});

test('a record the registry mangles is refused, never half-read', async () => {
  const wire = {
    credentialId: '0aff',
    address: 'ab'.repeat(32),
    publicKey: { x: 'f', y: '0' },
    policy: { rp_id_hash: '01', origin: '00' },
    salt: 'dead',
    status: 'active',
  };
  const get = (/** @type {unknown} */ body, unreadable = false) =>
    a
      .createRegistryClient('http://svc', answering({ status: 200, body, unreadable }).fn)
      .get('n', Uint8Array.of(1));
  await assert.rejects(get({ ...wire, salt: 'xyz' }), /invalid hex/);
  await assert.rejects(get({ ...wire, credentialId: 'abc' }), /invalid hex/);
  await assert.rejects(get({ ...wire, publicKey: { x: 'not hex', y: '0' } }), SyntaxError);
  await assert.rejects(get({ ...wire, publicKey: undefined }), TypeError);
  await assert.rejects(get(null), TypeError);
  await assert.rejects(get(undefined, true), SyntaxError);
  assert.equal((await get(wire))?.status, 'active');
});
