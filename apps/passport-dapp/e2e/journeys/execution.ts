import type { JourneyHarness } from './types.js';
import { journeyGroups, type JourneyGroup } from './catalog.mjs';
import { runPresentation, runAccountActions, runScopedSessions, runOwnerSafety } from './groups.js';
import {
  signedOutBootstrap,
  sessionBootstrap,
  ownerBootstrap,
  bootstrapPlan,
} from './bootstrap.js';
import { groupTiming, measureJourneyPhase, type GroupTiming } from './phase-timing.js';
export type { GroupTiming } from './phase-timing.js';
/** Timing owns no authority. Bootstrap cannot record canonical cases before begin(). */
export async function executeGroups(
  h: JourneyHarness,
  selected: JourneyGroup | undefined,
  begin: (group: JourneyGroup) => void,
  boundary: () => number,
  timings: GroupTiming[] = [],
) {
  const phase = (group: JourneyGroup): GroupTiming => {
    const value = groupTiming(group);
    timings.push(value);
    return value;
  };
  const body = <T>(value: GroupTiming, work: () => Promise<T>): Promise<T> => {
    begin(value.group);
    return measureJourneyPhase(value, 'body', boundary, work);
  };
  const bootstrap = <T>(value: GroupTiming, work: () => Promise<T>): Promise<T> => {
    value.bootstrapActions = bootstrapPlan(value.group);
    return measureJourneyPhase(value, 'bootstrap', boundary, work);
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
