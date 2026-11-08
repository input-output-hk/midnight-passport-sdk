interface Interval {
  startMs: number;
  endMs: number | null;
}
interface ArmInterval extends Interval {
  arm: string;
  bodyComplete: boolean;
  checkpoints: { name: string; startMs: number; endMs: number; elapsedMs: number }[];
  cleanup: Interval | null;
  contextsCreated: number;
  pagesCreated: number;
}

/** Receipt observations only. Checkpoints include intervening setup, actions and assertions. */
export function journeyTiming(clock: () => number = () => performance.now()) {
  const origin = clock();
  if (!Number.isFinite(origin) || origin < 0) throw new Error('Invalid timing clock.');
  let last = origin;
  const now = () => {
    const value = clock();
    if (!Number.isFinite(value) || value < last) throw new Error('Non-monotonic timing clock.');
    last = value;
    return value - origin;
  };
  const setup: Interval = { startMs: 0, endMs: null };
  let setupComplete = false;
  const arms: ArmInterval[] = [];
  let active: ArmInterval | undefined;
  let cleanup: Interval | null = null;
  const currentArm = () => {
    if (!active || active.cleanup) throw new Error('No active journey body.');
    return active;
  };
  const interval = (value: Interval, time: number) => ({
    ...value,
    elapsedMs: (value.endMs ?? time) - value.startMs,
  });
  return {
    finishSetup() {
      if (setup.endMs !== null || cleanup) throw new Error('Setup already ended.');
      setup.endMs = now();
      setupComplete = true;
    },
    beginArm(arm: string) {
      if (!setupComplete || active || cleanup) throw new Error('Cannot begin journey arm.');
      active = {
        arm,
        startMs: now(),
        endMs: null,
        bodyComplete: false,
        checkpoints: [],
        cleanup: null,
        contextsCreated: 0,
        pagesCreated: 0,
      };
      arms.push(active);
    },
    created(kind: 'context' | 'page') {
      const arm = currentArm();
      if (kind === 'context') arm.contextsCreated++;
      else arm.pagesCreated++;
    },
    checkpoint(name: string) {
      const arm = currentArm();
      const endMs = now();
      const startMs = arm.checkpoints.at(-1)?.endMs ?? arm.startMs;
      arm.checkpoints.push({ name, startMs, endMs, elapsedMs: endMs - startMs });
    },
    beginArmCleanup() {
      const arm = currentArm();
      arm.cleanup = { startMs: now(), endMs: null };
    },
    endArm(complete: boolean) {
      if (!active?.cleanup) throw new Error('Journey cleanup has not begun.');
      active.endMs = active.cleanup.endMs = now();
      active.bodyComplete = complete;
      active = undefined;
    },
    beginCleanup() {
      if (active || cleanup) throw new Error('Cannot begin final cleanup.');
      const time = now();
      setup.endMs ??= time;
      cleanup = { startMs: time, endMs: null };
    },
    finishCleanup() {
      if (!cleanup || cleanup.endMs !== null) throw new Error('No active final cleanup.');
      cleanup.endMs = now();
    },
    snapshot() {
      const time = now();
      return {
        clock: 'monotonic performance.now',
        scope:
          'From runner initialization through resource cleanup; excludes ESM imports and receipt I/O.',
        checkpointMeaning:
          'Delta since previous checkpoint or arm start, including intervening UI setup, actions and assertions; not isolated test duration.',
        totalMs: cleanup?.endMs ?? time,
        setup: { ...interval(setup, time), complete: setupComplete },
        arms: arms.map((arm) => ({
          ...interval(arm, time),
          arm: arm.arm,
          bodyComplete: arm.bodyComplete,
          contextsCreated: arm.contextsCreated,
          pagesCreated: arm.pagesCreated,
          checkpoints: arm.checkpoints.map((point) => ({ ...point })),
          afterLastCheckpointMs:
            (arm.cleanup?.startMs ?? time) - (arm.checkpoints.at(-1)?.endMs ?? arm.startMs),
          cleanup: arm.cleanup && interval(arm.cleanup, time),
        })),
        cleanup: cleanup && interval(cleanup, time),
      };
    },
  };
}
