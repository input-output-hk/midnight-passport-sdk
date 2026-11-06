/**
 * Public presentation models for host-owned controls. No credential access, transaction
 * commands, timer, DOM or framework. Hosts supply already-redacted observations and a clock.
 * These observations never establish authority or chain finality.
 */
export type OperationPhase = 'running' | 'succeeded' | 'failed' | 'cancelled' | 'unknown';
export type JourneyPhase = 'pending' | 'current' | 'done' | 'optional' | 'blocked';
export type StagePhase = 'pending' | 'running' | 'succeeded' | 'failed' | 'unknown' | 'skipped';

export interface OperationReferences {
  readonly flowId?: string;
  readonly intentId?: string;
  readonly requestId?: string;
  readonly transactionId?: string;
}

export interface OperationStage {
  readonly id: string;
  readonly title: string;
  readonly phase: StagePhase;
  readonly startedAt?: number;
  readonly endedAt?: number;
  readonly estimateMs?: number;
}

export interface OperationObservation {
  /** Stable host operation ID, also used to locate its redacted Audit entry. */
  readonly id: string;
  readonly title: string;
  readonly phase: OperationPhase;
  readonly startedAt: number;
  /** End of the host attempt, not evidence that a transaction settled. */
  readonly endedAt?: number;
  readonly references?: OperationReferences;
  readonly stages: readonly OperationStage[];
}

export interface OperationStageSnapshot extends OperationStage {
  readonly weight: number;
  readonly elapsedMs?: number;
  /** Absent for an unestimated running stage or an unknown outcome. Never a confirmation %. */
  readonly fillPercent?: number;
}

export interface OperationStatusSnapshot {
  readonly id: string;
  readonly title: string;
  readonly phase: OperationPhase;
  readonly startedAt: number;
  readonly endedAt?: number;
  readonly elapsedMs: number;
  readonly references: Readonly<OperationReferences>;
  readonly stages: readonly OperationStageSnapshot[];
}

export interface JourneyStep {
  readonly id: string;
  readonly title: string;
  readonly phase: JourneyPhase;
}

export interface ActivityObservation {
  readonly operation?: OperationStatusSnapshot;
  readonly journey: readonly JourneyStep[];
}

export interface ActivitySnapshot extends ActivityObservation {
  readonly revision: number;
}

/** A time estimate must never visually claim completion. */
export const RUNNING_FILL_CAP = 97;

const operationPhases: readonly string[] = [
  'running',
  'succeeded',
  'failed',
  'cancelled',
  'unknown',
];
const stagePhases: readonly string[] = [
  'pending',
  'running',
  'succeeded',
  'failed',
  'unknown',
  'skipped',
];
const journeyPhases: readonly string[] = ['pending', 'current', 'done', 'optional', 'blocked'];

function text(value: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 1024) {
    throw new TypeError('Interaction text must contain 1–1024 characters.');
  }
  return value;
}

function time(value: number): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new TypeError('Interaction time must be finite and nonnegative.');
  }
  return value;
}

function span(startedAt: number, endedAt: number | undefined, now: number): number {
  time(startedAt);
  if (endedAt !== undefined) {
    time(endedAt);
    if (endedAt < startedAt) throw new TypeError('Interaction end precedes its start.');
  }
  // A host wall clock can move backwards. Do not draw a negative fill or elapsed time.
  return Math.max(0, (endedAt ?? now) - startedAt);
}

/** Known durations occupy more of a segmented bar; short/unknown ones retain a base segment. */
export function stageWeight(stage: Pick<OperationStage, 'estimateMs'>): number {
  if (stage.estimateMs !== undefined) time(stage.estimateMs);
  return Math.max(1, (stage.estimateMs ?? 0) / 20_000);
}

function references(input: OperationReferences = {}): Readonly<OperationReferences> {
  // Explicit public-field copy. Do not spread arbitrary provider objects into a UI snapshot.
  return Object.freeze({
    ...(input.flowId !== undefined && { flowId: text(input.flowId) }),
    ...(input.intentId !== undefined && { intentId: text(input.intentId) }),
    ...(input.requestId !== undefined && { requestId: text(input.requestId) }),
    ...(input.transactionId !== undefined && { transactionId: text(input.transactionId) }),
  });
}

/**
 * Project observed stages at an explicit time. Unknown does not mean failed, done or retryable.
 * Failed/skipped stages remain distinct from successful stages even when the attempt has ended.
 */
