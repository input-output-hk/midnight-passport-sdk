import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createDurablePassportMutations,
  PassportConnectorError,
  mutationDigest,
  validateMutationDocument,
} from '../packages/account/dist/index.js';
import { createFakePorts } from '../packages/account/dist/testing/index.js';

/** @typedef {import('../packages/account/dist/index.js').MutationDocument} Document */
/** @typedef {'read'|'consent'|'backend'|'credential'|'cas'|'outcome'} Stage */
/** @typedef {{before:(stage:Stage,id:string)=>Promise<void>,foreign:Document|undefined,denyCas:boolean}} Controls */
const originalId = '11'.repeat(16),
  replacementId = '22'.repeat(16);
const intent = { kind: 'create', userName: 'synthetic invocation', retireAuthority: true };
const pins = {
  networkId: 'undeployed',
  bindingId: 'acc-s3r1.1',
  manifestSha256: '77fb9c17b0d59047456c43115d9a58f5cb99a226ee73b6b974fd724930c3153f',
  scheme: 'p256-webauthn',
};

function gate() {
  /** @type {()=>void} */ let release = () => {};
  const waiting = new Promise((resolve) => {
    release = () => resolve(undefined);
  });
  /** @type {()=>void} */ let arrive = () => {};
  const reached = new Promise((resolve) => {
    arrive = () => resolve(undefined);
  });
  return { waiting, reached, release, arrive };
}

/** @param {string} [id] @param {'pending'|'cancelled'} [phase] @returns {Document} */
function document(id = originalId, phase = 'pending') {
  return {
    version: 1,
    id,
    revision: 0,
    pins: { ...pins, scheme: 'p256-webauthn' },
    intent: { ...intent, kind: 'create' },
    randomSeed: new Uint8Array(32).fill(7),
    phase,
    entries: [],
  };
}

/** A strict, isolated synthetic CAS journal; credential execution intentionally stops.
 * @param {import('node:test').TestContext} t @param {Document} [initial]
 */
function fixture(t, initial) {
  const base = createFakePorts(),
    stopped = new PassportConnectorError('InternalError', 'Synthetic credential stop.', {
      step: 'passkey.create',
    });
  /** @type {Controls} */ const controls = {
    before: async () => {},
    foreign: undefined,
    denyCas: false,
  };
  /** @type {Map<string,Document>} */ const documents = new Map();
  /** @type {Uint8Array[]} */ const seeds = [];
  /** @type {string[]} */ const reads = [];
  /** @type {string[]} */ const writes = [];
  /** @type {string[]} */ const consents = [];
  /** @type {string[]} */ const effects = [];
  /** @param {Document} value */
  const owned = (value) => {
    const copy = structuredClone(value);
    seeds.push(copy.randomSeed);
    return copy;
  };
  if (initial) documents.set(initial.id, owned(initial));
  t.after(() => {
    for (const seed of seeds) seed.fill(0);
  });
  let credentials = 0;
  /** @type {import('../packages/account/dist/index.js').MutationJournal} */
  const journal = {
    async read(id) {
      reads.push(id);
      await controls.before('read', id);
      const value = controls.foreign ?? documents.get(id);
      return value && owned(value);
    },
    async compareAndSwap(id, expected, next) {
      await controls.before('cas', id);
      validateMutationDocument(next);
      assert.equal(next.id, id, 'CAS key must match its authenticated document');
      assert.equal(next.revision, expected === undefined ? 0 : expected + 1);
      if (controls.denyCas || documents.get(id)?.revision !== expected) return false;
      seeds.push(next.randomSeed);
      documents.set(id, owned(next));
      writes.push(id);
      return true;
    },
  };
  const unused = async () => {
    throw new Error('Unexpected synthetic key operation.');
  };
  /** @type {import('../packages/account/dist/ports/index.js').PassportPorts} */
  const ports = {
    ...base,
    network: { ...base.network, ...pins },
    chain: async () => {
      await controls.before('backend', originalId);
      return base.chain;
    },
    credentials: {
      ...base.credentials,
      async create() {
        credentials++;
        await controls.before('credential', originalId);
        throw stopped;
      },
    },
    viewingKey: {
      readerPublicKey: unused,
      createKeys: unused,
      sealToDevice: unused,
      openInbox: unused,
      sealGrant: unused,
    },
  };
  const api = createDurablePassportMutations({
    ports,
    journal,
    consent: {
      async approve(input) {
        consents.push(input.id);
        await controls.before('consent', input.id);
      },
    },
    outcomes: {
      async reconcile(_pins, effect) {
        effects.push(effect.key);
        await controls.before('outcome', effect.key);
        return { kind: 'unknown' };
      },
    },
  });
  return {
    api,
    ports,
    journal,
    controls,
    reads,
    writes,
    consents,
    effects,
    stopped,
    credentials: () => credentials,
    saved: () => documents.get(originalId),
  };
}

