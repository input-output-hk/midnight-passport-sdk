import assert from 'node:assert/strict';
import { test } from 'node:test';
import { depositByName } from '../src/midnames/deposit-by-name.js';
import { createMidnamesNameService, type MidnamesReads } from '../src/midnames/resolver.js';

const account = 'a'.repeat(64);
const registryAddress = 'b'.repeat(64);
const request = {
  name: 'alice.night',
  networkId: 'undeployed',
  requestId: '12345678-1234-4321-8123-123456789abc',
  color: new Uint8Array(32).fill(4),
  nonce: new Uint8Array(32).fill(5),
  amount: 10n,
};

function fixture() {
  const state = {
    target: { kind: 'contract', address: account } as Awaited<
      ReturnType<MidnamesReads['readTarget']>
    >,
    supported: true,
    available: true,
    approved: true,
    failSubmit: false,
    encKey: new Uint8Array(32),
    afterPrepare() {},
  };
  const order: string[] = [];
  const entry = new Uint8Array(192).fill(9);
  let dispatched = false;
  const ports: Parameters<typeof depositByName>[1] = {
    names: createMidnamesNameService(
      { networkId: request.networkId, namespace: 'night', registryAddress },
      {
        async readTarget() {
          order.push('resolve');
          if (!state.available) throw new Error('offline');
          return state.target;
        },
        async isSupportedAccount() {
          return state.supported;
        },
      },
    ),
    chain: {
      async readAccount() {
        return {
          booted: true,
          specVersion: 3,
          authNonce: 0n,
          deviceEpoch: 0n,
          entryCount: 1,
          hasEntry: () => false,
          encKey: state.encKey,
          inboxEntries: dispatched ? [entry] : [],
        };
      },
    },
    async sealCoin() {
      return entry;
    },
    async sleep() {
      assert.fail('Expected immediate inbox evidence');
    },
    async review(intent) {
      order.push('review');
      assert.deepEqual(intent, {
        name: request.name,
        networkId: request.networkId,
        providerId: `midnames:${registryAddress}`,
        namespace: 'night',
        accountAddress: account,
        color: '04'.repeat(32),
        amount: 10n,
      });
      return state.approved;
    },
    async prepare(coin) {
      order.push('prepare');
      assert.equal(coin.account, account);
      assert.equal(coin.requestId, request.requestId);
      assert.deepEqual(coin.entry, entry);
      state.afterPrepare();
      return async () => {
        order.push('dispatch');
        if (state.failSubmit) throw new Error('response lost');
        dispatched = true;
        return { txId: 'original-id' };
      };
    },
  };
  return { state, order, ports };
}

test('reviews the full destination and re-resolves after preparation before dispatch', async () => {
  const { ports, order } = fixture();
  const receipt = await depositByName(request, ports);
  assert.equal(receipt.txId, 'original-id');
  assert.equal(receipt.inboxIndex, 0);
  assert.deepEqual(order, ['resolve', 'review', 'prepare', 'resolve', 'dispatch']);
});

test('a name repoint or provider outage during preparation prevents dispatch', async () => {
  for (const failure of ['repoint', 'outage']) {
    const { state, ports, order } = fixture();
    state.afterPrepare = () => {
      if (failure === 'repoint') state.target = { kind: 'contract', address: 'c'.repeat(64) };
      else state.available = false;
    };
    await assert.rejects(depositByName(request, ports));
    assert.deepEqual(order, ['resolve', 'review', 'prepare', 'resolve']);
  }
});

test('a concurrent viewing key change during proof prevents dispatch', async () => {
  const { state, ports, order } = fixture();
  state.afterPrepare = () => {
    state.encKey = new Uint8Array(32).fill(7);
  };
  await assert.rejects(depositByName(request, ports), /encryption key changed/);
  assert.deepEqual(order, ['resolve', 'review', 'prepare']);
});

test('unknown names, non-contract targets, wrong network and unsupported bindings refuse before review', async () => {
  for (const scenario of ['unknown', 'non-contract', 'network', 'unsupported']) {
    const { state, ports, order } = fixture();
    if (scenario === 'unknown') state.target = undefined;
    if (scenario === 'non-contract') state.target = { kind: 'other', address: account };
    if (scenario === 'unsupported') state.supported = false;
    await assert.rejects(
      depositByName(scenario === 'network' ? { ...request, networkId: 'other' } : request, ports),
    );
    assert.deepEqual(order, scenario === 'network' ? [] : ['resolve']);
  }
});

test('declining approval prepares nothing and losing the dispatch result stays unsettled', async () => {
  const { state, ports, order } = fixture();
  state.approved = false;
  await assert.rejects(depositByName(request, ports), /declined/);
  assert.deepEqual(order, ['resolve', 'review']);

  state.approved = true;
  state.failSubmit = true;
  order.length = 0;
  await assert.rejects(depositByName(request, ports), { code: 'MutationUnsettled' });
  assert.deepEqual(order, ['resolve', 'review', 'prepare', 'resolve', 'dispatch']);
});
