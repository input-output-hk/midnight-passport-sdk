import assert from 'node:assert/strict';
import type { JourneyHarness } from './types.js';
import { expectedCredentialPurposes, type JourneyGroup } from './catalog.mjs';
export async function collectPurposes(h: JourneyHarness, group: JourneyGroup | undefined) {
  assert.deepEqual(h.failures, []);
  assert.deepEqual(h.pageErrors, []);
  assert.deepEqual(h.credentialFailureCodes, []);
  const purposes = new Set(h.archivedPurposes[h.arm] ?? []);
  for (const context of h.contexts)
    for (const page of context.pages()) {
      const observed = await page.evaluate(() => {
        const w = window as typeof window & {
          __passportPurposeObservations?: { purpose: string }[];
          __passportPurposeFailureCodes?: string[];
        };
        return {
          purposes: w.__passportPurposeObservations ?? [],
          failures: w.__passportPurposeFailureCodes ?? [],
        };
      });
      assert.deepEqual(observed.failures, [], 'no profile may hide observer failures');
      if (group === 'presentation')
        assert.equal(
          observed.purposes.length,
          0,
          'presentation profile must not access credentials',
        );
      else
        assert.ok(
          observed.purposes.length > 0,
          'each key-origin profile must exercise observed purposes',
        );
      for (const value of observed.purposes) purposes.add(value.purpose);
    }
  if (group !== 'presentation')
    for (const purpose of expectedCredentialPurposes(h.arm, group))
      assert.ok(purposes.has(purpose), `missing observed ${purpose} access for ${h.arm}`);
  return [...purposes].sort();
}