/** @param {ReturnType<typeof fixture>} f @param {Stage} stage @param {number} [at] */
function pauseAt(f, stage, at = 1) {
  const paused = gate();
  let count = 0;
  f.controls.before = async (current) => {
    if (current === stage && ++count === at) {
      paused.arrive();
      await paused.waiting;
    }
  };
  return paused;
}

/** @type {Array<{method:'run'|'resume',stage:Stage}>} */
const invocationCases = [
  { method: 'run', stage: 'read' },
  { method: 'run', stage: 'consent' },
  { method: 'run', stage: 'backend' },
  { method: 'resume', stage: 'consent' },
  { method: 'resume', stage: 'backend' },
];
for (const { method, stage } of invocationCases) {
  test(`${method} pins original invocation ID across ${stage} await and strict CAS`, async (t) => {
    const initial = method === 'resume' ? document() : undefined;
    if (initial) t.after(() => initial.randomSeed.fill(0));
    const f = fixture(t, initial),
      paused = pauseAt(f, stage),
      options = { id: originalId };
    const pending =
      method === 'run' ? f.api.run({ ...intent, kind: 'create' }, options) : f.api.resume(options);
    await paused.reached;
    options.id = replacementId;
    paused.release();
    await assert.rejects(pending, f.stopped);
    assert.deepEqual(f.reads, method === 'run' ? [originalId] : [originalId, originalId]);
    assert.deepEqual(f.consents, [originalId]);
    assert.ok(f.writes.length >= (method === 'run' ? 3 : 2));
    assert.ok(f.writes.every((id) => id === originalId));
    assert.equal(f.saved()?.id, originalId);
    assert.equal(f.credentials(), 1);
  });
}

for (const at of [1, 2]) {
  test(`resume pins both journal loads when options change at load ${at}`, async (t) => {
    const initial = document(),
      f = fixture(t, initial),
      paused = pauseAt(f, 'read', at);
    t.after(() => initial.randomSeed.fill(0));
    const options = { id: originalId },
      pending = f.api.resume(options);
    await paused.reached;
    options.id = replacementId;
    paused.release();
    await assert.rejects(pending, f.stopped);
    assert.deepEqual(f.reads, [originalId, originalId]);
    assert.deepEqual(f.consents, [originalId]);
    assert.ok(f.writes.every((id) => id === originalId));
    assert.equal(f.credentials(), 1);
  });
}

for (const approved of [false, true]) {
  test(`resume retains original resumeCancelled=${approved} through journal await`, async (t) => {
    const initial = document(originalId, 'cancelled'),
      f = fixture(t, initial),
      paused = pauseAt(f, 'read');
    t.after(() => initial.randomSeed.fill(0));
    const options = { id: originalId, resumeCancelled: approved },
      pending = f.api.resume(options);
    await paused.reached;
    options.resumeCancelled = !approved;
    paused.release();
    if (approved) {
      await assert.rejects(pending, f.stopped);
      assert.equal(f.credentials(), 1);
      assert.equal(f.saved()?.phase, 'pending');
    } else {
      await assert.rejects(pending, { code: 'MutationUnsettled' });
      assert.equal(f.credentials(), 0);
      assert.deepEqual(f.writes, []);
      assert.equal(f.saved()?.phase, 'cancelled');
    }
  });
}

for (const stage of ['consent', 'backend']) {
  test(`original signal remains live across ${stage}; replacing it cannot remove cancellation`, async (t) => {
    assert.ok(stage === 'consent' || stage === 'backend');
    const f = fixture(t),
      paused = pauseAt(f, stage),
      original = new AbortController(),
      replacement = new AbortController();
    const options = { id: originalId, signal: original.signal },
      pending = f.api.run({ ...intent, kind: 'create' }, options);
    await paused.reached;
    options.signal = replacement.signal;
    original.abort();
    paused.release();
    await assert.rejects(pending, { code: 'Aborted' });
    assert.equal(f.credentials(), 0);
    assert.equal(replacement.signal.aborted, false);
    assert.ok(f.writes.every((id) => id === originalId));
  });
}

test('replacing options with an aborted signal does not cancel its original invocation', async (t) => {
  const f = fixture(t),
    paused = pauseAt(f, 'consent'),
    original = new AbortController(),
    replacement = new AbortController();
  const options = { id: originalId, signal: original.signal },
    pending = f.api.run({ ...intent, kind: 'create' }, options);
  await paused.reached;
  replacement.abort();
  options.signal = replacement.signal;
  paused.release();
  await assert.rejects(pending, f.stopped);
  assert.equal(f.credentials(), 1);
  assert.equal(original.signal.aborted, false);
});

