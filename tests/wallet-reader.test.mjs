import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  discoverWalletProviders,
  connectWalletReader,
  WalletReaderError,
} from '../packages/adapter-browser/dist/wallet.js';
const id = '10000000-0000-0000-0000-000000000001';
const color = 'ab'.repeat(32);
function fixture() {
  /** @type {unknown[]} */
  const calls = [];
  const state = {
    networkId: 'undeployed',
    status: 'connected',
    address: 'address',
    balances: /** @type {Record<string, unknown>} */ ({ [color]: 5n }),
  };
  const api = {
    async getConnectionStatus() {
      calls.push('status');
      return { status: state.status, networkId: state.networkId };
    },
    async getUnshieldedAddress() {
      calls.push('address');
      return { unshieldedAddress: state.address };
    },
    async getUnshieldedBalances() {
      calls.push('balances');
      return state.balances;
    },
    async makeTransfer() {
      assert.fail('value method');
    },
    async signData() {
      assert.fail('signing method');
    },
  };
  const initial = {
    name: '<b>Lace</b>',
    rdns: 'io.lace.wallet',
    apiVersion: '4.1.0',
    /** @param {string} network */
    async connect(network) {
      calls.push(['connect', network]);
      return api;
    },
  };
  const registry = { [id]: initial };
  const options = {
    networkId: 'undeployed',
    registry: () => registry,
    validateAddress: (/** @type {string} */ value, /** @type {string} */ network) =>
      value === 'address' && network === 'undeployed',
  };
  return { state, api, initial, registry, options, calls };
}

function candidate(/** @type {unknown} */ registry) {
  const provider = discoverWalletProviders(registry)[0];
  assert.ok(provider);
  return provider;
}

test('wallet discovery imports without globals and never connects or fetches an icon', async () => {
  assert.deepEqual(discoverWalletProviders(undefined), []);
  const f = fixture();
  Object.defineProperty(f.initial, 'icon', {
    get() {
      assert.fail('icon must not be read');
    },
  });
  const [provider] = discoverWalletProviders(f.registry);
  assert.ok(provider);
  assert.equal(provider.name, '<b>Lace</b>');
  assert.ok(Object.isFrozen(provider));
  assert.deepEqual(f.calls, []);
  for (const unsupported of ['3.0.0', '4.1.0-rc.1', '4.2.0', '5.0.0']) {
    f.initial.apiVersion = unsupported;
    assert.deepEqual(discoverWalletProviders(f.registry), []);
  }
  assert.deepEqual(discoverWalletProviders({ lace: f.initial }), []);
});

test('explicit connection exposes only immutable validated reads, not the connected API', async () => {
  const f = fixture();
  const reader = await connectWalletReader(candidate(f.registry), f.options);
  assert.deepEqual(Object.keys(reader).sort(), ['forget', 'read']);
  const view = await reader.read();
  assert.deepEqual(view, {
    networkId: 'undeployed',
    unshieldedAddress: 'address',
    unshieldedBalances: { [color]: 5n },
  });
  assert.ok(Object.isFrozen(view.unshieldedBalances));
  f.state.balances[color] = 9n;
  assert.equal(view.unshieldedBalances[color], 5n);
  reader.forget();
  await assert.rejects(reader.read(), { code: 'Disconnected' });
});

test('replacement and metadata changes before consent or during a read refuse the selected provider', async () => {
  for (const during of [false, true]) {
    const f = fixture();
    const [p] = discoverWalletProviders(f.registry);
    assert.ok(p);
    if (!during) f.initial.name = 'Replacement';
    if (!during) {
      await assert.rejects(connectWalletReader(p, f.options), { code: 'ProviderUnavailable' });
      continue;
    }
    const reader = await connectWalletReader(p, f.options);
    f.api.getUnshieldedAddress = async () => ({ unshieldedAddress: 'ignored replacement method' });
    f.initial.apiVersion = '4.0.1';
    await assert.rejects(reader.read(), { code: 'ProviderUnavailable' });
  }
});

