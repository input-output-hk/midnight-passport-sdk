import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { createServer } from '../src/server.ts';
import { chainRoute } from '../src/routes/chain.ts';
import type { ChainBackend } from '../src/backend.ts';
import { testConfig } from './fixtures.ts';

function fakeBackend(delayMs = 30) {
  let active = 0;
  let maxActive = 0;
  const seen: Record<string, unknown> = {};
  const calls = { prove: 0, deploy: 0 };
  const backend: ChainBackend = {
    async check(p, k) {
      seen.check = [p, k];
      return [1n, undefined];
    },
    async prove(p, k, o) {
      calls.prove++;
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, delayMs));
      active--;
      seen.prove = [p, k, o];
      return Uint8Array.of(0xaa);
    },
    async balance(tx) {
      return Uint8Array.of(...tx, 0xbb);
    },
    async submit() {
      return 'txid-1';
    },
    async deploy(boot, enc) {
      calls.deploy++;
      seen.deploy = [boot, enc];
      return { address: 'cc'.repeat(32), txHashes: ['a', 'b'] };
    },
    sponsorKeys: () => ({ coinPublicKey: 'cp', encryptionPublicKey: 'ep' }),
  };
  return { backend, seen, calls, maxActive: () => maxActive };
}

async function start(t: TestContext, backend: ChainBackend) {
  const server = createServer(testConfig(), [chainRoute(backend)]);
  await new Promise<void>((r) => server.listen(0, r));
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  return `http://localhost:${(server.address() as AddressInfo).port}`;
}
const post = (url: string, body: unknown) =>
  fetch(url, { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body) });

test('/prove decodes hex, passes the binding input as bigint, and returns the proof', async (t) => {
  const f = fakeBackend();
  const base = await start(t, f.backend);
  const res = await post(`${base}/prove`, {
    preimage: '0102',
    keyLocation: 'k',
    overwriteBindingInput: '5',
  });
  assert.deepEqual(await res.json(), { proof: 'aa' });
  assert.deepEqual(f.seen.prove, [Uint8Array.of(1, 2), 'k', 5n]);
});

test('/prove without a binding input passes undefined', async (t) => {
  const f = fakeBackend();
  const base = await start(t, f.backend);
  await post(`${base}/prove`, { preimage: 'ff00', keyLocation: 'k' });
  assert.deepEqual(f.seen.prove, [Uint8Array.of(0xff, 0), 'k', undefined]);
});

test('/check returns bigints as decimal strings and undefined as null', async (t) => {
  const f = fakeBackend();
  const base = await start(t, f.backend);
  assert.deepEqual(
    await (await post(`${base}/check`, { preimage: '01', keyLocation: 'k' })).json(),
    {
      result: ['1', null],
    },
  );
});

test('proofs run one at a time even when requested concurrently', async (t) => {
  const f = fakeBackend();
  const base = await start(t, f.backend);
  await Promise.all(
    [1, 2, 3].map(() => post(`${base}/prove`, { preimage: '01', keyLocation: 'k' })),
  );
  assert.equal(f.maxActive(), 1);
  assert.equal(f.calls.prove, 3);
});

test('a failed proof does not wedge the queue', async (t) => {
  const f = fakeBackend();
  const ok = f.backend.prove.bind(f.backend);
  let first = true;
  f.backend.prove = async (p, k, o) => {
    if (first) {
      first = false;
      throw new Error('proof server down');
    }
    return ok(p, k, o);
  };
  const base = await start(t, f.backend);
  const failing = await post(`${base}/prove`, { preimage: '01', keyLocation: 'k' });
  assert.equal(failing.status, 502);
  const next = await post(`${base}/prove`, { preimage: '01', keyLocation: 'k' });
  assert.equal(next.status, 200);
  assert.deepEqual(await next.json(), { proof: 'aa' });
});

test('a proof queued behind a failing one still runs', async (t) => {
  const f = fakeBackend();
  const ok = f.backend.prove.bind(f.backend);
  let first = true;
  f.backend.prove = async (p, k, o) => {
    if (first) {
      first = false;
      await new Promise((r) => setTimeout(r, 30));
      throw new Error('boom');
    }
    return ok(p, k, o);
  };
  const base = await start(t, f.backend);
  const [a, b] = await Promise.all([
    post(`${base}/prove`, { preimage: '01', keyLocation: 'k' }),
    post(`${base}/prove`, { preimage: '01', keyLocation: 'k' }),
  ]);
  assert.deepEqual([a.status, b.status], [502, 200]);
});

test('/sponsor/balance and /sponsor/submit round-trip hex transactions', async (t) => {
  const f = fakeBackend();
  const base = await start(t, f.backend);
  assert.deepEqual(await (await post(`${base}/sponsor/balance`, { tx: '01' })).json(), {
    tx: '01bb',
  });
  assert.deepEqual(await (await post(`${base}/sponsor/submit`, { tx: '01bb' })).json(), {
    txId: 'txid-1',
  });
});

