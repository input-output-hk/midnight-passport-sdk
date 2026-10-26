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
