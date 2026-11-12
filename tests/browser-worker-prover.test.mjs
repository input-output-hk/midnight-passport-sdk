import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { proveWorkerTransaction } from '../packages/adapter-browser/dist/ledger-worker-proof.js';
import {
  createBrowserWorkerProver,
  serveBrowserWorkerProver,
} from '../packages/adapter-browser/dist/worker-prover.js';

const require = createRequire(new URL('../packages/adapter-browser/package.json', import.meta.url));
const ledger =
  /** @type {typeof import('../packages/adapter-browser/node_modules/@midnightntwrk/ledger-v9/ledger-v9.d.ts')} */ (
    await import(pathToFileURL(require.resolve('@midnightntwrk/ledger-v9')).href)
  );
const channel = 'browser-prover-test';
const circuit = 'append_inbox_with_jubjub';
const scope = { networkId: 'undeployed', bindingId: 'acc-s3r1.1', circuits: [circuit] };

class Endpoint extends EventTarget {
  /** @type {Endpoint | undefined} */
  peer;
  /** @type {unknown[]} */
  posted = [];
  closes = 0;
  terminations = 0;

  /** @param {unknown} message */
  postMessage(message) {
    const data = structuredClone(message);
    this.posted.push(data);
    queueMicrotask(() => this.peer?.dispatchEvent(new MessageEvent('message', { data })));
  }

  close() {
    this.closes++;
  }

  terminate() {
    this.terminations++;
  }

  ready(name = channel) {
    this.dispatchEvent(
      new MessageEvent('message', {
        data: { protocol: 'passport-worker-prover-ready-v1', channel: name },
      }),
    );
  }

  /** @param {unknown} value */
  answer(value) {
    this.dispatchEvent(
      new MessageEvent('message', {
        data: { protocol: 'passport-background-v1', channel, id: 1, ok: true, value },
      }),
    );
  }
}

test('worker prover snapshots only the transaction and scope for the dedicated channel', async () => {
  const endpoint = new Endpoint();
  const prover = createBrowserWorkerProver(endpoint, { channel });
  const input = Uint8Array.of(7);
  const circuits = [circuit];
  const result = prover.proveTx(input, {
    ...scope,
    circuits,
    signal: new AbortController().signal,
    onEvent: () => assert.fail('The worker must not receive or call the host callback.'),
  });
  input[0] = 9;
  circuits[0] = 'withdraw_unshielded_with_p256';
  endpoint.ready('different-channel');
  assert.deepEqual(endpoint.posted, []);
  endpoint.ready();
  endpoint.ready();
  assert.deepEqual(endpoint.posted, [
    {
      protocol: 'passport-background-v1',
      channel,
      id: 1,
      method: 'proveTx',
      input: { ...scope, tx: Uint8Array.of(7) },
    },
  ]);
  endpoint.answer(Uint8Array.of(8));
  assert.deepEqual(await result, { tx: Uint8Array.of(8), provenance: 'local' });
  assert.deepEqual(input, Uint8Array.of(9));
  prover.close();
  prover.close();
  assert.equal(endpoint.terminations, 1);
});

test('an already cancelled or busy request leaves other worker work alone', async () => {
  const endpoint = new Endpoint();
  const prover = createBrowserWorkerProver(endpoint, { channel });
  const before = AbortSignal.abort('private cancellation reason');
  await assert.rejects(prover.proveTx(Uint8Array.of(1), { ...scope, signal: before }), {
    code: 'Aborted',
    message: 'Browser proof was cancelled.',
  });
  assert.deepEqual(endpoint.posted, []);
  endpoint.ready();
  const active = prover.proveTx(Uint8Array.of(2), scope);
  const competing = new AbortController();
  await assert.rejects(prover.proveTx(Uint8Array.of(3), { ...scope, signal: competing.signal }), {
    code: 'ProverUnavailable',
    message: 'Browser prover is busy.',
  });
  competing.abort();
  assert.equal(endpoint.terminations, 0);
  endpoint.answer(Uint8Array.of(8));
  assert.equal((await active).provenance, 'local');
  prover.close();
});

