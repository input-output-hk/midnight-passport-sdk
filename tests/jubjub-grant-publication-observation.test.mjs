import assert from 'node:assert/strict';
import { test } from 'node:test';
import { publishJubjubGrantBookkeeping } from '../packages/account/dist/index.js';
import { jubjubPublicationFixture } from './fixtures/jubjub-publication-fixture.mjs';

for (const attempts of [1, 3, 120]) {
  test(`absent active grant retains one roster step, ${attempts} reads and ${attempts - 1} sleeps`, async () => {
    const f = await jubjubPublicationFixture();
    f.fault.active = false;
    await assert.rejects(publishJubjubGrantBookkeeping(f.input, { ...f.ports, attempts }), {
      code: 'GrantRosterUnsettled',
      message: 'The submitted grant did not appear active on chain.',
    });
    assert.equal(f.trace.filter((call) => call === 'active').length, attempts);
    assert.deepEqual(f.sleeps, Array(attempts - 1).fill(1000));
    assert.deepEqual(
      f.events.map((event) => [event.step, event.phase]),
      [
        ['grant.roster', 'start'],
        ['grant.roster', 'error'],
      ],
    );
    assert.equal(f.sessions.length, 0);
    assert.equal(f.calls.length, 0);
  });
}

for (const observation of ['nonce-only', 'entry-only']) {
  test(`${observation} settlement cannot complete or trigger another append`, async () => {
    const f = await jubjubPublicationFixture();
    f.fault.observation = observation;
    await assert.rejects(publishJubjubGrantBookkeeping(f.input, f.ports), {
      code: 'GrantBookkeepingUnsettled',
      message: 'The accepted grant bookkeeping append did not appear on chain.',
    });
    assert.equal(f.calls.length, 1);
    assert.equal(f.receipts.length, 1);
    assert.equal(f.signatures.length, 1);
    assert.equal(f.marked(), false);
    assert.deepEqual(f.sleeps, [1000, 1000]);
    assert.equal(
      f.events.filter((event) => event.step === 'chain.read' && event.phase === 'start').length,
      2,
      'initial snapshot and one entire settlement poll',
    );
  });
}

test('local counter persistence failure after acceptance retains the append and pending journal', async () => {
  const f = await jubjubPublicationFixture();
  f.fault.record = true;
  await assert.rejects(
    publishJubjubGrantBookkeeping(f.input, f.ports),
    (error) => error === f.unknown,
  );
  assert.equal(f.calls.length, 1);
  assert.equal(f.receipts.length, 1);
  assert.equal(f.marked(), false);
  assert.deepEqual(f.sleeps, []);
  f.fault.record = false;
  const result = await publishJubjubGrantBookkeeping(f.input, f.ports);
  assert.equal(result.status, 'active');
  assert.equal(result.appendTxHashes.length, 1);
  assert.equal(f.calls.length, 2);
});
