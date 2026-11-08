// Generated ACC validates actual JubJub signatures and key recipes; no native acceptance claim.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { publishJubjubGrantBookkeeping } from '../packages/account/dist/index.js';
import { jubjubPublicationFixture } from './fixtures/jubjub-publication-fixture.mjs';

for (const seals of ['empty', 'one', 'short']) {
  test(`malformed ${seals} required bookkeeping seals refuse before any signature or send`, async () => {
    const f = await jubjubPublicationFixture();
    f.fault.seals = seals;
    await assert.rejects(publishJubjubGrantBookkeeping(f.input, f.ports), {
      code: 'InternalError',
      message: 'Viewing key returned invalid grant seals.',
    });
    assert.equal(f.signatures.length, 0);
    assert.equal(f.calls.length, 0);
    assert.equal(f.marked(), false);
    assert.ok(await f.ports.journal.load(f.input.hint.address, f.input.grantId));
  });
}

for (const read of [false, true]) {
  test(`real ${read ? 'read' : 'spend'} publication preserves trace, session and fully published no-op`, async () => {
    const f = await jubjubPublicationFixture(read);
    const opening = await f.ports.journal.load(f.input.hint.address, f.input.grantId);
    assert.ok(opening);
    f.trace.length = 0;
    const result = await publishJubjubGrantBookkeeping(f.input, f.ports);
    assert.equal(result.status, 'active');
    assert.equal(result.appendTxHashes.length, read ? 3 : 2);
    assert.equal(f.signatures.length, read ? 3 : 2);
    assert.equal(f.marked(), true);
    assert.equal(Boolean(result.sealedReadGrant), read);
    assert.deepEqual(f.sessions, [
      {
        kind: 'issue-grant',
        account: f.input.hint.address,
        grantId: f.input.grantId,
        scope: opening.scope,
        slot: opening.bookkeeping.slot,
        scopeSalt: opening.bookkeeping.scopeSalt,
        scopeDigest: opening.scopeDigest,
      },
    ]);
    for (const call of f.calls) {
      assert.equal(call.signal, f.input.signal);
      assert.equal(call.onEvent, f.calls[0]?.onEvent);
      assert.equal(call.circuit, 'append_inbox_with_jubjub');
    }
    assert.equal(new Set(f.events.map((event) => event.flowId)).size, 1);
    const steps = f.events.filter((event) => event.phase === 'start').map((event) => event.step);
    assert.deepEqual(steps, [
      'grant.roster',
      'chain.read',
      'grant.stage',
      'grant.roster',
      'grant.roster',
      'grant.roster',
      'counter.scan',
      'passkey.sign',
      'chain.read',
      'grant.roster',
      'counter.scan',
      'passkey.sign',
      'chain.read',
      ...(read ? ['grant.seal', 'counter.scan', 'passkey.sign', 'chain.read'] : []),
      'grant.roster',
    ]);
    const before = f.calls.length;
    f.trace.length = 0;
    const again = await publishJubjubGrantBookkeeping(f.input, f.ports);
    assert.deepEqual(again.appendTxHashes, []);
    assert.equal(f.calls.length, before);
    assert.equal(again.nextUseCounter, result.nextUseCounter);
    assert.equal(f.trace.filter((call) => call === 'record:read').length, 1);
    assert.equal(
      f.trace.some((call) => call.startsWith('seal:') || call === 'sign'),
      false,
    );
  });
}

for (const [read, boundary] of /** @type {[boolean,string][]} */ ([
  [false, '1:after'],
  [false, '2:after'],
  [true, '3:after'],
])) {
  test(`landed ${boundary} (${read ? 'read' : 'spend'}) stops once and resumes only missing logical parts`, async () => {
    const f = await jubjubPublicationFixture(read);
    f.fault.boundary = boundary;
    await assert.rejects(
      publishJubjubGrantBookkeeping(f.input, f.ports),
      (error) => error === f.unknown,
    );
    assert.equal(f.marked(), false);
    assert.equal(f.receipts.length, Number(boundary[0]));
    const original = f.calls.map((call) => call.args[0]);
    f.fault.boundary = '';
    const recovered = await publishJubjubGrantBookkeeping(f.input, f.ports);
    assert.equal(recovered.status, 'active');
    assert.equal(f.calls.length, read ? 3 : 2);
    assert.deepEqual(
      f.calls.slice(0, original.length).map((call) => call.args[0]),
      original,
    );
    assert.equal(f.marked(), true);
    assert.equal(recovered.appendTxHashes.length, (read ? 3 : 2) - original.length);
  });
}

