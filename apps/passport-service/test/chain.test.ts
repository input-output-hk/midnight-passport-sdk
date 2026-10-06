import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { createServer } from '../src/server.ts';
import { HttpError } from '../src/http.ts';
import { chainRoute, type ChainRouteOptions } from '../src/routes/chain.ts';
import type { ChainBackend } from '../src/backend.ts';
import { guardedBalance, type LedgerTxLike } from '../src/sponsor-policy.ts';
import { testConfig } from './fixtures.ts';

const CIRCUIT = 'c';
const ADDRESS = 'cc'.repeat(32);
const VK = 'ab'.repeat(32);

function fakeBackend(delayMs = 30) {
  let active = 0;
  let maxActive = 0;
  const seen: Record<string, unknown> = {};
  const calls = { prove: 0, check: 0, deploy: 0, balance: 0 };
  const busy = async () => {
    active++;
    maxActive = Math.max(maxActive, active);
    await new Promise((r) => setTimeout(r, delayMs));
    active--;
  };
  const backend: ChainBackend = {
    async check(p, k) {
      calls.check++;
      seen.check = [p, k];
      return [1n, undefined];
    },
    async prove(p, k, o) {
      calls.prove++;
      await busy();
      seen.prove = [p, k, o];
      return Uint8Array.of(0xaa);
    },
    async balance(tx) {
      calls.balance++;
      return Uint8Array.of(...tx, 0xbb);
    },
    async submit() {
      return 'txid-1';
    },
    async deploy(boot, enc) {
      calls.deploy++;
      await busy();
      seen.deploy = [boot, enc];
      return { address: ADDRESS, txHashes: ['a', 'b'] };
    },
    sponsorKeys: () => ({ coinPublicKey: 'cp', encryptionPublicKey: 'ep' }),
  };
  return { backend, seen, calls, maxActive: () => maxActive };
}

async function start(
  t: TestContext,
  backend: ChainBackend,
  options: Partial<ChainRouteOptions> = {},
) {
  const logs: string[] = [];
  const route = chainRoute(backend, {
    circuits: new Set([CIRCUIT]),
    maxDeploys: 20,
    log: (m) => logs.push(m),
    ...options,
  });
  const server = createServer(testConfig(), [route]);
  await new Promise<void>((r) => server.listen(0, r));
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  return { base: `http://localhost:${(server.address() as AddressInfo).port}`, logs };
}
const post = (url: string, body: unknown) =>
  fetch(url, { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body) });
const deployBody = { boot: '11'.repeat(32), encKey: '22'.repeat(32) };

test('/prove decodes hex, passes the binding input as bigint, and returns the proof', async (t) => {
  const f = fakeBackend();
  const { base } = await start(t, f.backend);
  const res = await post(`${base}/prove`, {
    preimage: '0102',
    keyLocation: CIRCUIT,
    overwriteBindingInput: '5',
  });
  assert.deepEqual(await res.json(), { proof: 'aa' });
  assert.deepEqual(f.seen.prove, [Uint8Array.of(1, 2), CIRCUIT, 5n]);
});

test('/prove without a binding input passes undefined', async (t) => {
  const f = fakeBackend();
  const { base } = await start(t, f.backend);
  await post(`${base}/prove`, { preimage: 'ff00', keyLocation: CIRCUIT });
  assert.deepEqual(f.seen.prove, [Uint8Array.of(0xff, 0), CIRCUIT, undefined]);
});

test('/check returns bigints as decimal strings and undefined as null', async (t) => {
  const f = fakeBackend();
  const { base } = await start(t, f.backend);
  assert.deepEqual(
    await (await post(`${base}/check`, { preimage: '01', keyLocation: CIRCUIT })).json(),
    { result: ['1', null] },
  );
});

test('proofs run one at a time even when requested concurrently', async (t) => {
  const f = fakeBackend();
  const { base } = await start(t, f.backend);
  await Promise.all(
    [1, 2, 3].map(() => post(`${base}/prove`, { preimage: '01', keyLocation: CIRCUIT })),
  );
  assert.equal(f.maxActive(), 1);
  assert.equal(f.calls.prove, 3);
});

