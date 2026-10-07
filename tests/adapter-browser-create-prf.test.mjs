// The create-time PRF holder (packages/adapter-browser/src/create-prf.ts), unit by unit: held at
// most once, taken at most once, zeroed when it expires or after use, and never reachable from the
// credential object. The module is internal (not exported from the package index), so it is
// imported from dist directly; the timers are fake, and a spy on `Uint8Array#fill` shows which
// buffers are zeroed and what they held when they were.
import { mock, test } from 'node:test';
import assert from 'node:assert/strict';

const prfUrl = new URL('../packages/adapter-browser/dist/create-prf.js', import.meta.url).href;
const { holdCreatePrf, takeCreatePrf, copyPrfOutput, CREATE_PRF_TTL_MS } = await import(prfUrl);
const b = await import(new URL('../packages/adapter-browser/dist/index.js', import.meta.url).href);

/** @param {number} fill @returns {ArrayBuffer} */
const buffer = (fill) => new Uint8Array(32).fill(fill).buffer;
/** @param {number} first @param {number} second */
const results = (first = 0x11, second = 0x22) => ({ first: buffer(first), second: buffer(second) });
const credential = () => ({
  credentialId: Uint8Array.of(1, 2, 3),
  publicKey: { x: 1n, y: 2n, identity: /** @type {const} */ (false) },
  policy: { rp_id_hash: new Uint8Array(32), origin: new Uint8Array(21) },
});
const allEqual = (/** @type {Uint8Array} */ bytes, /** @type {number} */ value) =>
  bytes.every((v) => v === value);

/**
 * Fake setTimeout/clearTimeout, and a record of every 32-byte buffer that is zeroed with
 * `fill(0)`, with a snapshot of what it held at that moment.
 */
function harness() {
  mock.timers.enable({ apis: ['setTimeout'] });
  const original = Uint8Array.prototype.fill;
  /** @type {{ target: Uint8Array; before: Uint8Array }[]} */
  const zeroed = [];
  const spy = mock.method(
    Uint8Array.prototype,
    'fill',
    /** @this {Uint8Array} */ function (/** @type {number} */ value) {
      if (value === 0 && this.length === 32) zeroed.push({ target: this, before: this.slice() });
      return original.call(this, value);
    },
  );
  return {
    zeroed,
    /** What the zeroed buffers held, as the first byte of each. */
    held: () => zeroed.map((z) => z.before[0]),
    restore() {
      spy.mock.restore();
      mock.timers.reset();
    },
  };
}

test('both outputs are needed to hold anything, and a holder answers whether it did', () => {
  const c = credential();
  assert.equal(holdCreatePrf(c, undefined), false);
  assert.equal(holdCreatePrf(c, {}), false);
  assert.equal(holdCreatePrf(c, { first: buffer(1) }), false);
  assert.equal(holdCreatePrf(c, { second: buffer(2) }), false);
  assert.equal(takeCreatePrf(c), undefined, 'nothing was held');
  assert.equal(holdCreatePrf(c, results()), true);
  assert.ok(takeCreatePrf(c));
});

test('held outputs are taken once: the first take has them, the second and other credentials have none', () => {
  const h = harness();
  try {
    const mine = credential();
    const lookalike = credential(); // the same fields, another object
    holdCreatePrf(mine, results());
    assert.equal(takeCreatePrf(lookalike), undefined, 'keyed by the object, not by its fields');
    const taken = takeCreatePrf(mine);
    assert.ok(allEqual(taken.authoriser, 0x11));
    assert.ok(allEqual(taken.root, 0x22));
    assert.equal(takeCreatePrf(mine), undefined);
    // Taking cancels the expiry: the holder zeroes nothing, the caller owns the buffers now.
    mock.timers.tick(CREATE_PRF_TTL_MS * 2);
    assert.equal(h.zeroed.length, 0);
    assert.ok(allEqual(taken.root, 0x22));
  } finally {
    h.restore();
  }
});

