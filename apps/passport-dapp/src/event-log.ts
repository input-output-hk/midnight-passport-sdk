// The event log (issue #17): one run per action, one step per stage. The connector's progress
// events (`onEvent`) start the stages they map to, at their own time, and are kept with the run;
// the page times only what the connector does not report. No DOM: ui.ts renders it, and the
// copied evidence is `toJSON()`, so the two always hold the same rows. Only public values go in:
// never a seed, a key or a PRF output (an event carries none).
import type { PassportEvent } from '@midnight-ntwrk/mn-passport-protocol';
import {
  type ActionId,
  EVENT_STAGES,
  FLOWS,
  formatDuration,
  type PlainError,
  type StageDef,
} from './flows.js';

export type StepState = 'running' | 'done' | 'failed';

export interface LogStep {
  readonly id: string;
  readonly label: string;
  readonly estimateMs?: number;
  readonly startedAt: number;
  endedAt?: number;
  state: StepState;
  error?: PlainError;
  readonly notes: string[];
  data?: Record<string, unknown>;
}

export interface LogRun {
  readonly action: ActionId;
  readonly title: string;
  readonly startedAt: number;
  endedAt?: number;
  state: StepState;
  readonly steps: LogStep[];
  /** The connector's events, as they came. */
  readonly events: PassportEvent[];
  error?: PlainError;
}

export class EventLog {
  readonly runs: LogRun[] = [];
  private readonly listeners = new Set<() => void>();

  constructor(private readonly now: () => number = Date.now) {}

  /** Called after every change. */
  subscribe(listener: () => void): void {
    this.listeners.add(listener);
  }

  /** The run in progress, if any. */
  get current(): LogRun | undefined {
    const last = this.runs.at(-1);
    return last?.state === 'running' ? last : undefined;
  }

  get last(): LogRun | undefined {
    return this.runs.at(-1);
  }

  /** The planned stages of a run: its flow's, plus any ad-hoc ones it started. */
  stagesOf(run: LogRun): StageDef[] {
    const planned: StageDef[] = [...FLOWS[run.action].stages];
    for (const step of run.steps) {
      if (!planned.some((s) => s.id === step.id)) planned.push(step);
    }
    return planned;
  }

  /** Starts a run and its first stage. */
  start(action: ActionId): LogRun {
    if (this.current) throw new Error('another action is still running');
    const run: LogRun = {
      action,
      title: FLOWS[action].title,
      startedAt: this.now(),
      state: 'running',
      steps: [],
      events: [],
    };
    this.runs.push(run);
    const first = FLOWS[action].stages[0];
    if (first) this.openStep(run, first.id);
    this.emit();
    return run;
  }

  /**
   * Ends the running step and starts stage `id` (an unknown id starts an ad-hoc stage). Already
   * in stage `id`: nothing changes.
   */
  stage(id: string): void {
    const run = this.current;
    if (!run || this.runningStep()?.id === id) return;
    this.closeStep(run, 'done');
    this.openStep(run, id);
    this.emit();
  }

  /**
   * A connector event. A step that maps to a stage (`EVENT_STAGES`) starts it at the event's time;
   * an end or an error is noted on the running stage with the connector's own duration.
   */
  event(event: PassportEvent): void {
    const run = this.current;
    if (!run) return;
    run.events.push(event);
    const stage = EVENT_STAGES[run.action][event.step];
    if (event.phase === 'start' && stage !== undefined && this.runningStep()?.id !== stage) {
      this.closeStep(run, 'done', undefined, event.at);
      this.openStep(run, stage, undefined, event.at);
    } else if (event.phase !== 'start') {
      const took = event.phase === 'end' ? formatDuration(event.durationMs ?? 0) : 'failed';
      this.runningStep()?.notes.push(`${event.step} ${took}`);
    }
    this.emit();
  }

  /** A short remark on the running step, e.g. a connector step that starts no stage. */
  note(text: string): void {
    const step = this.runningStep();
    if (!step) return;
    step.notes.push(text);
    this.emit();
  }

  /** Public values to keep with the running step (and the evidence). */
  attach(data: Record<string, unknown>): void {
    const step = this.runningStep();
    if (!step) return;
    step.data = { ...step.data, ...data };
    this.emit();
  }

  /** The running step failed but the run goes on (e.g. a balance read that timed out). */
  failStep(error: PlainError): void {
    const run = this.current;
    if (!run) return;
    this.closeStep(run, 'failed', error);
    this.emit();
  }

  /** The run failed at its running step. */
  fail(error: PlainError): void {
    const run = this.current;
    if (!run) return;
    if (!this.closeStep(run, 'failed', error)) {
      // Failed between stages: record the failure as a step of its own.
      this.openStep(run, 'error', 'Error');
      this.closeStep(run, 'failed', error);
    }
    run.state = 'failed';
    run.error = error;
    run.endedAt = this.now();
    this.emit();
  }

  /** The run finished. */
  finish(): void {
    const run = this.current;
    if (!run) return;
    this.closeStep(run, 'done');
    run.state = 'done';
    run.endedAt = this.now();
    this.emit();
  }

  /** The evidence rows: the same runs and steps the page shows. */
  toJSON(): unknown[] {
    const iso = (t: number | undefined) =>
      t === undefined ? undefined : new Date(t).toISOString();
    const span = (a: number, b: number | undefined) => (b === undefined ? undefined : b - a);
    return this.runs.map((run) => ({
      action: run.action,
      title: run.title,
      result: run.state,
      startedAt: iso(run.startedAt),
      endedAt: iso(run.endedAt),
      durationMs: span(run.startedAt, run.endedAt),
      ...(run.error && { error: { ...run.error } }),
      steps: run.steps.map((step) => ({
        step: step.id,
        label: step.label,
        result: step.state,
        startedAt: iso(step.startedAt),
        endedAt: iso(step.endedAt),
        durationMs: span(step.startedAt, step.endedAt),
        ...(step.error && { error: { ...step.error } }),
        ...(step.notes.length > 0 && { notes: [...step.notes] }),
        ...(step.data && { data: step.data }),
      })),
      ...(run.events.length > 0 && {
        events: run.events.map((e) => ({
          step: e.step,
          phase: e.phase,
          at: iso(e.at),
          ...(e.durationMs !== undefined && { durationMs: e.durationMs }),
          ...(e.detail && { detail: e.detail }),
          ...(e.error && { error: { ...e.error } }),
        })),
      }),
    }));
  }

  private runningStep(): LogStep | undefined {
    const step = this.current?.steps.at(-1);
    return step?.state === 'running' ? step : undefined;
  }

  private openStep(run: LogRun, id: string, label?: string, at = this.now()): void {
    const def = FLOWS[run.action].stages.find((s) => s.id === id);
    run.steps.push({
      id,
      label: label ?? def?.label ?? id,
      ...(def?.estimateMs !== undefined && { estimateMs: def.estimateMs }),
      startedAt: at,
      state: 'running',
      notes: [],
    });
  }

  /** Closes the running step; false when there was none. */
  private closeStep(
    run: LogRun,
    state: 'done' | 'failed',
    error?: PlainError,
    at = this.now(),
  ): boolean {
    const step = run.steps.at(-1);
    if (step?.state !== 'running') return false;
    step.state = state;
    step.endedAt = at;
    if (error) step.error = error;
    return true;
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}