test('a deployment never overlaps a proof', async (t) => {
  const f = fakeBackend(60);
  const { base } = await start(t, f.backend);
  const results = await Promise.all([
    post(`${base}/prove`, { preimage: '01', keyLocation: CIRCUIT }),
    post(`${base}/deploy`, deployBody),
    post(`${base}/prove`, { preimage: '01', keyLocation: CIRCUIT }),
  ]);
  assert.deepEqual(
    results.map((r) => r.status),
    [200, 200, 200],
  );
  assert.equal(f.maxActive(), 1);
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
  const { base } = await start(t, f.backend);
  const failing = await post(`${base}/prove`, { preimage: '01', keyLocation: CIRCUIT });
  assert.equal(failing.status, 502);
  const next = await post(`${base}/prove`, { preimage: '01', keyLocation: CIRCUIT });
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
  const { base } = await start(t, f.backend);
  const [a, b] = await Promise.all([
    post(`${base}/prove`, { preimage: '01', keyLocation: CIRCUIT }),
    post(`${base}/prove`, { preimage: '01', keyLocation: CIRCUIT }),
  ]);
  // Which request reaches the queue first is not fixed; one fails, the other must still run.
  assert.deepEqual([a.status, b.status].sort(), [200, 502]);
});

test('jobs beyond the queue depth are refused with 503, the rest still run', async (t) => {
  const f = fakeBackend(150);
  const { base } = await start(t, f.backend, { maxQueued: 2 });
  const statuses: number[] = [];
  for (let i = 0; i < 5; i++) {
    // Staggered so each reaches the queue in order; the first is running before the rest arrive.
    void post(`${base}/prove`, { preimage: '01', keyLocation: CIRCUIT }).then((r) =>
      statuses.push(r.status),
    );
    await new Promise((r) => setTimeout(r, 20));
  }
  await new Promise((r) => setTimeout(r, 700));
  assert.deepEqual(statuses.sort(), [200, 200, 200, 503, 503]);
  assert.equal(f.calls.prove, 3);
});

test('/sponsor/balance and /sponsor/submit round-trip hex transactions', async (t) => {
  const f = fakeBackend();
  const { base } = await start(t, f.backend);
  assert.deepEqual(await (await post(`${base}/sponsor/balance`, { tx: '01' })).json(), {
    tx: '01bb',
  });
  assert.deepEqual(await (await post(`${base}/sponsor/submit`, { tx: '01bb' })).json(), {
    txId: 'txid-1',
  });
});

test('/deploy takes constructor inputs only and returns the address', async (t) => {
  const f = fakeBackend();
  const { base } = await start(t, f.backend);
  const body = (await (await post(`${base}/deploy`, deployBody)).json()) as {
    address: string;
    txHashes: string[];
  };
  assert.equal(body.address, ADDRESS);
  assert.deepEqual(body.txHashes, ['a', 'b']);
  assert.deepEqual(f.seen.deploy, [new Uint8Array(32).fill(0x11), new Uint8Array(32).fill(0x22)]);
  assert.equal((await post(`${base}/deploy`, { boot: '11' })).status, 400);
});

test('/deploy stops at the cap with 429, and failed deployments count', async (t) => {
  const f = fakeBackend(5);
  const deploy = f.backend.deploy.bind(f.backend);
  f.backend.deploy = async (b, e) => {
    if (f.calls.deploy === 0) {
      f.calls.deploy++;
      throw new Error('wave failed');
    }
    return deploy(b, e);
  };
  const { base } = await start(t, f.backend, { maxDeploys: 3 });
  const statuses: number[] = [];
  for (let i = 0; i < 5; i++) statuses.push((await post(`${base}/deploy`, deployBody)).status);
  assert.deepEqual(statuses, [502, 200, 200, 429, 429]);
  assert.equal(f.calls.deploy, 3);
  // Malformed requests are refused before they are counted.
  const fresh = fakeBackend(5);
  const { base: base2 } = await start(t, fresh.backend, { maxDeploys: 1 });
  assert.equal((await post(`${base2}/deploy`, { boot: '11' })).status, 400);
  assert.equal((await post(`${base2}/deploy`, deployBody)).status, 200);
});