test('/deploy takes constructor inputs only and returns the address', async (t) => {
  const f = fakeBackend();
  const base = await start(t, f.backend);
  const body = (await (
    await post(`${base}/deploy`, { boot: '11'.repeat(32), encKey: '22'.repeat(32) })
  ).json()) as { address: string; txHashes: string[] };
  assert.equal(body.address, 'cc'.repeat(32));
  assert.deepEqual(body.txHashes, ['a', 'b']);
  assert.deepEqual(f.seen.deploy, [new Uint8Array(32).fill(0x11), new Uint8Array(32).fill(0x22)]);
  assert.equal((await post(`${base}/deploy`, { boot: '11' })).status, 400);
});

test('a backend failure on /prove is a 502 the client can map to ProverUnavailable', async (t) => {
  const f = fakeBackend();
  f.backend.prove = async () => {
    throw new Error('proof server down');
  };
  const base = await start(t, f.backend);
  const res = await post(`${base}/prove`, { preimage: '01', keyLocation: 'k' });
  assert.equal(res.status, 502);
  assert.match(((await res.json()) as { error: string }).error, /proof server down/);
});

test('backend failures on the other endpoints are 502 too', async (t) => {
  const f = fakeBackend();
  const fail = async () => {
    throw new Error('chain down');
  };
  f.backend.check = fail;
  f.backend.balance = fail;
  f.backend.submit = fail;
  f.backend.deploy = fail;
  const base = await start(t, f.backend);
  const bodies: [string, unknown][] = [
    ['/check', { preimage: '01', keyLocation: 'k' }],
    ['/sponsor/balance', { tx: '01' }],
    ['/sponsor/submit', { tx: '01' }],
    ['/deploy', { boot: '11'.repeat(32), encKey: '22'.repeat(32) }],
  ];
  for (const [path, body] of bodies) {
    assert.equal((await post(`${base}${path}`, body)).status, 502, path);
  }
});

test('a malformed JSON body is a 400, not a 502', async (t) => {
  const f = fakeBackend();
  const base = await start(t, f.backend);
  for (const path of ['/prove', '/check', '/sponsor/balance', '/sponsor/submit', '/deploy']) {
    const res = await post(`${base}${path}`, '{"preimage": ');
    assert.equal(res.status, 400, path);
    assert.match(((await res.json()) as { error: string }).error, /not valid JSON/);
  }
  assert.equal(f.calls.prove, 0);
});

test('bad fields are 400 and never reach the backend', async (t) => {
  const f = fakeBackend();
  const base = await start(t, f.backend);
  const bad: [string, unknown][] = [
    ['/prove', { preimage: 'zz', keyLocation: 'k' }],
    ['/prove', { preimage: '0', keyLocation: 'k' }],
    ['/prove', { preimage: '0A', keyLocation: 'k' }],
    ['/prove', { preimage: '', keyLocation: 'k' }],
    ['/prove', { preimage: '01' }],
    ['/prove', { preimage: '01', keyLocation: 'k', overwriteBindingInput: 'abc' }],
    ['/prove', { preimage: '01', keyLocation: 'k', overwriteBindingInput: 5 }],
    ['/prove', { preimage: '01', keyLocation: 'k', overwriteBindingInput: '-1' }],
    ['/prove', null],
    ['/prove', [1, 2]],
    ['/check', { keyLocation: 'k' }],
    ['/sponsor/balance', { tx: 5 }],
    ['/sponsor/submit', {}],
    ['/deploy', { boot: '11'.repeat(32), encKey: '22'.repeat(31) }],
    ['/deploy', { boot: '11'.repeat(33), encKey: '22'.repeat(32) }],
  ];
  for (const [path, body] of bad) {
    assert.equal(
      (await post(`${base}${path}`, body)).status,
      400,
      `${path} ${JSON.stringify(body)}`,
    );
  }
  assert.equal(f.calls.prove, 0);
  assert.equal(f.calls.deploy, 0);
  assert.equal(f.seen.check, undefined);
});

test('a bad /prove request does not wait behind a running proof', async (t) => {
  const f = fakeBackend(300);
  const base = await start(t, f.backend);
  const running = post(`${base}/prove`, { preimage: '01', keyLocation: 'k' });
  await new Promise((r) => setTimeout(r, 30));
  const started = Date.now();
  assert.equal((await post(`${base}/prove`, { preimage: 'zz', keyLocation: 'k' })).status, 400);
  assert.ok(Date.now() - started < 200);
  await running;
});

test('/deploy refuses an oversized body with 413', async (t) => {
  const f = fakeBackend();
  const base = await start(t, f.backend);
  const res = await post(`${base}/deploy`, { boot: '11'.repeat(32), encKey: '22'.repeat(5000) });
  assert.equal(res.status, 413);
  assert.equal(f.calls.deploy, 0);
});

test('other methods and paths fall through to 404', async (t) => {
  const f = fakeBackend();
  const base = await start(t, f.backend);
  assert.equal((await fetch(`${base}/prove`)).status, 404);
  assert.equal((await post(`${base}/sponsor`, { tx: '01' })).status, 404);
});
