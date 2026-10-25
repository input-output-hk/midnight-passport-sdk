import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  createHostMutationExecutor,
  encryptedHostMutationStore,
} from '../packages/service/dist/index.js';

const pins = {
  networkId: 'undeployed',
  bindingId: 'acc-s3r1.1',
  manifestSha256: '77fb9c17b0d59047456c43115d9a58f5cb99a226ee73b6b974fd724930c3153f',
  scheme: /** @type {const} */ ('p256-webauthn'),
};
const identity = {
  pins,
  requestId: '34'.repeat(16) + ':0',
  intentSha256: '56'.repeat(32),
  kind: /** @type {const} */ ('deploy'),
};
const id = (/** @type {number} */ n) => n.toString(16).padStart(64, '0');
const input = {
  retireAuthority: true,
  firstArm: 'p256',
  boot: '11'.repeat(32),
  encKey: '22'.repeat(32),
};
function fixture() {
  /** @type {import('../packages/service/dist/index.js').HostMutationRecord|undefined} */ let record;
  const store = {
    read: async () => record && structuredClone(record),
    compareAndSwap: async (
      /** @type {number|undefined} */ expected,
      /** @type {import('../packages/service/dist/index.js').HostMutationRecord} */ next,
    ) => {
      if (record?.revision !== expected) return false;
      record = structuredClone(next);
      return true;
    },
  };
  let prepared = 0,
    sent = 0,
    lookups = 0,
    visible = true,
    loseReply = false,
    wrong = false;
  const receipts = new Set();
  /** @type {import('../packages/service/dist/index.js').HostMutationDriver} */ const driver = {
    prepare: async () => ({
      address: 'ab'.repeat(32),
      steps: 3,
      context: { privateAuthority: 'test-only-authority', retireAuthority: true },
    }),
    prepareStep: async (_r, index) => {
      prepared++;
      return { tx: 'ab' + index.toString(16).padStart(2, '0'), identifiers: [id(index + 1)] };
    },
    submit: async (tx) => {
      sent++;
      receipts.add(tx.identifiers[0]);
      if (loseReply) {
        loseReply = false;
        throw new Error('reply lost AFTER send');
      }
      return /** @type {string} */ (tx.identifiers[0]);
    },
    lookup: async (tx) => {
      lookups++;
      const identifier = tx.identifiers[0];
      return visible && receipts.has(identifier)
        ? {
            identifier: wrong ? id(99) : /** @type {string} */ (identifier),
            txHash: id(100 + Number.parseInt(tx.tx.slice(2), 16)),
            succeeded: true,
          }
        : undefined;
    },
    check: async () => true,
  };
  return {
    store,
    driver,
    engine: createHostMutationExecutor(store, driver),
    counts: () => ({ prepared, sent, lookups }),
    get: () => record,
    visible: (v = true) => {
      visible = v;
    },
    lose: () => {
      loseReply = true;
    },
    wrong: () => {
      wrong = true;
    },
  };
}

