// The progress bar's arithmetic, apart from the DOM: which state and fill each stage's segment
// has, the sentence under the bar, and the elapsed time. ui.ts draws the result; the tests call
// this with a fixed clock. No DOM, no clock of its own: `now` is passed in.
import type { LogRun } from './event-log.js';
import { formatClock, formatDuration, type StageDef } from './flows.js';

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

/** A running stage with an estimate never fills past this, so full means it really ended. */
export const RUNNING_FILL_CAP = 97;

/** How much of the bar a stage takes: known durations get wider segments, at least 1. */
export const segmentGrow = (stage: StageDef): number =>
  Math.max(1, (stage.estimateMs ?? 0) / 20_000);

export function progressView(run: LogRun, stages: readonly StageDef[], now: number): ProgressView {
  let label = '';
  const segments = stages.map((stage, i): SegmentView => {
    const step = run.steps.find((s) => s.id === stage.id);
    if (step?.state === 'done') return { state: 'done', width: 100 };
    if (step?.state === 'failed') return { state: 'failed', width: 100 };
    if (step?.state !== 'running') return { state: 'pending', width: 0 };
    const elapsed = now - step.startedAt;
    if (step.estimateMs) {
      const over = elapsed > step.estimateMs;
      label =
        `Step ${i + 1} of ${stages.length}: ${step.label} · ${formatClock(elapsed)} of about ` +
        `${formatClock(step.estimateMs)}${over ? ' (taking longer than usual)' : ''}`;
      return {
        state: 'running',
        width: Math.min(RUNNING_FILL_CAP, (elapsed / step.estimateMs) * 100),
      };
    }
    label = `Step ${i + 1} of ${stages.length}: ${step.label}`;
    return { state: 'indeterminate', width: 100 };
  });
  const end = run.endedAt ?? now;
  if (run.state === 'done') {
    label = `${run.title} finished in ${formatDuration(end - run.startedAt)}.`;
  } else if (run.state === 'failed') {
    const step = run.steps.find((s) => s.state === 'failed');
    label = `${run.title} failed${step ? ` at “${step.label}”` : ''}.`;
  }
  return { segments, label, elapsedMs: end - run.startedAt };
}
