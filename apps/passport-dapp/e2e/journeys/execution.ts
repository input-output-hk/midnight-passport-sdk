import type { JourneyHarness } from './types.js';
import { journeyGroups, type JourneyGroup } from './catalog.mjs';
import { runPresentation, runAccountActions, runScopedSessions, runOwnerSafety } from './groups.js';
import {
  signedOutBootstrap,
  sessionBootstrap,
  ownerBootstrap,
  bootstrapPlan,
} from './bootstrap.js';
export interface GroupTiming {
  group: JourneyGroup;
  elapsedMs: number;
  bodyMs: number;
  bootstrapMs: number;
  bootstrapActions: readonly string[];
  bootstrapComplete: boolean;
  complete: boolean;
}
/** Timing owns no authority. Bootstrap cannot record canonical cases before begin(). */
export async function executeGroups(
  h: JourneyHarness,
  selected: JourneyGroup | undefined,
  begin: (group: JourneyGroup) => void,
  timings: GroupTiming[] = [],
) {
  const phase = (group: JourneyGroup): GroupTiming => {
    const value = {
      group,
      elapsedMs: 0,
      bodyMs: 0,
      bootstrapMs: 0,
      bootstrapActions: [],
      bootstrapComplete: true,
      complete: false,
    };
    timings.push(value);
    return value;
  };
  const body = async <T>(value: GroupTiming, work: () => Promise<T>): Promise<T> => {
    begin(value.group);
    const start = performance.now();
    try {
      const result = await work();
      value.complete = true;
      return result;
    } finally {
      value.bodyMs = performance.now() - start;
      value.elapsedMs = value.bodyMs + value.bootstrapMs;
    }
  };
  const bootstrap = async <T>(value: GroupTiming, work: () => Promise<T>): Promise<T> => {
    value.bootstrapActions = bootstrapPlan(value.group);
    value.bootstrapComplete = false;
    const start = performance.now();
    try {
      const result = await work();
      value.bootstrapComplete = true;
      return result;
    } finally {
      value.bootstrapMs = performance.now() - start;
      value.elapsedMs = value.bootstrapMs;
    }
  };
  if (selected === undefined) {
    const entry = await body(phase('presentation'), () => runPresentation(h));
    const account = await body(phase('account-actions'), () => runAccountActions(h, entry));
    await body(phase('scoped-sessions'), () => runScopedSessions(h, account));
    await body(phase('owner-safety'), () => runOwnerSafety(h, account));
    return timings;
  }
  if (!journeyGroups.includes(selected)) throw Error('Unknown journey group');
  const value = phase(selected);
  if (selected === 'presentation') await body(value, () => runPresentation(h));
  else if (selected === 'account-actions') {
    const inputs = await bootstrap(value, () => signedOutBootstrap(h));
    await body(value, () => runAccountActions(h, inputs));
  } else if (selected === 'scoped-sessions') {
    const inputs = await bootstrap(value, () => sessionBootstrap(h));
    await body(value, () => runScopedSessions(h, inputs));
  } else {
    const inputs = await bootstrap(value, () => ownerBootstrap(h));
    await body(value, () => runOwnerSafety(h, inputs));
  }
  return timings;
}
