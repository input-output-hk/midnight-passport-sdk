import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHostedAccChain } from '../packages/adapter-midnight-js/dist/index.js';
import { resolveBinding } from '../packages/contract/dist/index.js';

const pinned = resolveBinding('acc-s3r1.1');
const binding = {
  id: 'acc-s3r1.1',
  manifestSha256: pinned.manifestSha256,
  circuits: pinned.circuits,
};
const network = {
  bindingId: 'acc-s3r1.1',
  manifestSha256: pinned.manifestSha256,
};
const address = 'ab'.repeat(32);

// The exact pinned generated ledger used by Lace's ACC wrapper fits the hosted decoder port.
/** @param {import('../packages/contract/generated/acc-s3r1.1/index.js').Ledger} generated */
const acceptGeneratedLedger = (generated) => {
  /** @type {import('../packages/adapter-midnight-js/dist/hosted-chain.js').HostedAccLedger} */
  const ledger = generated;
  return ledger;
};
void acceptGeneratedLedger;

test('hosted chain maps Lace-shaped ledger and submits a pinned call through its handle', async () => {
  const device = new Uint8Array(32).fill(3);
  const oldEntry = new Uint8Array(192).fill(4);
  const newEntry = new Uint8Array(192).fill(5);
  /** @type {string[]} */
  const requests = [];
  /** @type {string | undefined} */
  let connectedAddress;
  /** @type {readonly unknown[] | undefined} */
  let submittedArgs;
  /** @type {import('../packages/adapter-midnight-js/dist/hosted-chain.js').HostedAccChainOptions} */
  const options = {
    network,
    binding,
    readLedger: async (readAddress) => {
      requests.push(readAddress);
      return {
        booted: true,
        auth_nonce: 7n,
        device_epoch: 2n,
        spec_version: 3n,
        enc_key: new Uint8Array(32).fill(6),
        devices: {
          member: (entry) => Buffer.from(entry).equals(Buffer.from(device)),
          size: () => 1n,
          *[Symbol.iterator]() {
            yield device;
          },
        },
        inbox: {
          size: () => 2n,
          *[Symbol.iterator]() {
            yield [1n, newEntry];
            yield [0n, oldEntry];
          },
        },
      };
    },
    connectHandle: async (connectAddress, flow) => {
      connectedAddress = connectAddress;
      assert.equal(flow.signal, undefined);
      return {
        callTx: {
          deposit_unshielded: async (...args) => {
            submittedArgs = args;
            return { public: { txId: 'landed-1', status: 'Success' } };
          },
        },
      };
    },
  };
  const chain = createHostedAccChain(options);
  const view = await chain.readAccount(address, { includeInbox: true, includeDevices: true });
  assert.ok(view);
  assert.equal(view.specVersion, 3);
  assert.equal(view.authNonce, 7n);
  assert.equal(view.hasEntry(device), true);
  assert.deepEqual(view.deviceEntries, [device]);
  assert.deepEqual(view.inboxEntries, [oldEntry, newEntry]);
  assert.deepEqual(requests, [address]);

  const result = await chain.call({ address, circuit: 'deposit_unshielded', args: [device, 7n] });
  assert.deepEqual(result, { txHash: 'landed-1' });
  assert.equal(connectedAddress, address);
  assert.deepEqual(submittedArgs, [device, 7n]);
});

test('hosted chain rejects an unpinned call or finalized failure before reporting success', async () => {
  assert.throws(
    () =>
      createHostedAccChain({
        network: { ...network, manifestSha256: '00'.repeat(32) },
        binding,
        readLedger: async () => undefined,
        connectHandle: async () => ({ callTx: {} }),
      }),
    /manifest differs/,
  );
  let calls = 0;
  const chain = createHostedAccChain({
    network,
    binding,
    readLedger: async () => undefined,
    connectHandle: async () => ({
      callTx: {
        deposit_shielded: async () => {
          calls++;
          return { public: { txId: 'failed-1', status: 'Failed' } };
        },
      },
    }),
  });
  await assert.rejects(
    chain.call({
      address,
      circuit: 'deposit_shielded',
      args: [],
      heldCoin: { nonce: new Uint8Array(32), color: new Uint8Array(32), value: 1n, mt_index: 0n },
    }),
    { code: 'BindingUnsupported' },
  );
  assert.equal(calls, 0);
  await assert.rejects(
    chain.call({ address, circuit: 'unknown_circuit', args: [] }),
    /absent from the pinned binding/,
  );
  assert.equal(calls, 0);
  await assert.rejects(
    chain.call({ address, circuit: 'deposit_shielded', args: [] }),
    /failed: Failed/,
  );
  assert.equal(calls, 1);

  const controller = new AbortController();
  const aborted = createHostedAccChain({
    network,
    binding,
    readLedger: async () => undefined,
    connectHandle: async () => {
      controller.abort();
      return {
        callTx: {
          deposit_shielded: async () => {
            calls++;
          },
        },
      };
    },
  });
  await assert.rejects(
    aborted.call({ address, circuit: 'deposit_shielded', args: [], signal: controller.signal }),
    /aborted before submission/,
  );
  assert.equal(calls, 1);
});
