// Generated ACC validates actual JubJub signatures and key recipes; no native acceptance claim.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { publishJubjubGrantBookkeeping } from '../packages/account/dist/index.js';
import { jubjubPublicationFixture } from './fixtures/jubjub-publication-fixture.mjs';

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
