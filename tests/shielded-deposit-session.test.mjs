// Real WebAuthn adapter + AES-GCM disk journal; software authenticator/fake wallet and finality.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, rmSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { webauthnPasskey } from '../packages/adapter-webauthn/dist/index.js';
import { depositShielded, resumeShieldedDeposit } from '../packages/account/dist/index.js';
import { encryptedShieldedDepositJournal } from '../packages/keys/dist/index.js';
import { fileMutationByteStore } from '../packages/service/dist/index.js';
import { softwareAuthenticator, RP, ORIGIN } from './fixtures/software-authenticator.mjs';
import { depositWorld, depositRequest, depositPins } from './fixtures/shielded-deposit-world.mjs';

/** @param {'enabled'|'results'} mode */
async function fixture(mode) {
  const root = mkdtempSync(join(tmpdir(), 'passport-real-journal-session-'));
  const auth = softwareAuthenticator({ atCreate: mode });
  const adapter = webauthnPasskey({ rpId: RP, origin: ORIGIN, credentials: auth.container });
  await adapter.credentials.create({ name: 'test-only' });
  const world = depositWorld(root);
  /** @type {Uint8Array[]} */ const derived = [];
  const source = {
    ...adapter.prf,
    deriveSecret: async (/** @type {{domain:string,context:string,length?:number}} */ input) => {
      const key = await adapter.prf.deriveSecret(input);
      derived.push(key);
      return key;
    },
  };
  const journal = encryptedShieldedDepositJournal(
    depositPins,
    source,
    fileMutationByteStore(join(root, 'actual-journal')),
  );
  const ports = { ...world.ports, recovery: { ...world.ports.recovery, journal } };
  return {
    root,
    auth,
    source,
    journal,
    ports,
    world,
    derived,
    count: () => auth.gets.filter((o) => o.extensions?.prf).length,
    released: () => assert.ok(derived.every((key) => key.every((byte) => byte === 0))),
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

test('real adapter/journal baseline repeats PRF assertions without an approved outer session', async (t) => {
  const f = await fixture('enabled');
  try {
    assert.equal(f.auth.gets.length, 1, 'creation enrollment assertion is separate');
    await depositShielded(depositRequest, f.ports);
    assert.equal(f.count(), 10, 'versioned cold unwrapped PRF assertion baseline');
    f.released();
    t.diagnostic(
      `cold_unwrapped_prf_assertions=${f.count()}; sender_effects=${f.world.stats().effects}`,
    );
    assert.equal(f.world.stats().effects, 1);
  } finally {
    f.cleanup();
  }
});

test('one approved cold operation uses one PRF assertion and later same-ID continuation unlocks afresh', async (t) => {
  const f = await fixture('enabled');
  try {
    const result = await f.source.withSession(() => depositShielded(depositRequest, f.ports));
    assert.equal(f.count(), 1);
    f.released();
    const repeated = await f.source.withSession(() =>
      resumeShieldedDeposit(depositRequest, f.ports),
    );
    assert.deepEqual(repeated, result);
    assert.equal(f.count(), 2);
    f.released();
    assert.equal(f.world.stats().sends, 1);
    assert.equal(f.world.stats().effects, 1);
    const raw = readdirSync(join(f.root, 'actual-journal'))
      .map((p) => readFileSync(join(f.root, 'actual-journal', p), 'utf8'))
      .join('');
    assert.equal(raw.includes('"amount"'), false);
    assert.equal(raw.includes('"entry"'), false);
    t.diagnostic('cold_wrapped_prf_assertions=1; later_resume_prf_assertions=1; sender_effects=1');
  } finally {
    f.cleanup();
  }
});

test('create-time PRF outputs avoid the first operation assertion but never the later independent unlock', async () => {
  const f = await fixture('results');
  try {
    await f.source.withSession(() => depositShielded(depositRequest, f.ports));
    assert.equal(f.count(), 0);
    f.released();
    await f.source.withSession(() => resumeShieldedDeposit(depositRequest, f.ports));
    assert.equal(f.count(), 1);
    f.released();
    assert.equal(f.world.stats().effects, 1);
  } finally {
    f.cleanup();
  }
});

for (const boundary of [
  'unknown-with-record',
  'unknown-without-record',
  'callback-after-confirmation',
]) {
  test(`approved journal session releases keys and preserves original intent at ${boundary}`, async () => {
    const f = await fixture('enabled');
    try {
      const ports = {
        ...f.ports,
        sender: {
          depositShielded: async (
            /** @type {Parameters<typeof f.ports.sender.depositShielded>[0]} */ call,
          ) => {
            if (boundary !== 'unknown-without-record') await f.ports.sender.depositShielded(call);
            throw Error('private wallet diagnostic');
          },
        },
      };
      if (boundary === 'callback-after-confirmation') {
        await assert.rejects(
          f.source.withSession(async () => {
            await depositShielded(depositRequest, f.ports);
            throw Error('host callback failed');
          }),
          /host callback failed/,
        );
      } else
        await assert.rejects(
          f.source.withSession(() => depositShielded(depositRequest, ports)),
          { code: 'MutationUnsettled', retryable: false },
        );
      assert.equal(f.count(), 1);
      f.released();
      if (boundary === 'unknown-without-record')
        await assert.rejects(
          f.source.withSession(() => resumeShieldedDeposit(depositRequest, f.ports)),
          { code: 'MutationUnsettled', retryable: false },
        );
      else
        assert.equal(
          (await f.source.withSession(() => resumeShieldedDeposit(depositRequest, f.ports))).txId,
          'tx-original',
        );
      assert.equal(f.count(), 2);
      f.released();
      assert.equal(f.world.stats().effects, boundary === 'unknown-without-record' ? 0 : 1);
      assert.equal(f.world.stats().sends, boundary === 'unknown-without-record' ? 0 : 1);
      const doc = await f.source.withSession(() => f.journal.read(depositRequest.requestId));
      assert.ok(doc);
      assert.equal(doc.phase, boundary === 'unknown-without-record' ? 'dispatching' : 'confirmed');
    } finally {
      f.cleanup();
    }
  });
}

for (const refusal of /** @type {const} */ (['cancelled', 'unavailable', 'wrongCredential'])) {
  test(`PRF ${refusal} refuses before deposit work and a later attempt cannot reuse failed session material`, async () => {
    const f = await fixture('enabled');
    try {
      f.auth.prfControl[refusal] = true;
      await assert.rejects(f.source.withSession(() => depositShielded(depositRequest, f.ports)));
      assert.equal(f.count(), 1);
      assert.equal(f.world.stats().reads, 0);
      assert.equal(f.world.stats().sends, 0);
      f.released();
      f.auth.prfControl[refusal] = false;
      await f.source.withSession(() => depositShielded(depositRequest, f.ports));
      assert.equal(f.count(), 2);
      assert.equal(f.world.stats().effects, 1);
      f.released();
    } finally {
      f.cleanup();
    }
  });
}