test('active cancellation terminates the worker, ignores late output and requires a new handle', async () => {
  const endpoint = new Endpoint();
  const prover = createBrowserWorkerProver(endpoint, { channel });
  endpoint.ready();
  const control = new AbortController();
  const active = prover.proveTx(Uint8Array.of(1), { ...scope, signal: control.signal });
  const rejected = assert.rejects(active, { code: 'Aborted' });
  control.abort();
  endpoint.answer(Uint8Array.of(7));
  await rejected;
  assert.equal(endpoint.terminations, 1);
  await assert.rejects(prover.proveTx(Uint8Array.of(2), scope), { code: 'ProverUnavailable' });
  assert.equal(endpoint.posted.length, 1);
});

for (const failure of ['timeout', 'invalid reply', 'worker error']) {
  test(`${failure} terminates the dedicated worker`, async () => {
    const endpoint = new Endpoint();
    const prover = createBrowserWorkerProver(endpoint, { channel, timeoutMs: 20 });
    const result = assert.rejects(prover.proveTx(Uint8Array.of(1), scope), {
      code: 'ProverUnavailable',
      message: 'Browser proof did not complete.',
    });
    if (failure === 'invalid reply') {
      endpoint.ready();
      endpoint.answer(new Uint8Array());
    }
    if (failure === 'worker error') endpoint.dispatchEvent(new Event('error'));
    await result;
    assert.equal(endpoint.terminations, 1);
  });
}

test('invalid bytes and circuit declarations are rejected before posting', async () => {
  const endpoint = new Endpoint();
  const prover = createBrowserWorkerProver(endpoint, { channel });
  for (const tx of [
    new Uint8Array(),
    new Uint8Array(8 * 1024 * 1024 + 1),
    new Uint8Array(new SharedArrayBuffer(1)),
  ])
    await assert.rejects(prover.proveTx(tx, scope), { code: 'InternalError' });
  await assert.rejects(
    prover.proveTx(Uint8Array.of(1), { ...scope, circuits: [circuit, circuit] }),
    {
      code: 'InternalError',
    },
  );
  assert.deepEqual(endpoint.posted, []);
  prover.close();
});

test('worker independently pins scope and sanitizes malformed Ledger input', async () => {
  const client = new Endpoint();
  const worker = new Endpoint();
  client.peer = worker;
  worker.peer = client;
  const prover = createBrowserWorkerProver(client, { channel });
  let engineCalls = 0;
  const unused = async () => {
    engineCalls++;
    throw new Error('private engine failure');
  };
  const configuredCircuits = [circuit];
  const stop = serveBrowserWorkerProver(worker, {
    ...scope,
    channel,
    circuits: configuredCircuits,
    provider: { lookupKey: unused, check: unused, prove: unused },
  });
  try {
    configuredCircuits.push('append_inbox_with_p256');
    for (const request of [
      { ...scope, networkId: 'preview' },
      { ...scope, bindingId: 'different-binding' },
      { ...scope, circuits: ['append_inbox_with_p256'] },
      scope,
    ])
      await assert.rejects(prover.proveTx(Uint8Array.of(1, 2), request), (error) => {
        assert.ok(error instanceof Error && 'code' in error);
        assert.equal(error.code, 'ProverUnavailable');
        assert.equal(error.message, 'Browser proof did not complete.');
        assert.equal(error.cause, undefined);
        return true;
      });
    assert.equal(worker.posted.length, 5);
    assert.equal(client.terminations, 0);
    assert.equal(engineCalls, 0);
  } finally {
    stop();
    prover.close();
  }
});

