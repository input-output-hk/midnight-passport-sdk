import assert from 'node:assert/strict';
import { expectedCases, type JourneyGroup } from './catalog.mjs';
import type { JourneyArm } from '../journey-arms.js';
import type { journeyTiming } from '../journey-timing.js';
export interface CaseAttestation {
  arm: JourneyArm;
  group: JourneyGroup;
  id: string;
  name: string;
}
export function caseRecorder(
  arm: JourneyArm,
  selected: JourneyGroup | undefined,
  timing: ReturnType<typeof journeyTiming>,
  legacy: { arm: string; name: string }[],
  attestations: CaseAttestation[],
) {
  const expected = expectedCases(arm, selected);
  let next = 0,
    active: JourneyGroup | undefined;
  return {
    begin(group: JourneyGroup) {
      assert.ok(selected === undefined || selected === group);
      active = group;
    },
    done(id: string) {
      const target = expected[next];
      assert.ok(target, 'Unexpected extra case');
      assert.equal(target.id, id, 'Case missing, duplicated or out of order');
      assert.equal(target.group, active, 'Case belongs to another group');
      next++;
      timing.checkpoint(target.name);
      legacy.push({ arm, name: target.name });
      attestations.push({ arm, group: target.group, id, name: target.name });
      console.log(`PASS ${arm}: ${target.name}`);
    },
    complete() {
      assert.equal(next, expected.length, 'Incomplete selected case inventory');
    },
  };
}