export function createOperationStatus(
  observation: OperationObservation,
  now: number,
): OperationStatusSnapshot {
  time(now);
  if (!operationPhases.includes(observation.phase)) throw new TypeError('Invalid operation phase.');
  if (observation.phase === 'running' && observation.endedAt !== undefined) {
    throw new TypeError('A running operation cannot have an end time.');
  }
  if (
    ['succeeded', 'failed', 'cancelled'].includes(observation.phase) &&
    observation.endedAt === undefined
  ) {
    throw new TypeError('An ended operation requires its end time.');
  }
  const elapsedMs = span(observation.startedAt, observation.endedAt, now);
  const seen = new Set<string>();
  const stages = observation.stages.map((stage): OperationStageSnapshot => {
    const id = text(stage.id);
    if (seen.has(id)) throw new TypeError('Duplicate operation stage.');
    seen.add(id);
    if (!stagePhases.includes(stage.phase)) throw new TypeError('Invalid stage phase.');
    if (stage.endedAt !== undefined && stage.startedAt === undefined) {
      throw new TypeError('An observed stage end requires its start.');
    }
    if (stage.phase === 'running' && stage.endedAt !== undefined) {
      throw new TypeError('A running stage cannot have an end time.');
    }
    const elapsed =
      stage.startedAt === undefined
        ? undefined
        : span(stage.startedAt, stage.endedAt, observation.endedAt ?? now);
    const estimate = stage.estimateMs;
    const weight = stageWeight(stage);
    const fillPercent =
      stage.phase === 'succeeded' || stage.phase === 'failed'
        ? 100
        : stage.phase === 'pending' || stage.phase === 'skipped'
          ? 0
          : observation.phase !== 'unknown' &&
              stage.phase === 'running' &&
              estimate &&
              elapsed !== undefined
            ? Math.min(RUNNING_FILL_CAP, (elapsed / estimate) * 100)
            : undefined;
    return Object.freeze({
      id,
      title: text(stage.title),
      phase: stage.phase,
      ...(stage.startedAt !== undefined && { startedAt: stage.startedAt }),
      ...(stage.endedAt !== undefined && { endedAt: stage.endedAt }),
      ...(estimate !== undefined && { estimateMs: estimate }),
      weight,
      ...(elapsed !== undefined && { elapsedMs: elapsed }),
      ...(fillPercent !== undefined && { fillPercent }),
    });
  });
  return Object.freeze({
    id: text(observation.id),
    title: text(observation.title),
    phase: observation.phase,
    startedAt: observation.startedAt,
    ...(observation.endedAt !== undefined && { endedAt: observation.endedAt }),
    elapsedMs,
    references: references(observation.references),
    stages: Object.freeze(stages),
  });
}

function snapshot(input: ActivityObservation, revision: number): ActivitySnapshot {
  const seen = new Set<string>();
  const journey = input.journey.map((step) => {
    const id = text(step.id);
    if (seen.has(id)) throw new TypeError('Duplicate journey step.');
    seen.add(id);
    if (!journeyPhases.includes(step.phase)) throw new TypeError('Invalid journey phase.');
    return Object.freeze({ id, title: text(step.title), phase: step.phase });
  });
  const operation = input.operation;
  // Reproject from public observations to strip extensions and sever references, without
  // advancing time. A caller cannot mutate a previously accepted snapshot afterwards.
  const copied = operation
    ? createOperationStatus(operation, operation.startedAt + operation.elapsedMs)
    : undefined;
  return Object.freeze({
    revision,
    ...(copied !== undefined && { operation: copied }),
    journey: Object.freeze(journey),
  });
}

export interface ActivityStore {
  /** Same object until an accepted replacement. Safe as an external-store getter. */
  getSnapshot(): ActivitySnapshot;
  /** Presentation subscription only. Does not replay an action or emit during subscription. */
  subscribe(listener: () => void): () => void;
  /**
   * Compare-and-replace rejects stale async completions. The host owns observation ordering;
   * this is not a durable journal, finality check, permission check or transaction mutex.
   */
  replace(input: ActivityObservation, expectedRevision: number): boolean;
  /** Detach presentation listeners. Does not cancel/revoke an operation or erase a journal. */
  dispose(): void;
}

export function createActivityStore(initial: ActivityObservation = { journey: [] }): ActivityStore {
  let current = snapshot(initial, 0);
  let disposed = false;
  const listeners = new Set<() => void>();
  return Object.freeze({
    getSnapshot: () => current,
    subscribe(listener: () => void) {
      if (disposed) return () => {};
      // Each registration has independent ownership, including duplicate callback identities.
      const registration = () => listener();
      listeners.add(registration);
      return () => {
        listeners.delete(registration);
      };
    },
    replace(input: ActivityObservation, expectedRevision: number) {
      if (disposed || expectedRevision !== current.revision) return false;
      const next = snapshot(input, current.revision + 1);
      current = next;
      const errors: unknown[] = [];
      for (const listener of [...listeners]) {
        if (!listeners.has(listener)) continue;
        try {
          listener();
        } catch (error) {
          errors.push(error);
        }
      }
      // All active hosts see an accepted update even if one renderer fails. The snapshot has
      // already committed; surfacing renderer errors never rolls back the underlying operation.
      if (errors.length) throw new AggregateError(errors, 'Activity subscriber failed.');
      return true;
    },
    dispose() {
      disposed = true;
      listeners.clear();
    },
  });
}
