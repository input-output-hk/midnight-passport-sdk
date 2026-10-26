import assert from 'node:assert/strict';
import { test } from 'node:test';
import { lifecycleStages, crashesAfterSubmit } from '../scripts/qualification/lifecycle-stages.mjs';

for (const arm of /** @type {const} */ (['p256', 'jubjub']))
  test(`${arm}: lifecycle interruption reaches enrollment and the unresolved-removal key-switch boundary`, () => {
    const stages = lifecycleStages(arm);
    const faults = stages.filter((s) => s[1] !== 'none');
    assert.equal(faults.length, 2);
    for (const [op, fault] of faults) {
      const circuit = `${op === 'add-target' ? 'add_device' : 'rotate_enc_key'}_with_${arm}`;
      const record = /** @type {any} */ ({
        identity: { kind: 'call' },
        input: { circuit },
        steps: [{}],
      });
      assert.equal(crashesAfterSubmit(fault, record), true);
      assert.equal(
        crashesAfterSubmit(fault, { ...record, input: { circuit: `append_inbox_with_${arm}` } }),
        false,
      );
      assert.equal(crashesAfterSubmit(fault, { ...record, identity: { kind: 'deploy' } }), false);
      const start = stages.findIndex((s) => s[0] === op);
      assert.deepEqual(stages[start + 1], [op, 'none', 'resume']);
    }
    assert.ok(
      stages.findIndex((s) => s[0] === 'add-survivor') <
        stages.findIndex((s) => s[0] === 'remove-target'),
    );
    assert.ok(stages.some((s) => s[0] === 'survivor-rotate'));
  });

for (const arm of /** @type {const} */ (['p256', 'jubjub']))
  test(`${arm}: integrated outage plan enrolls a survivor before faults and keeps the unresolved proof last`, async () => {
    const { survivorOutageStages } = await import('../scripts/qualification/lifecycle-stages.mjs');
    const stages = survivorOutageStages(arm);
    assert.equal(stages.length, 15);
    assert.deepEqual(stages.slice(0, 4), [
      ['create', 'deploy:0:after-submit', 'owner'],
      ['create', 'before-deploy-proof', 'resume'],
      ['create', 'call:0:after-submit', 'resume'],
      ['create', 'none', 'resume'],
    ]);
    assert.ok(
      stages.findIndex(([op]) => op === 'add-survivor') <
        stages.findIndex(([op]) => op === 'add-target'),
    );
    assert.equal(stages.filter(([, fault]) => fault.includes('after-submit')).length, 5);
    assert.deepEqual(stages.slice(-2), [
      ['rotate-prover', 'before-owner-proof', 'owner'],
      ['rotate-prover', 'assert-unknown', 'resume'],
    ]);
    for (const [i, stage] of stages.entries())
      if (stage[1].includes('after-submit')) {
        assert.equal(stages[i + 1]?.[0], stage[0]);
        assert.equal(stages[i + 1]?.[2], 'resume');
      }
  });