for (const method of ['run', 'resume']) {
  test(`${method} reads the caller's original ID property only once`, async (t) => {
    const initial = document(),
      f = fixture(t, initial);
    t.after(() => initial.randomSeed.fill(0));
    let reads = 0;
    const options = {
      get id() {
        return ++reads === 1 ? originalId : replacementId;
      },
    };
    const pending =
      method === 'run' ? f.api.run({ ...intent, kind: 'create' }, options) : f.api.resume(options);
    await assert.rejects(pending, f.stopped);
    assert.equal(reads, 1);
    assert.ok(f.reads.every((id) => id === originalId));
    assert.ok(f.writes.every((id) => id === originalId));
  });
}

test('document admission preserves a prototype journal method receiver', async (t) => {
  const initial = document(),
    f = fixture(t);
  class Journal {
    current = initial;
    reads = 0;
    /** @param {string} id */
    async read(id) {
      assert.equal(this, journal);
      assert.equal(id, originalId);
      this.reads++;
      return this.current;
    }
    /** @param {string} id @param {number|undefined} expected @param {Document} next */
    async compareAndSwap(id, expected, next) {
      assert.equal(this, journal);
      assert.equal(id, originalId);
      assert.equal(expected, this.current.revision);
      this.current = structuredClone(next);
      return true;
    }
  }
  const journal = new Journal();
  t.after(() => {
    initial.randomSeed.fill(0);
    journal.current.randomSeed.fill(0);
  });
  const unused = async () => {
    throw new Error('No approval or reconciliation during inspection/cancel.');
  };
  const api = createDurablePassportMutations({
    ports: f.ports,
    journal,
    consent: { approve: unused },
    outcomes: { reconcile: unused },
  });
  assert.equal((await api.inspect(originalId))?.id, originalId);
  assert.equal((await api.cancel(originalId)).phase, 'cancelled');
  assert.equal(journal.reads, 2);
  assert.ok(initial.randomSeed.every((byte) => byte === 7));
});

test('a complete original receipt survives later option replacement and cancellation without replay', async (t) => {
  const initial = document(),
    address = 'ab'.repeat(32);
  const ledger = {
    booted: true,
    authNonce: 1n,
    deviceEpoch: 0n,
    specVersion: 3,
    encKey: new Uint8Array(32),
    inboxEntries: [],
    deviceEntries: [],
    entryCount: 0,
  };
  const receipt = { id: originalId, account: address, result: { address } };
  /** @type {Document} */ const complete = {
    ...initial,
    phase: 'complete',
    frontier: { address, ledger },
    result: receipt,
  };
  const f = fixture(t, complete),
    paused = gate(),
    controller = new AbortController(),
    base = createFakePorts();
  t.after(() => initial.randomSeed.fill(0));
  const api = createDurablePassportMutations({
    ports: {
      ...f.ports,
      chain: async () => {
        paused.arrive();
        await paused.waiting;
        return { ...base.chain, readAccount: async () => ({ ...ledger, hasEntry: () => false }) };
      },
    },
    journal: f.journal,
    consent: { approve: async () => {} },
    outcomes: {
      reconcile: async () => {
        throw new Error('Complete receipt must not dispatch or reconcile.');
      },
    },
  });
  const options = { id: originalId, signal: controller.signal },
    pending = api.resume(options);
  await paused.reached;
  options.id = replacementId;
  controller.abort();
  paused.release();
  assert.deepEqual(await pending, receipt);
  assert.deepEqual(f.writes, []);
  assert.equal(f.credentials(), 0);
});

test('callback replacement during backend resolution does not redirect progress', async (t) => {
  const f = fixture(t),
    paused = pauseAt(f, 'backend');
  let originalEvents = 0,
    replacementEvents = 0;
  const options = {
      id: originalId,
      onEvent: () => {
        originalEvents++;
      },
    },
    pending = f.api.run({ ...intent, kind: 'create' }, options);
  await paused.reached;
  options.onEvent = () => {
    replacementEvents++;
  };
  paused.release();
  await assert.rejects(pending, f.stopped);
  assert.ok(originalEvents > 0);
  assert.equal(replacementEvents, 0);
});

for (const method of ['run', 'resume', 'inspect', 'cancel']) {
  test(`${method} refuses a valid document returned under another requested journal ID`, async (t) => {
    const f = fixture(t),
      foreign = document(replacementId);
    f.controls.foreign = foreign;
    t.after(() => foreign.randomSeed.fill(0));
    const pending =
      method === 'run'
        ? f.api.run({ ...intent, kind: 'create' }, { id: originalId })
        : method === 'resume'
          ? f.api.resume({ id: originalId })
          : method === 'inspect'
            ? f.api.inspect(originalId)
            : f.api.cancel(originalId);
    await assert.rejects(pending, {
      code: 'MutationUnsettled',
      message: 'Mutation document ID differs from the requested ID.',
    });
    assert.deepEqual(f.reads, [originalId]);
    assert.deepEqual(f.consents, []);
    assert.deepEqual(f.writes, []);
    assert.equal(f.credentials(), 0);
  });
}