test('a backend failure on /prove is a 502 the client can map to ProverUnavailable', async (t) => {
  const f = fakeBackend();
  f.backend.prove = async () => {
    throw new Error('proof server down');
  };
  const { base, logs } = await start(t, f.backend);
  const res = await post(`${base}/prove`, { preimage: '01', keyLocation: CIRCUIT });
  assert.equal(res.status, 502);
  assert.match(((await res.json()) as { error: string }).error, /proof server down/);
  assert.match(logs.join('\n'), /\/prove failed: proof server down/);
});

test('sponsor and deploy failures are 502 with a generic message, logged in full', async (t) => {
  const f = fakeBackend();
  const fail = async () => {
    throw new Error('wallet detail: secret-ish');
  };
  f.backend.check = fail;
  f.backend.balance = fail;
  f.backend.submit = fail;
  f.backend.deploy = fail;
  const { base, logs } = await start(t, f.backend);
  const bodies: [string, unknown, boolean][] = [
    ['/check', { preimage: '01', keyLocation: CIRCUIT }, true],
    ['/sponsor/balance', { tx: '01' }, false],
    ['/sponsor/submit', { tx: '01' }, false],
    ['/deploy', deployBody, false],
  ];
  for (const [path, body, exposed] of bodies) {
    const res = await post(`${base}${path}`, body);
    assert.equal(res.status, 502, path);
    const text = ((await res.json()) as { error: string }).error;
    assert.equal(text.includes('secret-ish'), exposed, `${path}: ${text}`);
  }
  assert.equal(logs.filter((l) => l.includes('secret-ish')).length, 4);
});

test('an HttpError from the backend keeps its own status', async (t) => {
  const f = fakeBackend();
  f.backend.balance = async () => {
    throw new HttpError(403, 'not sponsored');
  };
  f.backend.prove = async () => {
    throw new HttpError(418, 'teapot');
  };
  const { base, logs } = await start(t, f.backend);
  const res = await post(`${base}/sponsor/balance`, { tx: '01' });
  assert.equal(res.status, 403);
  assert.deepEqual(await res.json(), { error: 'not sponsored' });
  const prove = await post(`${base}/prove`, { preimage: '01', keyLocation: CIRCUIT });
  assert.equal(prove.status, 418);
  assert.deepEqual(logs, []);
});

test('a malformed JSON body is a 400, not a 502', async (t) => {
  const f = fakeBackend();
  const { base } = await start(t, f.backend);
  for (const path of ['/prove', '/check', '/sponsor/balance', '/sponsor/submit', '/deploy']) {
    const res = await post(`${base}${path}`, '{"preimage": ');
    assert.equal(res.status, 400, path);
    assert.match(((await res.json()) as { error: string }).error, /not valid JSON/);
  }
  assert.equal(f.calls.prove, 0);
});

