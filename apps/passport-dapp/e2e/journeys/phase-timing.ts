import type { JourneyGroup } from './catalog.mjs';
export interface PhaseInterval {
  startMs: number;
  endMs: number | null;
  elapsedMs: number | null;
}
export interface GroupTiming {
  group: JourneyGroup;
  elapsedMs: number | null;
  bodyMs: number | null;
  bootstrapMs: number | null;
  bootstrap: PhaseInterval | null;
  body: PhaseInterval | null;
  bootstrapActions: readonly string[];
  bootstrapComplete: boolean;
  complete: boolean;
}
export function groupTiming(group: JourneyGroup): GroupTiming {
  return {
    group,
    elapsedMs: 0,
    bodyMs: 0,
    bootstrapMs: 0,
    bootstrap: null,
    body: null,
    bootstrapActions: [],
    bootstrapComplete: true,
    complete: false,
  };
}
function summarize(value: GroupTiming) {
  value.bodyMs = value.body ? value.body.elapsedMs : 0;
  value.bootstrapMs = value.bootstrap ? value.bootstrap.elapsedMs : 0;
  value.elapsedMs =
    value.bodyMs === null || value.bootstrapMs === null ? null : value.bodyMs + value.bootstrapMs;
}
/** Shared origin-relative clock; rejected work retains an incomplete interval, never a completed body. */
export async function measureJourneyPhase<T>(
  value: GroupTiming,
  kind: 'bootstrap' | 'body',
  boundary: () => number,
  work: () => Promise<T>,
): Promise<T> {
  const observed: PhaseInterval = { startMs: boundary(), endMs: null, elapsedMs: null };
  value[kind] = observed;
  if (kind === 'bootstrap') value.bootstrapComplete = false;
  else value.complete = false;
  summarize(value);
  try {
    const result = await work();
    const endMs = boundary();
    observed.endMs = endMs;
    observed.elapsedMs = endMs - observed.startMs;
    if (kind === 'bootstrap') value.bootstrapComplete = true;
    else value.complete = true;
    return result;
  } finally {
    summarize(value);
  }
}