test('lost submission response reconciles exact saved bytes without another send or plan', async () => {
  const f = fixture();
  f.lose();
  await assert.rejects(f.engine.execute(identity, input));
  assert.equal(f.get()?.steps[0]?.phase, 'dispatching');
  assert.equal(f.counts().sent, 1);
  const next = createHostMutationExecutor(f.store, f.driver);
  const result = await next.resume(identity);
  assert.equal(result.kind, 'confirmed');
  assert.equal(f.counts().sent, 3);
  assert.equal(f.counts().prepared, 3);
  assert.deepEqual(result.kind === 'confirmed' && result.result, {
    address: 'ab'.repeat(32),
    txIds: [id(1), id(2), id(3)],
  });
  const count = f.counts();
  assert.deepEqual(await next.resume(identity), result);
  assert.deepEqual(f.counts(), count);
});
test('unknown finality never resends or prepares the next wave, even across multiple executors', async () => {
  const f = fixture();
  f.visible(false);
  assert.deepEqual(await f.engine.execute(identity, input), { kind: 'unknown' });
  const revision = f.get()?.revision;
  for (let n = 0; n < 25; n++)
    assert.deepEqual(await createHostMutationExecutor(f.store, f.driver).resume(identity), {
      kind: 'unknown',
    });
  assert.equal(
    f.get()?.revision,
    revision,
    'Unknown lookup-only polls must retain no new full revisions.',
  );
  assert.equal(f.counts().sent, 1);
  assert.equal(f.counts().prepared, 1);
  f.visible();
  assert.equal((await f.engine.resume(identity)).kind, 'confirmed');
  assert.equal(f.counts().sent, 3);
});
test('wrong receipt identifier, conflicting intent and changed original input refuse before more sends', async () => {
  const f = fixture();
  f.wrong();
  await assert.rejects(f.engine.execute(identity, input));
  assert.equal(f.counts().sent, 1);
  await assert.rejects(f.engine.execute(identity, { ...input, retireAuthority: false }));
  await assert.rejects(f.engine.resume({ ...identity, intentSha256: '78'.repeat(32) }));
  assert.equal(f.counts().sent, 1);
});
test('newer claim fences an older producer that is still preparing an unsent wave', async () => {
  const f = fixture();
  let release = () => {},
    entered = () => {};
  const ready = new Promise((resolve) => {
      entered = () => resolve(undefined);
    }),
    held = new Promise((resolve) => {
      release = () => resolve(undefined);
    });
  const original = f.driver.prepareStep;
  let first = true;
  f.driver.prepareStep = async (...args) => {
    if (first) {
      first = false;
      entered();
      await held;
    }
    return original(...args);
  };
  const old = f.engine.execute(identity, input);
  await ready;
  const newer = await createHostMutationExecutor(f.store, f.driver).resume(identity);
  assert.equal(newer.kind, 'confirmed');
  release();
  await assert.rejects(old);
  assert.equal(f.counts().sent, 3, 'old owner never broadcasts');
});
test('cancellation commits a prepared output but prevents broadcast; same original plan resumes', async () => {
  const f = fixture(),
    controller = new AbortController();
  const original = f.driver.prepareStep;
  f.driver.prepareStep = async (...args) => {
    const prepared = await original(...args);
    controller.abort();
    return prepared;
  };
  await assert.rejects(f.engine.execute(identity, input, { signal: controller.signal }));
  assert.equal(f.counts().sent, 0);
  assert.equal(f.get()?.steps[0]?.phase, 'ready');
  f.driver.prepareStep = original;
  assert.equal((await f.engine.resume(identity)).kind, 'confirmed');
  assert.equal(f.counts().prepared, 3);
});
test('a lost uncommitted constructor result and absent operation remain unknown without regeneration', async () => {
  const f = fixture();
  let generated = 0;
  f.driver.prepare = async () => {
    generated++;
    throw new Error('lost constructor result');
  };
  await assert.rejects(f.engine.execute(identity, input));
  assert.deepEqual(await f.engine.resume(identity), { kind: 'unknown' });
  assert.equal(generated, 1);
  assert.deepEqual(await fixture().engine.resume(identity), { kind: 'unknown' });
});
test('a stale or lagging exact deployment frontier blocks further waves and completion', async () => {
  const f = fixture();
  f.driver.check = async (_r, count) => count === 0;
  assert.deepEqual(await f.engine.execute(identity, input), { kind: 'unknown' });
  assert.equal(f.counts().sent, 1);
  assert.equal(f.get()?.steps[0]?.phase, 'confirmed');
  assert.deepEqual(await f.engine.resume(identity), { kind: 'unknown' });
  assert.equal(f.counts().sent, 1);
});
test('encrypted host journal survives new instances; wrong keys/pins/tamper cannot restart work', async () => {
  const root = await mkdtemp(join(tmpdir(), 'passport-host-store-'));
  try {
    const f = fixture(),
      key = new Uint8Array(32).fill(4),
      store = encryptedHostMutationStore(root, key),
      engine = createHostMutationExecutor(store, f.driver);
    assert.equal((await engine.execute(identity, input)).kind, 'confirmed');
    store.close();
    await assert.rejects(store.read(identity));
    const reopened = encryptedHostMutationStore(root, key);
    assert.equal(
      (await createHostMutationExecutor(reopened, f.driver).resume(identity)).kind,
      'confirmed',
    );
    assert.equal(f.counts().sent, 3);
    await assert.rejects(
      encryptedHostMutationStore(root, new Uint8Array(32).fill(5)).read(identity),
    );
    await assert.rejects(reopened.read({ ...identity, intentSha256: '00'.repeat(32) }));
    const files = await readdir(root);
    const all = await Promise.all(files.map((file) => readFile(join(root, file))));
    assert.ok(
      all.every(
        (b) =>
          !b.includes(Buffer.from('test-only-authority')) &&
          !b.includes(Buffer.from('retireAuthority')),
      ),
    );
    const latest = files
      .filter((x) => x.endsWith('.json'))
      .sort(
        (a, b) => Number(a.split('.r')[1]?.split('.')[0]) - Number(b.split('.r')[1]?.split('.')[0]),
      )
      .at(-1);
    assert.ok(latest);
    const path = join(root, latest),
      record = JSON.parse(await readFile(path, 'utf8'));
    const bytes = Buffer.from(record.ciphertext, 'base64');
    bytes[20] = (bytes[20] ?? 0) ^ 1;
    await writeFile(path, JSON.stringify({ ...record, ciphertext: bytes.toString('base64') }));
    await assert.rejects(reopened.read(identity));
    assert.equal(f.counts().sent, 3);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('cancellation during the frontier read prevents the subsequent dispatch', async () => {
  const f = fixture(),
    controller = new AbortController();
  let checks = 0;
  f.driver.check = async () => {
    if (++checks === 2) controller.abort();
    return true;
  };
  await assert.rejects(f.engine.execute(identity, input, { signal: controller.signal }));
  assert.equal(f.counts().sent, 0);
  assert.equal(f.get()?.steps[0]?.phase, 'ready');
});

test('cancellation after the dispatch fence sends that step once and stops the next wave', async () => {
  const f = fixture();
  const controller = new AbortController();
  const compare = f.store.compareAndSwap;
  f.store.compareAndSwap = async (expected, next) => {
    const ok = await compare(expected, next);
    if (ok && next.steps.at(-1)?.phase === 'dispatching') controller.abort();
    return ok;
  };
  await assert.rejects(f.engine.execute(identity, input, { signal: controller.signal }));
  assert.equal(f.counts().sent, 1);
  assert.equal(f.get()?.steps[0]?.phase, 'confirmed');
  assert.equal((await f.engine.resume(identity)).kind, 'confirmed');
  assert.equal(f.counts().sent, 3);
});

test('unknown state at the next wave boundary retains no new owner revisions', async () => {
  const f = fixture();
  f.driver.check = async (_record, count) => count === 0;
  assert.deepEqual(await f.engine.execute(identity, input), { kind: 'unknown' });
  assert.equal(f.get()?.steps[0]?.phase, 'confirmed');
  const revision = f.get()?.revision;
  for (let n = 0; n < 25; n++)
    assert.deepEqual(await f.engine.resume(identity), { kind: 'unknown' });
  assert.equal(f.get()?.revision, revision);
  assert.equal(f.counts().sent, 1);
  f.driver.check = async () => true;
  assert.equal((await f.engine.resume(identity)).kind, 'confirmed');
  assert.equal(f.counts().sent, 3);
});

test('call preparation retries original durable input after a transient failure, without a new send intent', async () => {
  const f = fixture(),
    call = { ...identity, kind: /** @type {const} */ ('call') };
  let attempts = 0;
  f.driver.prepare = async (_identity, request) => {
    assert.deepEqual(request, input);
    if (++attempts === 1) throw new Error('indexer unavailable before call plan');
    return { address: 'ab'.repeat(32), steps: 1, context: { original: request } };
  };
  await assert.rejects(f.engine.execute(call, input), /indexer unavailable/);
  assert.equal(f.get()?.phase, 'preparing');
  assert.equal(f.counts().sent, 0);
  assert.equal(
    (await createHostMutationExecutor(f.store, f.driver).resume(call)).kind,
    'confirmed',
  );
  assert.equal(attempts, 2);
  assert.equal(f.counts().sent, 1);
  assert.deepEqual(f.get()?.input, input);
});

test('retrying a preparing call fences an earlier still-running producer before it can dispatch', async () => {
  const f = fixture(),
    call = { ...identity, kind: /** @type {const} */ ('call') };
  let entered = () => {},
    release = () => {},
    attempts = 0;
  const started = new Promise((resolve) => {
    entered = () => resolve(undefined);
  });
  const held = new Promise((resolve) => {
    release = () => resolve(undefined);
  });
  f.driver.prepare = async () => {
    if (++attempts === 1) {
      entered();
      await held;
    }
    return { address: 'ab'.repeat(32), steps: 1, context: { original: input } };
  };
  const old = f.engine.execute(call, input);
  const refused = assert.rejects(old, /unsettled/);
  await started;
  assert.equal(
    (await createHostMutationExecutor(f.store, f.driver).resume(call)).kind,
    'confirmed',
  );
  release();
  await refused;
  assert.equal(f.counts().sent, 1);
});

test('failed deployment constructor preparation is still unknown and never recreated implicitly', async () => {
  const f = fixture();
  let attempts = 0;
  f.driver.prepare = async () => {
    attempts++;
    throw new Error('constructor result lost');
  };
  await assert.rejects(f.engine.execute(identity, input), /constructor/);
  assert.deepEqual(await createHostMutationExecutor(f.store, f.driver).resume(identity), {
    kind: 'unknown',
  });
  assert.equal(attempts, 1);
  assert.equal(f.counts().sent, 0);
});
