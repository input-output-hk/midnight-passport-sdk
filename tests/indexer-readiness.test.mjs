import test from 'node:test';
import assert from 'node:assert/strict';
import { dedicatedIndexerReadiness } from '../scripts/qualification/indexer-readiness.mjs';
const hash = 'a'.repeat(64),
  now = 1793226000000;
/** @param {any} [block] @param {any} [head] */
function fixture(block = { hash, height: 7300, timestamp: now - 12000 }, head = '0x' + hash) {
  /** @type {any[]} */ const calls = [];
  /** @type {typeof fetch} */ const fetcher = async (url, init) => {
    const body = JSON.parse(String(init?.body));
    calls.push({ url, body });
    assert.equal(init?.method, 'POST');
    assert.ok(init?.signal);
    let result;
    if (url === 'http://127.0.0.1:19954') {
      if (body.method === 'chain_getFinalizedHead') result = { result: head };
      else {
        assert.equal(body.method, 'chain_getHeader');
        assert.deepEqual(body.params, [head]);
        result = { result: { number: '0x1c84' } };
      }
    } else {
      assert.equal(url, 'http://127.0.0.1:18098/api/v4/graphql');
      assert.match(body.query, /^query QualificationFinality/);
      assert.deepEqual(body.variables, { offset: { hash } });
      result = { data: { block } };
    }
    return new Response(JSON.stringify(result), { status: 200 });
  };
  return { fetcher, calls };
}
test('readiness requires the exact node-finalized block in the indexer, not an old height-one response', async () => {
  const good = fixture();
  const result = await dedicatedIndexerReadiness({ fetch: good.fetcher, now: () => now });
  assert.deepEqual(result, {
    ready: true,
    finalizedHash: hash,
    finalizedHeight: 7300,
    timestamp: now - 12000,
    lagMs: 12000,
  });
  assert.equal(good.calls.length, 3);
  for (const block of [
    null,
    { hash: 'b'.repeat(64), height: 7300, timestamp: now },
    { hash, height: 7122, timestamp: now },
  ]) {
    const stale = fixture(block);
    assert.equal(
      (await dedicatedIndexerReadiness({ fetch: stale.fetcher, now: () => now })).ready,
      false,
    );
  }
});
test('readiness refuses stale or incompatible clocks even when a database answers successfully', async () => {
  for (const timestamp of [now - 6 * 3600000, now + 120001, Math.floor(now / 1000), null]) {
    const f = fixture({ hash, height: 7300, timestamp });
    assert.equal(
      (await dedicatedIndexerReadiness({ fetch: f.fetcher, now: () => now })).ready,
      false,
    );
  }
  const f = fixture();
  assert.equal(
    (await dedicatedIndexerReadiness({ fetch: f.fetcher, now: () => NaN })).ready,
    false,
  );
});
test('RPC, HTTP, malformed finality and transport failures cannot become readiness passes', async () => {
  for (const head of ['genesis', '0x' + 'z'.repeat(64), null]) {
    const f = fixture(undefined, head);
    assert.equal(
      (await dedicatedIndexerReadiness({ fetch: f.fetcher, now: () => now })).ready,
      false,
    );
    assert.equal(f.calls.length, 1);
  }
  for (const fetcher of [
    /** @type {typeof fetch} */ (async () => new Response('{}', { status: 503 })),
    /** @type {typeof fetch} */ (async () => new Response(JSON.stringify({ error: { code: -1 } }))),
    /** @type {typeof fetch} */ (
      async () => {
        throw new DOMException('offline', 'AbortError');
      }
    ),
  ])
    assert.equal(
      (await dedicatedIndexerReadiness({ fetch: fetcher, now: () => now })).ready,
      false,
    );
});