test('network drift, disconnect and malformed/negative balances fail instead of showing zero', async () => {
  /** @type {((f: ReturnType<typeof fixture>) => void)[]} */
  const changes = [
    (f) => {
      f.state.networkId = 'mainnet';
    },
    (f) => {
      f.state.status = 'disconnected';
    },
    (f) => {
      f.state.address = 'wrong-kind-or-network';
    },
    (f) => {
      f.state.balances = { [color]: -1n };
    },
    (f) => {
      f.state.balances = { [color]: '5' };
    },
    (f) => {
      f.state.balances = { invalid: 5n };
    },
    (f) => {
      f.state.balances = { [color]: 1n << 128n };
    },
  ];
  for (const change of changes) {
    const f = fixture();
    const reader = await connectWalletReader(candidate(f.registry), f.options);
    change(f);
    await assert.rejects(reader.read());
  }
});

test('permission refusal is structural and never forwards arbitrary private provider details', async () => {
  const f = fixture();
  f.initial.connect = async () => {
    throw { type: 'DAppConnectorAPIError', code: 'PermissionRejected', message: 'private token' };
  };
  await assert.rejects(connectWalletReader(candidate(f.registry), f.options), (error) => {
    assert.ok(error instanceof Error && 'code' in error);
    assert.equal(error.code, 'PermissionRejected');
    assert.ok(!String(error).includes('private token'));
    return true;
  });
});

test('forget during an in-flight read refuses its late snapshot and never revokes wallet permissions', async () => {
  const f = fixture();
  /** @type {undefined | ((value: Record<string, unknown>) => void)} */
  let release;
  const wait = new Promise(
    /** @param {(value: Record<string, unknown>) => void} resolve */ (resolve) => {
      release = resolve;
    },
  );
  let waiting = false;
  f.api.getUnshieldedBalances = async () => {
    waiting = true;
    return await wait;
  };
  const reader = await connectWalletReader(candidate(f.registry), f.options);
  const read = reader.read();
  while (!waiting) await new Promise((resolve) => setImmediate(resolve));
  reader.forget();
  assert.ok(release);
  release({ [color]: 5n });
  await assert.rejects(read, { code: 'Disconnected' });
});

test('Map/Date and other unsupported balance objects are unavailable, never an empty wallet', async () => {
  for (const invalid of [new Map(), new Date(), [], Object.create({ inherited: true })]) {
    const f = fixture();
    f.api.getUnshieldedBalances = async () => invalid;
    const reader = await connectWalletReader(candidate(f.registry), f.options);
    await assert.rejects(reader.read(), { code: 'InvalidWalletResponse' });
  }
  const f = fixture();
  f.state.balances = Object.create(null);
  const reader = await connectWalletReader(candidate(f.registry), f.options);
  assert.deepEqual((await reader.read()).unshieldedBalances, {});
});

test('connected method getters and hostile error metadata never escape as private provider errors', async () => {
  const f = fixture();
  Object.defineProperty(f.api, 'getConnectionStatus', {
    get() {
      throw new Error('private provider data');
    },
  });
  await assert.rejects(connectWalletReader(candidate(f.registry), f.options), {
    code: 'WalletRequestFailed',
    message: 'WalletRequestFailed',
  });
  const g = fixture();
  g.initial.connect = async () => {
    throw Object.create(null, {
      type: {
        get() {
          throw new Error('secret getter');
        },
      },
    });
  };
  await assert.rejects(connectWalletReader(candidate(g.registry), g.options), {
    code: 'WalletRequestFailed',
    message: 'WalletRequestFailed',
  });
});

test('initial connection status response getters are normalized before exposing a reader', async () => {
  const f = fixture();
  f.api.getConnectionStatus = async () => {
    const response = { status: 'connected', networkId: 'undeployed' };
    Object.defineProperty(response, 'status', {
      get() {
        throw new Error('private status details');
      },
    });
    return response;
  };
  await assert.rejects(connectWalletReader(candidate(f.registry), f.options), {
    code: 'WalletRequestFailed',
    message: 'WalletRequestFailed',
  });
});

test('hostile error prototype traps and modified known errors cannot expose provider data', async () => {
  const modified = new WalletReaderError('PermissionRejected');
  modified.message = 'private extension details';
  for (const error of [
    modified,
    new Proxy(
      {},
      {
        getPrototypeOf() {
          throw new Error('private prototype details');
        },
      },
    ),
  ]) {
    const f = fixture();
    f.initial.connect = async () => {
      throw error;
    };
    await assert.rejects(connectWalletReader(candidate(f.registry), f.options), (failure) => {
      assert.ok(failure instanceof WalletReaderError);
      assert.equal(failure.message, failure.code);
      assert.doesNotMatch(failure.message, /private/);
      return true;
    });
  }
});
