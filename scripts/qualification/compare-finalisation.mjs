#!/usr/bin/env node
// Review a separately compiled candidate without registering/replacing any SDK binding.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import * as pinned from '../../packages/contract/generated/acc-s3r1.1/index.js';
import { AccSimulator, simulationDevice } from './acc-simulator.mjs';
const [file, expectedSha256, ...extra] = process.argv.slice(2);
if (!file || !/^[a-f0-9]{64}$/.test(expectedSha256 ?? '') || extra.length)
  throw new Error('usage: compare-finalisation.mjs <candidate-module.js> <independent-sha256>');
const bytes = await readFile(resolve(file));
const digest = createHash('sha256').update(bytes).digest('hex');
if (digest !== expectedSha256) throw new Error('candidate module differs from its independent pin');
const candidate = await import(pathToFileURL(resolve(file)).href);
const results = [];
for (const [name, module, clears] of /** @type {[string,typeof pinned,boolean][]} */ ([
  ['pinned', pinned, false],
  ['candidate', candidate, true],
])) {
  for (const arm of /** @type {const} */ (['jubjub', 'p256'])) {
    const owner = simulationDevice(arm, module);
    const sim = await AccSimulator.create({ module, owner });
    const future = sim.entry(owner, 7n, 1n);
    await sim.authorised('add_device', [future], owner, 0n);
    const successor = simulationDevice('jubjub', module);
    const recovery = simulationDevice('jubjub', module);
    await sim.submitRecovery(successor, recovery);
    const late = simulationDevice('jubjub', module);
    const lateEntry = sim.entry(late, 3n, 1n);
    await sim.authorised('add_device', [lateEntry], owner, 1n);
    await assert.rejects(sim.call('recover_finalise'), /veto window still open/);
    const oldCurrent = sim.entry(owner, 2n, 0n);
    sim.now += 61;
    await sim.call('recover_finalise');
    assert.equal(sim.ledger().device_epoch, 1n);
    assert.equal(sim.ledger().device_count, 1n);
    assert.equal(sim.ledger().devices.member(oldCurrent), !clears);
    assert.equal(sim.ledger().devices.size(), clears ? 1n : 4n);
    assert.equal(sim.ledger().devices.member(future), !clears);
    assert.equal(sim.ledger().devices.member(lateEntry), !clears);
    assert.equal(sim.ledger().devices.member(sim.entry(successor)), true);
    assert.deepEqual(sim.ledger().recovery_pk, recovery.pk);
    assert.equal(sim.ledger().pending_recovery, false);
    assert.equal(sim.ledger().recovery_phi_len, 0n);
    for (const [
      device,
      counter,
    ] of /** @type {[import('./acc-simulator.mjs').SimDevice,bigint][]} */ ([
      [owner, 7n],
      [late, 3n],
    ])) {
      if (clears)
        await assert.rejects(
          sim.authorised('append_inbox', [new Uint8Array(192)], device, counter),
          /unknown device entry/,
        );
      else await sim.authorised('append_inbox', [new Uint8Array(192)], device, counter);
    }
    await sim.authorised('append_inbox', [new Uint8Array(192)], successor, 0n);
    results.push({
      module: name,
      ownerArm: arm,
      priorEntriesCleared: clears,
      oldCurrentEpochEntryCleared: clears,
      pendingEnrollmentCleared: clears,
      successorAuthorised: true,
      successorRecoveryKeyInstalled: true,
    });
  }
}
console.log(
  JSON.stringify(
    {
      schemaVersion: 1,
      evidenceKind: 'contract-simulator',
      candidateModuleSha256: digest,
      candidateRegisteredAsBinding: false,
      proofOrNodeQualified: false,
      results,
    },
    null,
    2,
  ),
);
