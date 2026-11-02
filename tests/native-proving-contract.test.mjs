import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createNativeProvingProvider } from '../scripts/qualification/native-proving-provider.mjs';

const preimage = Uint8Array.of(1, 2),
  opaque = Uint8Array.of(3),
  proof = Uint8Array.of(4);
const location = 'contract:' + 'ab'.repeat(32) + '/add_device_with_jubjub?vk=' + 'cd'.repeat(32);
function fixture() {
  /** @type {unknown[][]} */ const calls = [];
  const prover = {
    /** @param {Uint8Array} bytes @param {string} key @param {bigint} [binding] */
    async prove(bytes, key, binding) {
      assert.equal(this, prover);
      calls.push(['prove', bytes, key, binding]);
      return proof;
    },
    /** @param {Uint8Array} bytes @param {string} key */
    async check(bytes, key) {
      assert.equal(this, prover);
      calls.push(['check', bytes, key]);
      return opaque;
    },
  };
  const material = {
    proverKey: Uint8Array.of(5),
    verifierKey: Uint8Array.of(6),
    ir: Uint8Array.of(7),
  };
  const options = {
    prover,
    /** @param {string} key */
    lookupKey: async (key) => {
      calls.push(['lookup', key]);
      return material;
    },
    /** @param {Uint8Array} bytes */
    parseCheckResult: (bytes) => {
      calls.push(['parse', bytes]);
      return [7n, undefined];
    },
  };
  return { calls, options, material };
}
test('native proving bridge refuses incomplete composition before invoking any port', () => {
  for (const missing of ['prove', 'check', 'lookupKey', 'parseCheckResult']) {
    const f = fixture();
    /** @type {any} */ const options = {};
    Object.assign(options, f.options, { prover: { ...f.options.prover } });
    const target = missing === 'prove' || missing === 'check' ? options.prover : options;
    target[missing] = undefined;
    assert.throws(() => createNativeProvingProvider(options), /requires prove, check, lookupKey/);
    assert.deepEqual(f.calls, []);
  }
});
test('native bridge preserves proof binding input, receiver and checked key resolver', async () => {
  const f = fixture(),
    provider = createNativeProvingProvider(f.options);
  assert.equal(await provider.prove(preimage, location, 123n), proof);
  assert.equal(await provider.lookupKey(location), f.material);
  assert.deepEqual(f.calls, [
    ['prove', preimage, location, 123n],
    ['lookup', location],
  ]);
});
test('native bridge parses opaque check bytes exactly once into ledger check results', async () => {
  const f = fixture(),
    provider = createNativeProvingProvider(f.options);
  assert.deepEqual(await provider.check(preimage, location), [7n, undefined]);
  assert.deepEqual(f.calls, [
    ['check', preimage, location],
    ['parse', opaque],
  ]);
});
test('check decoding errors propagate without proving, looking up or sending anything', async () => {
  const f = fixture(),
    error = Error('malformed check response');
  f.options.parseCheckResult = () => {
    throw error;
  };
  await assert.rejects(createNativeProvingProvider(f.options).check(preimage, location), error);
  assert.deepEqual(f.calls, [['check', preimage, location]]);
});
test('wrong circuit response types cannot become a successful transaction proving input', async () => {
  const f = fixture();
  /** @type {any} */ const checkOptions = {
    ...f.options,
    prover: { ...f.options.prover, check: async () => [7n] },
  };
  await assert.rejects(
    createNativeProvingProvider(checkOptions).check(preimage, location),
    /opaque bytes/,
  );
  assert.deepEqual(f.calls, []);
  /** @type {any} */ const parseOptions = {
    ...f.options,
    parseCheckResult: () => opaque,
  };
  await assert.rejects(
    createNativeProvingProvider(parseOptions).check(preimage, location),
    /ledger check results/,
  );
  /** @type {any} */ const proveOptions = {
    ...f.options,
    prover: { ...f.options.prover, prove: async () => ({ proof }) },
  };
  await assert.rejects(
    createNativeProvingProvider(proveOptions).prove(preimage, location),
    /return bytes/,
  );
});
