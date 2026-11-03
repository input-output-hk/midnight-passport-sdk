import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, rmSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  depositShielded,
  resumeShieldedDeposit,
  fromHex,
  toHex,
  readShieldedDepositDocument,
  shieldedDepositDocumentBytes,
  shieldedDepositIntentHash,
} from '../packages/account/dist/index.js';
import { encryptedShieldedDepositJournal } from '../packages/keys/dist/index.js';
import { fileMutationByteStore } from '../packages/service/dist/index.js';
import { openInboxCoin } from '../packages/keys/dist/inbox-coin.js';
import { depositWorld, depositRequest, depositPins } from './fixtures/shielded-deposit-world.mjs';
/** @param {(root:string)=>Promise<void>} action */
async function fixture(action) {
  const root = mkdtempSync(join(tmpdir(), 'passport-deposit-recovery-'));
  try {
    await action(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
const child = resolve('tests/fixtures/shielded-deposit-child.mjs');
/** @type {Array<[string,number]>} */ const boundaries = [
  ['prepared-exit', 74],
  ['send-exit', 73],
  ['submitted-write-exit', 75],
  ['submitted-record-exit', 78],
  ['confirmed-reply-exit', 76],
];
for (const [boundary, exit] of boundaries) {
  test(`encrypted original deposit survives process loss at ${boundary}`, () =>
    fixture(async (root) => {
      const stopped = spawnSync(process.execPath, [child, root, boundary], {
        encoding: 'utf8',
        timeout: 10000,
      });
      assert.equal(stopped.status, exit, stopped.stderr);
      const first = depositWorld(root),
        original = await first.journal.read(depositRequest.requestId);
      assert.ok(original);
      const resumed = JSON.parse(
        execFileSync(process.execPath, [child, root, 'resume'], {
          encoding: 'utf8',
          timeout: 10000,
        }),
      );
      assert.equal(resumed.stats.seals, 0);
      assert.equal(resumed.stats.sends, boundary === 'prepared-exit' ? 1 : 0);
      assert.equal(resumed.stats.effects, 1);
      assert.deepEqual(resumed.result, {
        txId: 'tx-original',
        inboxIndex: 2,
        viewingKeyChanged: false,
      });
      const final = depositWorld(root),
        record = await final.journal.read(depositRequest.requestId);
      assert.ok(record);
      assert.equal(record.intent.entry, original.intent.entry);
      assert.equal(record.intentSha256, original.intentSha256);
      assert.equal(final.stats().effects, 1);
      assert.equal(record.phase, 'confirmed');
      // Completed receipt is historical and identical, with no chain, seal or sender calls.
      assert.deepEqual(await resumeShieldedDeposit(depositRequest, final.ports), resumed.result);
      assert.deepEqual(final.stats(), {
        reads: 0,
        seals: 0,
        sends: 0,
        reconciles: 0,
        confirmations: 0,
        effects: 1,
      });
      const raw = readdirSync(join(root, 'journal'))
        .map((name) => readFileSync(join(root, 'journal', name), 'utf8'))
        .join('');
      assert.ok(!raw.includes(original.intent.entry));
      assert.ok(!raw.includes('"amount"'));
      assert.deepEqual(
        await openInboxCoin(new Uint8Array(32).fill(9), fromHex(record.intent.entry)),
        { nonce: depositRequest.nonce, color: depositRequest.color, value: depositRequest.amount },
      );
    }));
}

test('same-ID changed coin/account/network/binding refuses before new work', () =>
  fixture(async (root) => {
    const first = depositWorld(root);
    await depositShielded(depositRequest, first.ports);
    const next = depositWorld(root);
    for (const changed of [
      { account: 'cd'.repeat(32) },
      { amount: 28n },
      { nonce: new Uint8Array(32).fill(8) },
      { color: new Uint8Array(32).fill(8) },
    ])
      await assert.rejects(
        resumeShieldedDeposit({ ...depositRequest, ...changed }, next.ports),
        /different original deposit/,
      );
    for (const changed of [
      { networkId: 'other' },
      { bindingId: 'acc-other' },
      { manifestSha256: '88'.repeat(32) },
    ]) {
      const ports = {
        ...next.ports,
        recovery: { ...next.ports.recovery, pins: { ...depositPins, ...changed } },
      };
      await assert.rejects(
        resumeShieldedDeposit(depositRequest, ports),
        /different original deposit/,
      );
    }
    assert.deepEqual(next.stats(), {
      reads: 0,
      seals: 0,
      sends: 0,
      reconciles: 0,
      confirmations: 0,
      effects: 1,
    });
  }));

test('resume without original evidence never seals or sends, including missing recovery ports', () =>
  fixture(async (root) => {
    const world = depositWorld(root);
    await assert.rejects(resumeShieldedDeposit(depositRequest, world.ports), /evidence is missing/);
    await assert.rejects(
      resumeShieldedDeposit(
        depositRequest,
        /** @type {any} */ ({ ...world.ports, recovery: undefined }),
      ),
      /recovery ports/,
    );
    assert.deepEqual(world.stats(), {
      reads: 0,
      seals: 0,
      sends: 0,
      reconciles: 0,
      confirmations: 0,
      effects: 0,
    });
  }));

test('unknown fenced dispatch cannot become a replacement sender invocation', () =>
  fixture(async (root) => {
    const world = depositWorld(root),
      swap = world.ports.recovery.journal.compareAndSwap.bind(world.ports.recovery.journal);
    world.ports.recovery.journal.compareAndSwap = async (id, revision, next) => {
      const ok = await swap(id, revision, next);
      if (ok && next.phase === 'dispatching')
        throw Error('lost durable acknowledgement before wallet call');
      return ok;
    };
    await assert.rejects(depositShielded(depositRequest, world.ports), {
      code: 'MutationUnsettled',
    });
    const next = depositWorld(root);
    await assert.rejects(resumeShieldedDeposit(depositRequest, next.ports), /unknown/);
    assert.equal(next.stats().sends, 0);
    assert.equal(next.stats().effects, 0);
  }));

test('confirmation requires original exact ciphertext, unique position, preserved prefix and finality', () =>
  fixture(async (root) => {
    const world = depositWorld(root);
    world.visible(false);
    await assert.rejects(depositShielded(depositRequest, world.ports), /unconfirmed/);
    const doc = await world.journal.read(depositRequest.requestId);
    assert.ok(doc);
    const original = world.readLedger();
    // A different randomized seal of the same coin cannot confirm the retained intent.
    const other = await world.ports.sealCoin(fromHex(original.encKey), {
      nonce: depositRequest.nonce,
      color: depositRequest.color,
      value: depositRequest.amount,
    });
    assert.notEqual(toHex(other), doc.intent.entry);
    world.writeLedger({ ...original, entries: [...original.entries, toHex(other)] });
    await assert.rejects(resumeShieldedDeposit(depositRequest, world.ports), /unconfirmed/);
    world.writeLedger({
      ...original,
      entries: [...original.entries, doc.intent.entry, doc.intent.entry],
    });
    await assert.rejects(resumeShieldedDeposit(depositRequest, world.ports), /ambiguous/);
    world.writeLedger({
      ...original,
      entries: [...original.entries].reverse().concat(doc.intent.entry),
    });
    await assert.rejects(resumeShieldedDeposit(depositRequest, world.ports), /reordered/);
    world.writeLedger({ ...original, entries: [...original.entries, doc.intent.entry] });
    world.finalized(false);
    await assert.rejects(resumeShieldedDeposit(depositRequest, world.ports), /unconfirmed/);
    world.finalized(true);
    assert.deepEqual(await resumeShieldedDeposit(depositRequest, world.ports), {
      txId: 'tx-original',
      inboxIndex: 2,
      viewingKeyChanged: false,
    });
    assert.equal(world.stats().sends, 1);
    assert.equal(world.stats().effects, 1);
  }));

test('concurrent admission and dispatch produce only one sender effect', () =>
  fixture(async (root) => {
    const a = depositWorld(root),
      b = depositWorld(root);
    const result = await Promise.allSettled([
      depositShielded(depositRequest, a.ports),
      depositShielded(depositRequest, b.ports),
    ]);
    assert.ok(result.some((r) => r.status === 'fulfilled'));
    const fresh = depositWorld(root);
    const receipt = await resumeShieldedDeposit(depositRequest, fresh.ports);
    for (const r of result) if (r.status === 'fulfilled') assert.deepEqual(r.value, receipt);
    assert.equal(a.stats().sends + b.stats().sends, 1);
    assert.equal(fresh.stats().effects, 1);
  }));

test('ciphertext authentication and bound record codec refuse tampering or cross-context restore', () =>
  fixture(async (root) => {
    const world = depositWorld(root);
    await depositShielded(depositRequest, world.ports);
    const doc = await world.journal.read(depositRequest.requestId);
    assert.ok(doc);
    assert.deepEqual(readShieldedDepositDocument(shieldedDepositDocumentBytes(doc)), doc);
    assert.throws(
      () => shieldedDepositDocumentBytes({ ...doc, intent: { ...doc.intent, amount: '28' } }),
      /identity/,
    );
    assert.throws(() => readShieldedDepositDocument(new Uint8Array(8193)), /bound/);
    const other = encryptedShieldedDepositJournal(
      { ...depositPins, networkId: 'other' },
      world.source,
      fileMutationByteStore(join(root, 'journal')),
    );
    await assert.rejects(other.read(depositRequest.requestId), /Protected deposit journal/);
    const newest = readdirSync(join(root, 'journal')).filter((n) => /\.r3\.json$/.test(n))[0];
    assert.ok(newest);
    const path = join(root, 'journal', newest),
      record = JSON.parse(readFileSync(path, 'utf8'));
    const bytes = Buffer.from(record.ciphertext, 'base64');
    bytes[bytes.length - 1] = Number(bytes.at(-1)) ^ 1;
    record.ciphertext = bytes.toString('base64');
    writeFileSync(path, JSON.stringify(record), { mode: 0o600 });
    await assert.rejects(resumeShieldedDeposit(depositRequest, depositWorld(root).ports), {
      code: 'MutationUnsettled',
    });
  }));

test('pre-admission storage failure or stale ciphertext never dispatches a value input', () =>
  fixture(async (root) => {
    const world = depositWorld(root);
    const storeFailure = {
      ...world.ports,
      recovery: {
        ...world.ports.recovery,
        journal: {
          read: world.journal.read,
          compareAndSwap: async () => {
            throw Error('storage not acknowledged');
          },
        },
      },
    };
    await assert.rejects(depositShielded(depositRequest, storeFailure), /storage not acknowledged/);
    assert.equal(world.stats().sends, 0);
    const stale = { ...world.ports, sealCoin: async () => fromHex(world.readLedger().entries[0]) };
    await assert.rejects(depositShielded(depositRequest, stale), /existing inbox entry/);
    assert.equal(world.stats().sends, 0);
    assert.equal(await world.journal.read(depositRequest.requestId), undefined);
  }));

test('rotation before dispatch refuses without resealing or spending; rotation after dispatch flags original envelope', () =>
  fixture(async (root) => {
    const stopped = spawnSync(process.execPath, [child, root, 'prepared-exit'], {
      encoding: 'utf8',
      timeout: 10000,
    });
    assert.equal(stopped.status, 74);
    const world = depositWorld(root),
      original = world.readLedger();
    world.writeLedger({ ...original, encKey: '99'.repeat(32) });
    await assert.rejects(resumeShieldedDeposit(depositRequest, world.ports), {
      code: 'EncryptionKeyMismatch',
    });
    assert.equal(world.stats().seals, 0);
    assert.equal(world.stats().sends, 0);
    world.writeLedger(original);
    world.finalized(false);
    await assert.rejects(resumeShieldedDeposit(depositRequest, world.ports), /unconfirmed/);
    const submitted = await world.journal.read(depositRequest.requestId);
    assert.ok(submitted);
    world.writeLedger({ ...world.readLedger(), encKey: '99'.repeat(32) });
    world.finalized(true);
    assert.equal(
      (await resumeShieldedDeposit(depositRequest, world.ports)).viewingKeyChanged,
      true,
    );
    assert.equal(world.stats().sends, 1);
    assert.equal(
      (await world.journal.read(depositRequest.requestId))?.intent.entry,
      submitted.intent.entry,
    );
  }));

test('untrusted sender reconciliation or truthy finality cannot confirm original dispatch', () =>
  fixture(async (root) => {
    const stopped = spawnSync(process.execPath, [child, root, 'send-exit'], {
      encoding: 'utf8',
      timeout: 10000,
    });
    assert.equal(stopped.status, 73);
    const world = depositWorld(root);
    const wrong = {
      ...world.ports,
      recovery: {
        ...world.ports.recovery,
        reconcileSender: async () => ({
          kind: /** @type {const} */ ('submitted'),
          intentSha256: '00'.repeat(32),
          txId: 'other',
        }),
      },
    };
    await assert.rejects(resumeShieldedDeposit(depositRequest, wrong), /unknown/);
    const badFinality = {
      ...world.ports,
      recovery: {
        ...world.ports.recovery,
        confirmTransaction: /** @type {any} */ (async () => ({ ok: true })),
      },
    };
    await assert.rejects(resumeShieldedDeposit(depositRequest, badFinality), /unconfirmed/);
    assert.equal(world.stats().sends, 0);
    assert.equal(world.stats().effects, 1);
  }));

test('captured request bytes survive caller mutation while randomized sealing awaits', () =>
  fixture(async (root) => {
    const world = depositWorld(root),
      request = {
        ...depositRequest,
        nonce: depositRequest.nonce.slice(),
        color: depositRequest.color.slice(),
      };
    const seal = world.ports.sealCoin;
    const ports = {
      ...world.ports,
      sealCoin: async (
        /** @type {Uint8Array} */ key,
        /** @type {import('../packages/account/dist/ports/index.js').ShieldedCoin} */ coin,
      ) => {
        request.nonce.fill(8);
        request.color.fill(8);
        request.amount = 28n;
        return seal(key, coin);
      },
    };
    assert.equal((await depositShielded(request, ports)).txId, 'tx-original');
    const doc = await world.journal.read(depositRequest.requestId);
    assert.ok(doc);
    assert.equal(doc.intent.nonce, toHex(depositRequest.nonce));
    assert.equal(doc.intent.color, toHex(depositRequest.color));
    assert.equal(doc.intent.amount, '27');
  }));

test('nonfinite or frozen recovery clocks cannot turn confirmation into unbounded polling', () =>
  fixture(async (root) => {
    const world = depositWorld(root);
    world.visible(false);
    await assert.rejects(
      depositShielded(depositRequest, { ...world.ports, now: () => NaN }),
      /clock/,
    );
    assert.equal(world.stats().sends, 0);
    await assert.rejects(
      depositShielded(depositRequest, { ...world.ports, now: () => 0 }),
      /unconfirmed/,
    );
    assert.equal(world.stats().sends, 1);
    assert.equal(world.stats().effects, 1);
  }));

test('an admitted random ciphertext cannot be replaced under the same request ID', () =>
  fixture(async (root) => {
    const stopped = spawnSync(process.execPath, [child, root, 'prepared-exit'], {
      encoding: 'utf8',
      timeout: 10000,
    });
    assert.equal(stopped.status, 74);
    const world = depositWorld(root),
      doc = await world.journal.read(depositRequest.requestId);
    assert.ok(doc);
    const intent = { ...doc.intent, entry: '88'.repeat(192) };
    await assert.rejects(
      world.journal.compareAndSwap(depositRequest.requestId, doc.revision, {
        ...doc,
        revision: doc.revision + 1,
        phase: 'dispatching',
        intent,
        intentSha256: shieldedDepositIntentHash(intent),
      }),
      /Protected deposit journal/,
    );
    assert.equal(
      (await world.journal.read(depositRequest.requestId))?.intent.entry,
      doc.intent.entry,
    );
    assert.equal(world.stats().effects, 0);
  }));

test('actual process loss after dispatch fence stays unknown without sender evidence', () =>
  fixture(async (root) => {
    const stopped = spawnSync(process.execPath, [child, root, 'dispatch-fence-exit'], {
      encoding: 'utf8',
      timeout: 10000,
    });
    assert.equal(stopped.status, 77);
    const world = depositWorld(root);
    await assert.rejects(resumeShieldedDeposit(depositRequest, world.ports), /unknown/);
    assert.equal(world.stats().sends, 0);
    assert.equal(world.stats().effects, 0);
    assert.equal(world.stats().reconciles, 1);
    assert.equal((await world.journal.read(depositRequest.requestId))?.phase, 'dispatching');
  }));

test('recovery preserves destination errors and the optional-field codec round trip', () =>
  fixture(async (root) => {
    const world = depositWorld(root),
      read = world.ports.chain.readAccount;
    const unsupported = {
      ...world.ports,
      chain: {
        readAccount: async () => {
          const view = await read(depositRequest.account);
          assert.ok(view);
          return { ...view, specVersion: 2 };
        },
      },
    };
    await assert.rejects(depositShielded(depositRequest, unsupported), {
      code: 'BindingUnsupported',
    });
    const malformed = {
      ...world.ports,
      chain: {
        readAccount: async () => {
          const view = await read(depositRequest.account);
          assert.ok(view);
          return { ...view, encKey: new Uint8Array(31) };
        },
      },
    };
    await assert.rejects(depositShielded(depositRequest, malformed), {
      code: 'EncryptionKeyMismatch',
    });
    const stopped = spawnSync(process.execPath, [child, root, 'prepared-exit'], {
      encoding: 'utf8',
      timeout: 10000,
    });
    assert.equal(stopped.status, 74);
    const doc = await world.journal.read(depositRequest.requestId);
    assert.ok(doc);
    const withUndefined = /** @type {any} */ ({ ...doc, txId: undefined, result: undefined });
    assert.deepEqual(readShieldedDepositDocument(shieldedDepositDocumentBytes(withUndefined)), doc);
  }));

test('submitted read gaps remain unsettled original intent and resume without another send', () =>
  fixture(async (root) => {
    const stopped = spawnSync(process.execPath, [child, root, 'submitted-record-exit'], {
      encoding: 'utf8',
      timeout: 10000,
    });
    assert.equal(stopped.status, 78);
    const world = depositWorld(root);
    const gap = {
      ...world.ports,
      chain: { ...world.ports.chain, readAccount: async () => undefined },
    };
    await assert.rejects(resumeShieldedDeposit(depositRequest, gap), { code: 'MutationUnsettled' });
    assert.equal((await world.journal.read(depositRequest.requestId))?.phase, 'submitted');
    assert.equal(world.stats().sends, 0);
    assert.equal(world.stats().effects, 1);
    assert.equal((await resumeShieldedDeposit(depositRequest, world.ports)).txId, 'tx-original');
    assert.equal(world.stats().sends, 0);
  }));

for (const fault of [
  'sender-lookup',
  'finality',
  'post-send-write',
  'post-send-read',
  'resume-read',
])
  test(
    'post-admission ' + fault + ' failure retains original intent with safe unsettled error',
    () =>
      fixture(async (root) => {
        const world = depositWorld(root);
        const unsafe = Object.assign(Error('private-port-diagnostic'), { code: 'AccountNotFound' });
        const recovery = { ...world.ports.recovery };
        if (fault === 'sender-lookup' || fault === 'resume-read') {
          const stopped = spawnSync(process.execPath, [child, root, 'send-exit'], {
            encoding: 'utf8',
            timeout: 10000,
          });
          assert.equal(stopped.status, 73);
          if (fault === 'sender-lookup')
            recovery.reconcileSender = async () => {
              throw unsafe;
            };
          else
            recovery.journal = {
              ...recovery.journal,
              read: async () => {
                throw unsafe;
              },
            };
        } else if (fault === 'finality')
          recovery.confirmTransaction = async () => {
            throw unsafe;
          };
        else if (fault === 'post-send-write')
          recovery.journal = {
            ...recovery.journal,
            compareAndSwap: async (id, previous, next) => {
              if (next.phase === 'submitted') throw unsafe;
              return world.journal.compareAndSwap(id, previous, next);
            },
          };
        else {
          const read = world.journal.read;
          recovery.journal = {
            ...recovery.journal,
            read: async (id) => {
              const doc = await read(id);
              if (doc?.phase === 'submitted') throw unsafe;
              return doc;
            },
          };
        }
        await assert.rejects(
          fault === 'sender-lookup' || fault === 'resume-read'
            ? resumeShieldedDeposit(depositRequest, { ...world.ports, recovery })
            : depositShielded(depositRequest, { ...world.ports, recovery }),
          (error) => {
            assert.ok(
              error && typeof error === 'object' && 'code' in error && 'retryable' in error,
            );
            assert.equal(error.code, 'MutationUnsettled');
            assert.equal(error.retryable, false);
            assert.equal(String(error).includes('private-port'), false);
            return true;
          },
        );
        const original = await world.journal.read(depositRequest.requestId);
        assert.ok(original && original.phase !== 'prepared');
        assert.equal(world.stats().effects, 1);
        assert.equal(
          (await resumeShieldedDeposit(depositRequest, world.ports)).txId,
          'tx-original',
        );
        assert.equal(world.stats().effects, 1);
      }),
  );

test('middle-poll clock regression refuses while retaining original submitted intent', () =>
  fixture(async (root) => {
    const world = depositWorld(root);
    world.finalized(false);
    const ticks = [100, 100, 200, 150];
    await assert.rejects(
      depositShielded(depositRequest, {
        ...world.ports,
        confirmationMs: 1000,
        now: () => ticks.shift() ?? 150,
      }),
      /clock/,
    );
    assert.equal((await world.journal.read(depositRequest.requestId))?.phase, 'submitted');
    assert.equal(world.stats().effects, 1);
  }));

test('non-boolean dispatch acknowledgements cannot authorise a sender effect', async () => {
  for (const acknowledgement of [{ stored: false }, 'false', 1, undefined, null])
    await fixture(async (root) => {
      const world = depositWorld(root),
        journal = world.ports.recovery.journal;
      /** @type {import('../packages/account/dist/index.js').ShieldedDepositPorts} */
      const ports = {
        ...world.ports,
        recovery: {
          ...world.ports.recovery,
          journal: {
            ...journal,
            compareAndSwap: async (id, previous, next) =>
              next.phase === 'dispatching'
                ? /** @type {any} */ (acknowledgement)
                : journal.compareAndSwap(id, previous, next),
          },
        },
      };
      await assert.rejects(depositShielded(depositRequest, ports), {
        code: 'MutationUnsettled',
        retryable: false,
      });
      assert.equal(world.stats().sends, 0);
      assert.equal(world.stats().effects, 0);
      assert.equal((await world.journal.read(depositRequest.requestId))?.phase, 'prepared');
    });
});

test('malformed sender lookups retain unknown fence without raw exceptions or resends', async () => {
  for (const reply of [undefined, null, false, 1, 'submitted', [], {}])
    await fixture(async (root) => {
      const stopped = spawnSync(process.execPath, [child, root, 'dispatch-fence-exit'], {
        encoding: 'utf8',
        timeout: 10000,
      });
      assert.equal(stopped.status, 77);
      const world = depositWorld(root),
        ports = {
          ...world.ports,
          recovery: {
            ...world.ports.recovery,
            reconcileSender: async () => /** @type {any} */ (reply),
          },
        };
      await assert.rejects(resumeShieldedDeposit(depositRequest, ports), {
        code: 'MutationUnsettled',
        retryable: false,
      });
      assert.equal(world.stats().sends, 0);
      assert.equal(world.stats().effects, 0);
      assert.equal((await world.journal.read(depositRequest.requestId))?.phase, 'dispatching');
    });
});
