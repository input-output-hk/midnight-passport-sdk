// Emitted, strictly compiled public-import recipe: real AES-GCM and private disk records;
// synthetic chain, wallet and approval UI. No native/provider qualification.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { fileMutationByteStore } from '../../packages/service/dist/index.js';
import { depositShielded } from '../../packages/account/dist/index.js';
import { depositWorld, depositPins, depositRequest } from './shielded-deposit-world.mjs';
const recipe = process.env.PASSPORT_REVIEWED_RECIPE;
assert.ok(recipe);
const { reviewedDepositOperations } = await import(pathToFileURL(recipe).href);

function world() {
  const root = mkdtempSync(join(tmpdir(), 'passport-reviewed-deposit-'));
  const w = depositWorld(root);
  const keyStats = { sessions: 0, derivations: 0 };
  const source = {
    ...w.source,
    withSession: async (/** @type {()=>Promise<any>} */ work) => {
      keyStats.sessions++;
      return work();
    },
    deriveSecret: async (/** @type {{domain:string,context:string}} */ request) => {
      keyStats.derivations++;
      return w.source.deriveSecret(request);
    },
  };
  /** @type {Record<string,any>[]} */ const reviews = [];
  /** @type {Record<string,any>[]} */ const events = [];
  const originalRequest = {
    ...depositRequest,
    color: depositRequest.color.slice(),
    nonce: depositRequest.nonce.slice(),
  };
  const input = {
    originalRequest,
    pins: { ...depositPins },
    journalKeySource: source,
    store: fileMutationByteStore(join(root, 'journal')),
    senderPorts: w.ports,
    evidence: { ...w.ports.recovery },
    origin: 'https://partner.example',
    senderLabel: 'Host sender wallet',
    /** @param {Record<string,any>} review @returns {Promise<unknown>} */
    approve: async (review) => {
      reviews.push(review);
      return true;
    },
    onStatus: (/** @type {Record<string,any>} */ status) => {
      events.push(status);
    },
  };
  return {
    root,
    w,
    input,
    reviews,
    events,
    keyStats,
    controller: () => reviewedDepositOperations(input),
    phase: async () => {
      const doc = await w.journal.read(depositRequest.requestId);
      assert.ok(doc);
      return doc.phase;
    },
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

for (const decision of [false, undefined, 'yes', new Error('private review diagnostics')]) {
  test(`non-true or failed review never accesses journal or sender: ${String(decision)}`, async () => {
    const f = world();
    try {
      f.input.approve = async () => {
        if (decision instanceof Error) throw decision;
        return decision;
      };
      const controller = f.controller();
      for (const method of ['start', 'reconcile']) {
        const outcome = await controller[method]();
        assert.equal(outcome.state, 'declined');
        assert.equal(JSON.stringify(outcome).includes('private'), false);
      }
      assert.deepEqual(f.keyStats, { sessions: 0, derivations: 0 });
      assert.equal(f.w.stats().reads, 0);
      assert.equal(f.w.stats().sends, 0);
      assert.equal(existsSync(join(f.root, 'sender.json')), false);
    } finally {
      f.cleanup();
    }
  });
}

test('immutable review binds original amount/account/coin/pins and captured sender while approval awaits', async () => {
  const f = world();
  try {
    /** @type {(approved:boolean)=>void} */
    let release = (/** @type {boolean} */ _approved) => {
      throw Error('review not pending');
    };
    f.input.approve = async (review) => {
      f.reviews.push(review);
      assert.equal(Object.isFrozen(review), true);
      assert.equal(Object.isFrozen(review.pins), true);
      assert.throws(() => {
        review.account = 'cd'.repeat(32);
      }, TypeError);
      assert.throws(() => {
        review.pins.networkId = 'other';
      }, TypeError);
      return new Promise((r) => {
        release = r;
      });
    };
    const controller = f.controller();
    const pending = controller.start();
    f.input.originalRequest.amount = 999n;
    f.input.originalRequest.account = 'cd'.repeat(32);
    f.input.originalRequest.color.fill(8);
    f.input.originalRequest.nonce.fill(9);
    f.input.pins.networkId = 'other';
    f.input.senderPorts.sender.depositShielded = async () => {
      throw Error('switched sender');
    };
    const busy = await controller.reconcile();
    assert.equal(busy.state, 'busy');
    assert.equal(f.reviews.length, 1);
    assert.equal(f.keyStats.sessions, 0);
    release(true);
    const result = await pending;
    assert.equal(result.state, 'confirmed');
    const saved = JSON.parse(readFileSync(join(f.root, 'sender.json'), 'utf8'));
    assert.equal(saved.request.account, depositRequest.account);
    assert.equal(saved.request.coin.value, '27');
    assert.equal(saved.request.coin.color, '02'.repeat(32));
    assert.equal(saved.request.coin.nonce, '03'.repeat(32));
    assert.ok(f.reviews[0]);
    assert.equal(f.reviews[0].amountBaseUnits, '27');
    assert.equal(f.reviews[0].mayInvokeSender, true);
    assert.equal(f.reviews[0].keyPurpose, 'unlock-protected-deposit-journal');
    assert.equal(f.w.stats().sends, 1);
    assert.equal(Object.isFrozen(result.receipt), true);
  } finally {
    f.cleanup();
  }
});

for (const name of ['Error', 'AbortError', 'NotAllowedError']) {
  test(`post-fence ${name} stays unresolved even with no visible sender effect`, async () => {
    const f = world();
    try {
      f.input.senderPorts.sender.depositShielded = async () => {
        throw Object.assign(new Error('locked wallet; private seed=do-not-reflect'), { name });
      };
      const controller = f.controller();
      const initial = await controller.start();
      assert.equal(initial.state, 'unresolved');
      assert.equal(initial.code, 'DepositUnsettled');
      assert.equal(initial.requestId, depositRequest.requestId);
      assert.equal(await f.phase(), 'dispatching');
      const resumed = await controller.reconcile();
      assert.equal(resumed.state, 'unresolved');
      assert.equal(resumed.txId, undefined);
      assert.deepEqual(
        f.reviews.map((r) => r.action),
        ['start', 'reconcile'],
      );
      assert.ok(f.reviews[1]);
      assert.equal(f.reviews[1].mayInvokeSender, false);
      assert.equal(f.w.stats().effects, 0);
      assert.equal(f.w.stats().seals, 1);
      const encoded = JSON.stringify(f.events);
      for (const secret of [
        'seed=',
        'locked wallet',
        'nonce',
        'entry',
        'intentSha256',
        'encKey',
        '27',
      ])
        assert.equal(encoded.includes(secret), false, secret);
      const before = { ...f.w.stats() };
      await controller.start();
      assert.deepEqual(f.w.stats(), before);
      assert.equal(f.reviews.length, 2);
    } finally {
      f.cleanup();
    }
  });
}

test('lost wallet response reconciles original sender evidence and confirmation without another send', async () => {
  const f = world();
  try {
    const send = f.input.senderPorts.sender.depositShielded;
    f.input.senderPorts.sender.depositShielded = async (request) => {
      await send(request);
      throw Error('lost response after successful submission');
    };
    const first = f.controller();
    assert.equal((await first.start()).state, 'unresolved');
    assert.equal(f.w.stats().sends, 1);
    // New controller represents a restarted host with the SAME original private inputs and store.
    const restarted = f.controller();
    const result = await restarted.reconcile();
    assert.equal(result.state, 'confirmed');
    assert.equal(result.txId, 'tx-original');
    assert.equal(result.receipt.inboxIndex, 2);
    assert.equal(f.w.stats().sends, 1);
    assert.equal(f.w.stats().effects, 1);
    const before = f.w.stats();
    assert.deepEqual(await restarted.start(), result);
    assert.deepEqual(f.w.stats(), before);
    const cached = await restarted.reconcile();
    assert.deepEqual(cached, result);
    assert.deepEqual(f.w.stats(), before);
    assert.deepEqual(
      f.reviews.map((r) => r.action),
      ['start', 'reconcile', 'reconcile'],
    );
  } finally {
    f.cleanup();
  }
});

test('known bounded transaction survives failed submitted publication without exposing sender diagnostics', async () => {
  const f = world();
  try {
    const cas = f.input.store.compareAndSwap;
    f.input.store.compareAndSwap = async (id, expected, next) => {
      if (next.revision === 2) throw Error('private disk diagnostic');
      return cas(id, expected, next);
    };
    const controller = f.controller();
    const result = await controller.start();
    assert.equal(result.state, 'unresolved');
    assert.equal(result.txId, 'tx-original');
    assert.equal(JSON.stringify(result).includes('private'), false);
    assert.equal(f.w.stats().sends, 1);
    assert.equal(await f.phase(), 'dispatching');
    f.input.store.compareAndSwap = cas;
    const fresh = f.controller();
    assert.equal((await fresh.reconcile()).state, 'confirmed');
    assert.equal(f.w.stats().sends, 1);
  } finally {
    f.cleanup();
  }
});

test('invalid transaction reply text never enters public statuses', async () => {
  const f = world();
  try {
    f.input.senderPorts.sender.depositShielded = async () => ({ txId: 'private seed = secret' });
    const result = await f.controller().start();
    assert.equal(result.state, 'unresolved');
    assert.equal(result.txId, undefined);
    assert.equal(JSON.stringify(result).includes('seed'), false);
  } finally {
    f.cleanup();
  }
});

test('missing and prepared original records cannot dispatch from reconcile', async () => {
  const f = world();
  try {
    const missing = await f.controller().reconcile();
    assert.equal(missing.code, 'OriginalEvidenceRequired');
    assert.equal(f.w.stats().reads, 0);
    const realCas = f.w.ports.recovery.journal.compareAndSwap;
    f.w.ports.recovery.journal.compareAndSwap = async (id, expected, next) => {
      if (next.phase === 'dispatching') throw Error('synthetic crash before fence');
      return realCas(id, expected, next);
    };
    await assert.rejects(depositShielded(depositRequest, f.w.ports));
    assert.equal(await f.phase(), 'prepared');
    const before = f.w.stats();
    const prepared = await f.controller().reconcile();
    assert.equal(prepared.code, 'OriginalEvidenceRequired');
    assert.equal(f.w.stats().sends, 0);
    assert.deepEqual(f.w.stats(), before);
  } finally {
    f.cleanup();
  }
});

test('different private intent under same ID refuses without disclosing its transaction', async () => {
  const f = world();
  try {
    await depositShielded(depositRequest, f.w.ports);
    f.input.originalRequest.amount = 28n;
    const result = await f.controller().reconcile();
    assert.equal(result.state, 'unresolved');
    assert.equal(result.txId, undefined);
    assert.equal(f.w.stats().sends, 1);
  } finally {
    f.cleanup();
  }
});

for (const asynchronous of [false, true]) {
  test(`observer failure cannot change confirmed receipt (async=${asynchronous})`, async () => {
    const f = world();
    try {
      f.input.onStatus = asynchronous
        ? async () => {
            throw Error('private asynchronous display failure');
          }
        : () => {
            throw Error('private display failure');
          };
      const controller = f.controller();
      const result = await controller.start();
      assert.equal(result.state, 'confirmed');
      assert.deepEqual(controller.status(), result);
      assert.equal(f.w.stats().sends, 1);
      assert.equal((await controller.reconcile()).state, 'confirmed');
      assert.equal(f.w.stats().sends, 1);
      await new Promise((r) => setImmediate(r));
    } finally {
      f.cleanup();
    }
  });
}

test('public local status snapshot has no key or network work and cannot be edited', async () => {
  const f = world();
  try {
    const controller = f.controller();
    const initial = controller.status();
    assert.equal(initial.state, 'idle');
    assert.throws(() => {
      initial.requestId = 'other';
    }, TypeError);
    assert.equal(controller.status(), initial);
    assert.deepEqual(f.keyStats, { sessions: 0, derivations: 0 });
    assert.equal(f.w.stats().reads, 0);
    assert.equal(f.reviews.length, 0);
  } finally {
    f.cleanup();
  }
});

test('stale prepared revision during reconciliation cannot regain dispatch admission', async () => {
  const f = world();
  try {
    const cas = f.w.ports.recovery.journal.compareAndSwap;
    f.w.ports.recovery.journal.compareAndSwap = async (id, expected, next) => {
      if (next.phase === 'dispatching') throw Error('stop before fence');
      return cas(id, expected, next);
    };
    await assert.rejects(depositShielded(depositRequest, f.w.ports));
    const storageId = depositRequest.requestId.replaceAll('-', '');
    const prepared = await f.input.store.read(storageId);
    f.w.ports.recovery.journal.compareAndSwap = cas;
    f.w.ports.sender.depositShielded = async () => {
      throw Error('no original sender reply');
    };
    await assert.rejects(depositShielded(depositRequest, f.w.ports));
    assert.equal(await f.phase(), 'dispatching');
    const read = f.input.store.read;
    let reads = 0;
    f.input.store.read = async (id) => (++reads === 1 ? read(id) : prepared);
    f.input.evidence.reconcileSender = async (_intent, digest) => ({
      kind: 'submitted',
      intentSha256: digest,
      txId: 'tx-original',
    });
    const result = await f.controller().reconcile();
    assert.equal(result.code, 'OriginalEvidenceRequired');
    assert.equal(result.txId, 'tx-original');
    assert.ok(reads >= 3);
    assert.equal(f.w.stats().sends, 0);
    assert.equal(f.w.stats().effects, 0);
  } finally {
    f.cleanup();
  }
});