test('bad fields are 400 and never reach the backend', async (t) => {
  const f = fakeBackend();
  const { base } = await start(t, f.backend);
  const bad: [string, unknown][] = [
    ['/prove', { preimage: 'zz', keyLocation: CIRCUIT }],
    ['/prove', { preimage: '0', keyLocation: CIRCUIT }],
    ['/prove', { preimage: '0A', keyLocation: CIRCUIT }],
    ['/prove', { preimage: '', keyLocation: CIRCUIT }],
    ['/prove', { preimage: '01' }],
    ['/prove', { preimage: '01', keyLocation: 5 }],
    ['/prove', { preimage: '01', keyLocation: CIRCUIT, overwriteBindingInput: 'abc' }],
    ['/prove', { preimage: '01', keyLocation: CIRCUIT, overwriteBindingInput: 5 }],
    ['/prove', { preimage: '01', keyLocation: CIRCUIT, overwriteBindingInput: '-1' }],
    ['/prove', { preimage: '01', keyLocation: CIRCUIT, overwriteBindingInput: '1'.repeat(81) }],
    ['/prove', null],
    ['/prove', [1, 2]],
    ['/check', { keyLocation: CIRCUIT }],
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
  assert.equal(f.calls.check, 0);
});

test('a binding input of 80 digits is accepted', async (t) => {
  const f = fakeBackend();
  const { base } = await start(t, f.backend);
  const res = await post(`${base}/prove`, {
    preimage: '01',
    keyLocation: CIRCUIT,
    overwriteBindingInput: '7'.repeat(80),
  });
  assert.equal(res.status, 200);
  assert.equal((f.seen.prove as unknown[])[2], BigInt('7'.repeat(80)));
});

test('/prove and /check refuse key locations outside the binding with 403', async (t) => {
  const f = fakeBackend();
  const { base } = await start(t, f.backend);
  const refused = [
    'unknown_circuit',
    '../x',
    '../../etc/passwd',
    'c/../c',
    'c?vk=' + VK,
    'midnight/zswap/spend',
    `contract:${ADDRESS}/other?vk=${VK}`,
    `contract:${ADDRESS}/c`,
    `contract:${ADDRESS.slice(2)}/c?vk=${VK}`,
    ' c',
  ];
  for (const keyLocation of refused) {
    for (const path of ['/prove', '/check']) {
      const res = await post(`${base}${path}`, { preimage: '01', keyLocation });
      assert.equal(res.status, 403, `${path} ${keyLocation}`);
    }
  }
  assert.equal(f.calls.prove, 0);
  assert.equal(f.calls.check, 0);
});

test('/prove accepts the bare circuit id and the canonical key location', async (t) => {
  const f = fakeBackend();
  const { base } = await start(t, f.backend);
  const canonical = `contract:${ADDRESS}/${CIRCUIT}?vk=${VK}`;
  for (const keyLocation of [CIRCUIT, canonical]) {
    const res = await post(`${base}/prove`, { preimage: '01', keyLocation });
    assert.equal(res.status, 200, keyLocation);
  }
  assert.equal((f.seen.prove as unknown[])[1], canonical);
});

test('a bad /prove request does not wait behind a running proof', async (t) => {
  const f = fakeBackend(400);
  const { base } = await start(t, f.backend);
  let proofDone = false;
  const running = post(`${base}/prove`, { preimage: '01', keyLocation: CIRCUIT }).then((r) => {
    proofDone = true;
    return r;
  });
  await new Promise((r) => setTimeout(r, 30));
  assert.equal((await post(`${base}/prove`, { preimage: 'zz', keyLocation: CIRCUIT })).status, 400);
  assert.equal(proofDone, false, 'the refusal came back while the proof was still running');
  await running;
});

test('/deploy refuses an oversized body with 413', async (t) => {
  const f = fakeBackend();
  const { base } = await start(t, f.backend);
  const res = await post(`${base}/deploy`, { boot: '11'.repeat(32), encKey: '22'.repeat(5000) });
  assert.equal(res.status, 413);
  assert.equal(f.calls.deploy, 0);
});

test('other methods and paths fall through to 404', async (t) => {
  const f = fakeBackend();
  const { base } = await start(t, f.backend);
  assert.equal((await fetch(`${base}/prove`)).status, 404);
  assert.equal((await post(`${base}/sponsor`, { tx: '01' })).status, 404);
});

test('/sponsor/balance answers 400 for bytes that are no transaction and 403 for a refusal', async (t) => {
  const f = fakeBackend();
  const emptyTx: LedgerTxLike = {
    rewards: undefined,
    intents: new Map(),
    guaranteedOffer: undefined,
    fallibleOffer: undefined,
    imbalances: () => new Map(),
  };
  class Never {}
  f.backend.balance = guardedBalance({
    deserialize: (bytes) => {
      if (bytes[0] === 0xff) throw new Error('wasm: bad tx');
      return emptyTx;
    },
    classes: { ContractCall: Never, ContractDeploy: Never, MaintenanceUpdate: Never },
    allowed: () => new Set(),
    balance: async () => {
      throw new Error('the wallet must not be reached');
    },
  });
  const { base, logs } = await start(t, f.backend);
  const notTx = await post(`${base}/sponsor/balance`, { tx: 'ff00' });
  assert.equal(notTx.status, 400);
  const refused = await post(`${base}/sponsor/balance`, { tx: '0100' });
  assert.equal(refused.status, 403);
  assert.match(((await refused.json()) as { error: string }).error, /no intents/);
  assert.deepEqual(logs, [], 'neither refusal reached the wallet or was logged as a fault');
});
