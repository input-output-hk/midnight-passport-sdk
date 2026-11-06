// The progress bar's arithmetic, apart from the DOM: which state and fill each stage's segment
// has, the sentence under the bar, and the elapsed time. ui.ts draws the result; the tests call
// this with a fixed clock. No DOM, no clock of its own: `now` is passed in.
import type { LogRun } from './event-log.js';
import { formatClock, formatDuration, type StageDef } from './flows.js';
import {
  createOperationStatus,
  stageWeight,
  type OperationPhase,
  type OperationReferences,
} from '@input-output-hk/mn-passport-account/interaction';
export { RUNNING_FILL_CAP } from '@input-output-hk/mn-passport-account/interaction';

export type SegmentState = 'pending' | 'running' | 'indeterminate' | 'done' | 'failed';

export interface SegmentView {
  readonly state: SegmentState;
  /** Fill, 0 to 100. */
  readonly width: number;
}

export interface ProgressView {
  /** One per stage, in order. */
  readonly segments: readonly SegmentView[];
  readonly label: string;
  /** Time since the run started, to its end or to `now`. */
  readonly elapsedMs: number;
}

/** How much of the bar a stage takes: known durations get wider segments, at least 1. */
export const segmentGrow = (stage: StageDef): number => stageWeight(stage);

export function operationStatus(
  run: LogRun,
  stages: readonly StageDef[],
  now: number,
  options?: { id: string; phase: OperationPhase; references: OperationReferences },
) {
  // Log rows retain original client/service timestamps for Audit. A transition can close a
  // client-stamped step with a service-stamped time (or vice versa); those clocks need not
  // agree. Clamp only the presentation interval, never rewrite the raw event or stop polling
  // an already-submitted operation because of wall-clock skew.
  return createOperationStatus(
    {
      id: options?.id ?? run.action,
      title: run.title,
      phase: options?.phase ?? (run.state === 'done' ? 'succeeded' : run.state),
      ...(options && { references: options.references }),
      startedAt: run.startedAt,
      ...(run.endedAt !== undefined && { endedAt: Math.max(run.startedAt, run.endedAt) }),
      stages: stages.map((stage) => {
        const step = run.steps.find((s) => s.id === stage.id);
        return {
          id: stage.id,
          title: stage.label,
          phase: step?.state === 'done' ? 'succeeded' : (step?.state ?? 'pending'),
          ...(step && { startedAt: step.startedAt }),
          ...(step?.endedAt !== undefined && { endedAt: Math.max(step.startedAt, step.endedAt) }),
          ...(stage.estimateMs !== undefined && { estimateMs: stage.estimateMs }),
        };
      }),
    },
    now,
  );
}

export function progressView(run: LogRun, stages: readonly StageDef[], now: number): ProgressView {
  const status = operationStatus(run, stages, now);
  let label = '';
  const segments = stages.map((stage, i): SegmentView => {
    const step = run.steps.find((s) => s.id === stage.id);
    if (step?.state === 'done') return { state: 'done', width: 100 };
    if (step?.state === 'failed') return { state: 'failed', width: 100 };
    if (step?.state !== 'running') return { state: 'pending', width: 0 };
    const elapsed = status.stages[i]?.elapsedMs ?? 0;
    if (step.estimateMs) {
      const over = elapsed > step.estimateMs;
      label =
        `Step ${i + 1} of ${stages.length}: ${step.label} · ${formatClock(elapsed)} of about ` +
        `${formatClock(step.estimateMs)}${over ? ' (taking longer than usual)' : ''}`;
      return {
        state: 'running',
        width: status.stages[i]?.fillPercent ?? 0,
      };
    }
    label = `Step ${i + 1} of ${stages.length}: ${step.label}`;
    return { state: 'indeterminate', width: 100 };
  });
  if (run.state === 'done') {
    label = `${run.title} finished in ${formatDuration(status.elapsedMs)}.`;
  } else if (run.state === 'failed') {
    const step = run.steps.find((s) => s.state === 'failed');
    label = `${run.title} failed${step ? ` at “${step.label}”` : ''}.`;
  }
  return { segments, label, elapsedMs: status.elapsedMs };
}