for (const signature of ['key', 'counter']) {
  test(`wrong ${signature} signature refuses before dispatch`, async () => {
    const f = await jubjubPublicationFixture();
    f.fault.signature = signature;
    await assert.rejects(publishJubjubGrantBookkeeping(f.input, f.ports), {
      code: 'NotAuthorised',
      message: 'The signature names another device.',
    });
    assert.equal(f.calls.length, 0);
    assert.equal(f.marked(), false);
  });
}

test('abort during signing refuses dispatch while retaining the original staged grant', async () => {
  const f = await jubjubPublicationFixture();
  const sign = f.authoriser.authorise;
  f.authoriser.authorise = async function (request) {
    const signed = await sign.call(this, request);
    f.controller.abort('signed but caller closed');
    return signed;
  };
  await assert.rejects(publishJubjubGrantBookkeeping(f.input, f.ports), { code: 'Aborted' });
  assert.equal(f.signatures.length, 1);
  assert.equal(f.calls.length, 0);
  assert.equal(f.marked(), false);
});

test('the read-seal Flow observer can replace the current host method with its receiver', async () => {
  const f = await jubjubPublicationFixture(true);
  const seal = f.viewingKey.sealView;
  assert.ok(seal);
  let replaced = 0;
  await publishJubjubGrantBookkeeping(
    {
      ...f.input,
      onEvent(event) {
        f.input.onEvent(event);
        if (event.step === 'grant.seal' && event.phase === 'start')
          f.viewingKey.sealView = async function (...args) {
            assert.equal(this, f.viewingKey);
            replaced++;
            return seal.apply(this, args);
          };
      },
    },
    f.ports,
  );
  assert.equal(replaced, 1);
  assert.equal(f.marked(), true);
});

test('a custom decoder retains the legacy late array-entry lookup before publication', async () => {
  const f = await jubjubPublicationFixture();
  const seal = f.viewingKey.sealGrant;
  const open = f.viewingKey.openInbox;
  /** @type {Uint8Array[] | undefined} */ let sealed;
  /** @type {Uint8Array | undefined} */ let replacement;
  f.viewingKey.sealGrant = async function (...args) {
    sealed = await seal.apply(this, args);
    return sealed;
  };
  f.viewingKey.openInbox = async function (...args) {
    const result = await open.apply(this, args);
    if (args[2] === sealed) {
      const header = sealed?.[0];
      assert.ok(header);
      replacement = Uint8Array.from(header);
      // Deliberately breaks readonly provider output to protect the pre-extraction lookup time.
      Reflect.set(sealed, 0, replacement);
    }
    return result;
  };
  await publishJubjubGrantBookkeeping(f.input, f.ports);
  assert.ok(replacement);
  assert.equal(f.calls[0]?.args[0], replacement);
  assert.equal(f.marked(), true);
});

test('read delivery rereads the provider entry after the counter observer before signing and sending', async () => {
  const f = await jubjubPublicationFixture(true);
  const seal = f.viewingKey.sealView;
  assert.ok(seal);
  /** @type {Awaited<ReturnType<typeof seal>> | undefined} */ let delivery;
  /** @type {Uint8Array | undefined} */ let replacement;
  f.viewingKey.sealView = async function (...args) {
    delivery = await seal.apply(this, args);
    return delivery;
  };
  await publishJubjubGrantBookkeeping(
    {
      ...f.input,
      onEvent(event) {
        f.input.onEvent(event);
        if (event.step === 'counter.scan' && event.phase === 'start' && f.signatures.length === 2) {
          assert.ok(delivery);
          replacement = Uint8Array.from(delivery.entry);
          // A custom provider can replace its readonly result; preserve the existing observation point.
          Object.assign(delivery, { entry: replacement });
        }
      },
    },
    f.ports,
  );
  assert.ok(replacement);
  assert.equal(f.signatures[2]?.args[0], replacement);
  assert.equal(f.calls[2]?.args[0], replacement);
  assert.equal(f.marked(), true);
});
