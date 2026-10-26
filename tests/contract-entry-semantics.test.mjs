// Executes shipped contract code with signatures. This is simulator evidence, not a proof/node test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AccSimulator, simulationDevice } from '../scripts/qualification/acc-simulator.mjs';

for (const arm of ['jubjub', 'p256']) {
  for (const removerArm of /** @type {const} */ (['jubjub', 'p256'])) {
    test(`${arm}/${removerArm}: removing one opaque entry leaves a second entry of the same signing key`, async () => {
      const device = simulationDevice(/** @type {'jubjub'|'p256'} */ (arm));
      const sim = await AccSimulator.create({ owner: device });
      const survivor = simulationDevice(removerArm);
      await sim.authorised('add_device', [sim.entry(survivor)], device, 0n);
      const duplicate = sim.entry(device, 9n);
      await sim.authorised('add_device', [duplicate], device, 1n);
      const removed = sim.entry(device, 2n);
      await sim.authorised('remove_device', [removed], survivor, 0n);
      assert.equal(sim.ledger().devices.member(removed), false);
      assert.equal(sim.ledger().devices.member(duplicate), true);
      await sim.authorised('append_inbox', [new Uint8Array(192)], device, 9n);
      assert.equal(sim.ledger().devices.member(sim.entry(device, 10n)), true);
      await assert.rejects(
        sim.authorised('append_inbox', [new Uint8Array(192)], device, 2n),
        /unknown device entry/,
      );
    });
  }
}

for (const arm of ['jubjub', 'p256']) {
  test(`${arm}: an opaque future-epoch entry is inert before recovery but retained by the pinned finaliser`, async () => {
    const owner = simulationDevice(/** @type {'jubjub'|'p256'} */ (arm));
    const sim = await AccSimulator.create({ owner });
    const future = sim.entry(owner, 7n, 1n);
    await sim.authorised('add_device', [future], owner, 0n);
    await assert.rejects(
      sim.authorised('append_inbox', [new Uint8Array(192)], owner, 7n),
      /unknown device entry/,
    );
    const successor = simulationDevice('jubjub');
    await sim.submitRecovery(successor);
    await assert.rejects(sim.call('recover_finalise'), /veto window still open/);
    sim.now += 61;
    await sim.call('recover_finalise');
    assert.equal(sim.ledger().device_epoch, 1n);
    // Known upstream limitation: count=1 does not prove the old set was cleared.
    assert.equal(sim.ledger().device_count, 1n);
    assert.equal(sim.ledger().devices.member(future), true);
    await sim.authorised('append_inbox', [new Uint8Array(192)], owner, 7n);
    await sim.authorised('append_inbox', [new Uint8Array(192)], successor, 0n);
  });
}

test('recovery rejects a wrong gate key, requires pending state and allows a surviving-device veto', async () => {
  const sim = await AccSimulator.create();
  const successor = simulationDevice('jubjub');
  const before = sim.snapshot();
  await assert.rejects(sim.call('recover_finalise'), /no recovery pending/);
  await assert.rejects(
    sim.submitRecovery(successor, simulationDevice('jubjub'), simulationDevice('jubjub')),
    /invalid recovery signature/,
  );
  assert.deepEqual(sim.snapshot(), before);
  await sim.submitRecovery(successor);
  await assert.rejects(sim.submitRecovery(successor), /recovery already pending/);
  await sim.authorised('recover_cancel', [], sim.owner, 0n);
  assert.equal(sim.ledger().pending_recovery, false);
  await assert.rejects(sim.call('recover_finalise'), /no recovery pending/);
});

test('an entry added during pending recovery also survives the legacy finaliser', async () => {
  const sim = await AccSimulator.create();
  const successor = simulationDevice('jubjub');
  await sim.submitRecovery(successor);
  const late = simulationDevice('jubjub');
  const planted = sim.entry(late, 3n, 1n);
  await sim.authorised('add_device', [planted], sim.owner, 0n);
  sim.now += 61;
  await sim.call('recover_finalise');
  assert.equal(sim.ledger().devices.member(planted), true);
  await sim.authorised('append_inbox', [new Uint8Array(192)], late, 3n);
  // The original current-epoch chain is inert after the epoch change.
  await assert.rejects(
    sim.authorised('append_inbox', [new Uint8Array(192)], sim.owner, 1n),
    /unknown device entry/,
  );
});