test('held outputs are copies: the browser buffers are neither read later nor zeroed', () => {
  const h = harness();
  try {
    const c = credential();
    const source = results();
    holdCreatePrf(c, source);
    new Uint8Array(source.first).fill(0xff); // the browser reuses its buffer
    const taken = takeCreatePrf(c);
    assert.ok(allEqual(taken.authoriser, 0x11), 'the copy kept what the browser had at creation');
    taken.authoriser.fill(0);
    taken.root.fill(0);
    assert.ok(allEqual(new Uint8Array(source.second), 0x22), 'zeroing a copy leaves the source');
  } finally {
    h.restore();
  }
});

test('copyPrfOutput copies an ArrayBuffer or exactly the window of a view', () => {
  const backing = Uint8Array.from({ length: 16 }, (_, i) => i);
  const window = backing.subarray(4, 8);
  const fromView = copyPrfOutput(window);
  assert.deepEqual(fromView, Uint8Array.of(4, 5, 6, 7));
  assert.equal(fromView.buffer.byteLength, 4, 'not the whole backing buffer');
  fromView.fill(0);
  assert.deepEqual(backing.subarray(4, 8), Uint8Array.of(4, 5, 6, 7));
  const whole = copyPrfOutput(backing.buffer);
  assert.deepEqual(whole, backing);
  whole[0] = 99;
  assert.equal(backing[0], 0);
});

test('outputs nobody takes are zeroed exactly at the TTL, and then they are gone', () => {
  assert.equal(CREATE_PRF_TTL_MS, 60_000);
  const h = harness();
  try {
    const c = credential();
    holdCreatePrf(c, results(0x33, 0x44));
    mock.timers.tick(CREATE_PRF_TTL_MS - 1);
    assert.equal(h.zeroed.length, 0, 'still held one millisecond early');
    mock.timers.tick(1);
    assert.deepEqual(h.held().sort(), [0x33, 0x44], 'both outputs, with their real content');
    for (const z of h.zeroed) assert.ok(allEqual(z.target, 0), 'and zero now');
    assert.equal(takeCreatePrf(c), undefined);
  } finally {
    h.restore();
  }
});

test('outputs are held per credential: one credential expiring does not touch another', () => {
  const h = harness();
  try {
    const early = credential();
    const late = credential();
    holdCreatePrf(early, results(0x51, 0x52));
    mock.timers.tick(30_000);
    holdCreatePrf(late, results(0x61, 0x62));
    mock.timers.tick(30_000); // the first is due, the second is half-way
    assert.deepEqual(h.held().sort(), [0x51, 0x52]);
    const taken = takeCreatePrf(late);
    assert.ok(allEqual(taken.root, 0x62), 'untouched');
  } finally {
    h.restore();
  }
});

test('the outputs never appear on the credential object, in its keys, symbols or serialisation', () => {
  const c = credential();
  const keysBefore = Reflect.ownKeys(c);
  const json = JSON.stringify(c, (_k, v) => (typeof v === 'bigint' ? v.toString() : v));
  holdCreatePrf(c, results(0x77, 0x78));
  assert.deepEqual(Reflect.ownKeys(c), keysBefore);
  assert.equal(Object.getOwnPropertySymbols(c).length, 0);
  assert.equal(
    JSON.stringify(c, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)),
    json,
  );
  assert.deepEqual({ ...c }, c, 'a spread carries nothing extra');
  takeCreatePrf(c);
});

test('after use, the PRF seed derivation zeroes both outputs it took', async () => {
  const h = harness();
  try {
    const c = credential();
    holdCreatePrf(c, results(0x91, 0x92));
    const seed = await b.passkeySeed({
      credentialId: c.credentialId,
      created: c,
      rpId: 'localhost',
      // A ceremony would fail loudly here: the held outputs must have answered instead.
      credentials: {
        get: async () => {
          throw new Error('no ceremony expected');
        },
      },
    });
    assert.equal(seed.length, 64);
    const prfBuffers = h.zeroed.filter((z) => z.before[0] === 0x91 || z.before[0] === 0x92);
    assert.deepEqual(prfBuffers.map((z) => z.before[0]).sort(), [0x91, 0x92]);
    for (const z of prfBuffers) assert.ok(allEqual(z.target, 0));
    assert.equal(takeCreatePrf(c), undefined, 'consumed once');
    seed.fill(0);
  } finally {
    h.restore();
  }
});