test('Ledger transaction admission refuses wrong-network and missing contract calls', async () => {
  const provider = {
    async check() {
      assert.fail('An inadmissible Ledger transaction reached the proving engine.');
    },
    async lookupKey() {
      assert.fail('An inadmissible Ledger transaction reached the proving engine.');
    },
    async prove() {
      assert.fail('An inadmissible Ledger transaction reached the proving engine.');
    },
  };
  await assert.rejects(
    proveWorkerTransaction(ledger.Transaction.fromParts('preview').serialize(), scope, provider),
    /network/i,
  );
  await assert.rejects(
    proveWorkerTransaction(ledger.Transaction.fromParts('undeployed').serialize(), scope, provider),
    /circuits differ/,
  );
});

test('the public subpath resolves to the worker adapter from a consumer', async () => {
  const entry = await import(
    pathToFileURL(require.resolve('@input-output-hk/mn-passport-adapter-browser/worker-prover'))
      .href
  );
  assert.equal(entry.createBrowserWorkerProver, createBrowserWorkerProver);
  assert.equal(entry.serveBrowserWorkerProver, serveBrowserWorkerProver);
});

test('invalid startup settings release the dedicated worker', () => {
  for (const options of [{ channel: ' ' }, { channel, timeoutMs: 0 }]) {
    const endpoint = new Endpoint();
    assert.throws(() => createBrowserWorkerProver(endpoint, options), { code: 'InvalidMessage' });
    assert.equal(endpoint.terminations, 1);
    assert.deepEqual(endpoint.posted, []);
  }
});

const address = 'ab'.repeat(32);
const hash = 'c7b4858b558b2d53ba36567ae2ff27f9f855593ad8910ebaf60f84b10d9bf601';
const location = `contract:${address}/${circuit}?vk=${hash}`;

/** @param {string} keyLocation */
function contractTransaction(keyLocation) {
  const empty = { value: [], alignment: [] };
  const call = new ledger.ContractCallPrototype(
    address,
    circuit,
    new ledger.ContractOperation(),
    undefined,
    undefined,
    [],
    empty,
    empty,
    ledger.communicationCommitmentRandomness(),
    keyLocation,
  );
  return ledger.Transaction.fromParts(
    scope.networkId,
    undefined,
    undefined,
    ledger.Intent.new(new Date(2000000000000)).addCall(call),
  ).serialize();
}

test('Ledger admits the exact binding key location before invoking the provider', async () => {
  const resources = await readFile(
    new URL('../packages/contract/resources/acc-s3r1.1.zkir.json.gz', import.meta.url),
  );
  const { files } = JSON.parse(gunzipSync(resources).toString());
  const keyMaterial = {
    proverKey: new Uint8Array(),
    verifierKey: Buffer.from(files[`keys/${circuit}.verifier`], 'base64'),
    ir: Buffer.from(files[`zkir/${circuit}.bzkir`], 'base64'),
  };
  /** @type {string[]} */
  const seen = [];
  const provider = {
    /** @param {string} requested */
    async lookupKey(requested) {
      seen.push(requested);
      return keyMaterial;
    },
    /** @param {Uint8Array} _preimage @param {string} requested */
    async check(_preimage, requested) {
      seen.push(requested);
      return [];
    },
    /** @param {Uint8Array} _preimage @param {string} requested */
    async prove(_preimage, requested) {
      seen.push(requested);
      return new ledger.Proof('0100').serialize();
    },
  };
  const tx = await proveWorkerTransaction(contractTransaction(location), scope, provider);
  const proved = ledger.Transaction.deserialize('signature', 'proof', 'pre-binding', tx);
  assert.equal([...(proved.intents?.values() ?? [])][0]?.actions.length, 1);
  assert.ok(seen.length >= 2 && seen.every((entry) => entry === location));
  seen.length = 0;
  await assert.rejects(
    proveWorkerTransaction(
      contractTransaction(location.replace(hash, '0'.repeat(64))),
      scope,
      provider,
    ),
    /Proving location differs from the binding/,
  );
  assert.deepEqual(seen, []);
});