test('public run and resume preserve rejected-Promise shape for throwing option getters', async (t) => {
  const f = fixture(t),
    thrown = new Error('Synthetic option getter.');
  const options = {
    /** @returns {string} */
    get id() {
      throw thrown;
    },
  };
  for (const method of ['run', 'resume']) {
    /** @type {Promise<unknown>|undefined} */ let pending;
    assert.doesNotThrow(() => {
      pending =
        method === 'run'
          ? f.api.run({ ...intent, kind: 'create' }, options)
          : f.api.resume(options);
    });
    assert.ok(pending instanceof Promise);
    await assert.rejects(pending, thrown);
  }
  assert.deepEqual(f.reads, []);
  assert.deepEqual(f.consents, []);
  assert.deepEqual(f.writes, []);
});

test('CAS contention retains the original ID and never enters credentials', async (t) => {
  const f = fixture(t),
    paused = pauseAt(f, 'consent');
  f.controls.denyCas = true;
  const options = { id: originalId },
    pending = f.api.run({ ...intent, kind: 'create' }, options);
  await paused.reached;
  options.id = replacementId;
  paused.release();
  await assert.rejects(pending, { code: 'MutationUnsettled' });
  assert.deepEqual(f.writes, []);
  assert.equal(f.credentials(), 0);
});

test('unknown original effect remains unchanged and is not replayed after option mutation', async (t) => {
  const initial = document(),
    input = {
      boot: new Uint8Array(32),
      encKey: new Uint8Array(32),
      retireAuthority: true,
      firstArm: 'p256',
    };
  const digest = mutationDigest(input),
    effect = { key: `${originalId}:0`, kind: 'deploy', digest, input };
  const running = { ...initial, entries: [{ name: 'deploy', digest, phase: 'running', effect }] };
  // Contextual document annotation checks the stored transcript without a cast.
  /** @type {Document} */ const seeded = {
    ...running,
    entries: [{ name: 'deploy', digest, phase: 'running', effect: { ...effect, kind: 'deploy' } }],
  };
  const f = fixture(t, seeded),
    paused = pauseAt(f, 'outcome'),
    options = { id: originalId };
  t.after(() => initial.randomSeed.fill(0));
  const pending = f.api.resume(options);
  await paused.reached;
  options.id = replacementId;
  paused.release();
  await assert.rejects(pending, { code: 'MutationUnsettled' });
  assert.deepEqual(f.effects, [`${originalId}:0`]);
  assert.deepEqual(f.writes, []);
  assert.equal(f.credentials(), 0);
  assert.equal(f.saved()?.entries[0]?.phase, 'running');
  assert.equal(f.saved()?.entries[0]?.effect?.digest, digest);
});

test('all original-ID methods refuse non-string IDs without coercion or port work', async (t) => {
  const f = fixture(t);
  let coercions = 0;
  const value = {
    toString() {
      coercions++;
      return originalId;
    },
  };
  const options = { id: originalId };
  Object.defineProperty(options, 'id', { value });
  const checks = [
    () => f.api.run({ ...intent, kind: 'create' }, options),
    () => f.api.resume(options),
    () => Reflect.apply(f.api.inspect, f.api, [value]),
    () => Reflect.apply(f.api.cancel, f.api, [value]),
  ];
  for (const check of checks)
    await assert.rejects(check(), {
      code: 'MutationUnsettled',
      message: 'Mutation ID must be 16-byte lowercase hex.',
    });
  assert.equal(coercions, 0);
  assert.deepEqual(f.reads, []);
  assert.deepEqual(f.consents, []);
  assert.deepEqual(f.writes, []);
  assert.equal(f.credentials(), 0);
});

for (const value of ['false', 'true', 1, {}, null]) {
  test(`resume refuses a nonboolean cancellation choice (${JSON.stringify(value)}) before loading`, async (t) => {
    const initial = document(originalId, 'cancelled'),
      f = fixture(t, initial);
    t.after(() => initial.randomSeed.fill(0));
    const options = { id: originalId, resumeCancelled: false };
    Object.defineProperty(options, 'resumeCancelled', { value });
    await assert.rejects(f.api.resume(options), {
      code: 'MutationUnsettled',
      message: 'Cancelled mutation resumption must be an explicit boolean.',
    });
    assert.deepEqual(f.reads, []);
    assert.deepEqual(f.consents, []);
    assert.deepEqual(f.writes, []);
    assert.equal(f.credentials(), 0);
    assert.equal(f.saved()?.phase, 'cancelled');
  });
}
