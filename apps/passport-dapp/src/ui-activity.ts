import { type LogRun, type LogStep } from './event-log.js';
import { formatClock, formatDuration } from './flows.js';
import { evidenceJson } from './evidence.js';
import { progressView, segmentGrow } from './progress.js';

import { demoActivityObservation, operationForRun } from './activity-observations.js';

import { byId, el, clockTime } from './ui-dom.js';
import type { UiModel, UiDom } from './ui-state.js';

function missingRun(): never {
  throw new Error('The recorded operation is unavailable.');
}
export class ActivityView {
  installAuditListeners = () => {
    document.addEventListener('passport:workspace-selected', this.renderEvidence);
    this.dom.evidenceDetails?.addEventListener('toggle', this.renderEvidence);
    this.dom.traceDetails?.addEventListener('toggle', this.renderEvidence);
  };
  constructor(
    private readonly model: UiModel,
    private readonly dom: UiDom,
  ) {}
  private segmentsFor: LogRun | undefined;
  private segmentFills: HTMLElement[] = [];
  private runEls = new WeakMap<
    LogRun,
    { root: HTMLElement; meta: HTMLElement; steps: HTMLElement }
  >();
  private readonly stepEls = new WeakMap<LogStep, ReturnType<ActivityView['stepElement']>>();
  private RESULT_TEXT = {
    running: 'Running',
    done: 'Done',
    failed: 'Failed',
    cancelled: 'Cancelled attempt',
    unknown: 'Outcome unknown',
  } as const;
  private OUTCOME_TEXT = {
    running: 'In progress',
    succeeded: 'Completed',
    failed: 'Attempt failed',
    cancelled: 'Cancelled attempt',
    unknown: 'Outcome unknown — reconcile original IDs',
  } as const;
  renderActivity = () => {
    const observation = demoActivityObservation(this.model.log, Date.now(), {
      accountOpen: !!this.model.account,
      walletConnected: !!this.model.wallet.unshieldedAddress || this.model.externalWalletConnected,
    });
    this.model.activity.replace(observation, this.model.activity.getSnapshot().revision);
    return observation.operation;
  };
  renderProgress = () => {
    const operation = this.renderActivity();
    const run = this.model.log.last;
    this.dom.progressEl.hidden = !run;
    this.dom.progressLabel.hidden = !run;
    this.dom.elapsedEl.hidden = !run;
    byId('activity-title').hidden = !run;
    this.dom.progressEl.closest('section')?.classList.toggle('is-idle', !run);
    if (!run) {
      this.dom.progressEl.replaceChildren();
      this.dom.progressEl.setAttribute('aria-valuetext', 'No action has run yet');
      this.dom.progressLabel.textContent = 'Choose an action to begin.';
      this.dom.elapsedEl.textContent = '';
      return;
    }
    const stages = this.model.log.stagesOf(run);
    if (this.segmentsFor !== run || this.segmentFills.length !== stages.length) {
      this.segmentsFor = run;
      this.segmentFills = [];
      this.dom.progressEl.replaceChildren(
        ...stages.map((stage) => {
          const segment = el('div', 'segment');
          // Known durations get wider segments, so the deployment reads as the long part.
          segment.style.flexGrow = String(segmentGrow(stage));
          segment.title = stage.label;
          const fill = el('div', 'fill');
          segment.append(fill);
          this.segmentFills.push(fill);
          return segment;
        }),
      );
    }
    const view = progressView(run, stages, Date.now());
    const stopped = operation?.phase === 'cancelled' || operation?.phase === 'unknown';
    const lastStage = stages.findIndex((stage) => stage.id === run.steps.at(-1)?.id);
    view.segments.forEach((segmentView, i) => {
      const fill = this.segmentFills[i];
      const segment = fill?.parentElement;
      if (!segment || !fill) return;
      segment.dataset.state =
        stopped && i === lastStage
          ? operation.phase === 'unknown'
            ? 'indeterminate'
            : 'cancelled'
          : segmentView.state;
      fill.style.width = `${stopped && i === lastStage ? (operation.phase === 'unknown' ? 100 : 0) : segmentView.width}%`;
    });
    this.dom.elapsedEl.textContent = formatClock(view.elapsedMs);
    const label =
      operation?.phase === 'cancelled'
        ? `${run.title} attempt cancelled. Earlier effects may remain; inspect Audit.`
        : operation?.phase === 'unknown'
          ? `${run.title} outcome is not confirmed. Keep the original IDs and reconcile in Audit.`
          : view.label;
    this.dom.progressLabel.textContent = label;
    this.dom.progressEl.setAttribute('aria-valuetext', label);
    if (operation?.phase === 'succeeded') this.dom.progressEl.setAttribute('aria-valuenow', '100');
    else this.dom.progressEl.removeAttribute('aria-valuenow');
  };
  timeEl = (t: number | undefined) => {
    const node = el('time', undefined, t === undefined ? '…' : clockTime(t));
    if (t !== undefined) node.dateTime = new Date(t).toISOString();
    return node;
  };
  stepElement(step: LogStep) {
    const root = el('li', 'step');
    const marker = el('span', 'marker');
    marker.setAttribute('aria-hidden', 'true');
    const label = el('span', 'step-label', step.label);
    const times = el('span', 'step-times');
    const duration = el('span', 'step-duration');
    const result = el('span', 'step-result');
    const extra = el('div', 'step-extra');
    root.append(marker, label, times, duration, result, extra);
    return { root, times, duration, result, extra, rendered: '' };
  }
  renderStep = (step: LogStep, parent: HTMLElement, outcome?: 'cancelled' | 'unknown') => {
    let parts = this.stepEls.get(step);
    if (!parts) {
      parts = this.stepElement(step);
      this.stepEls.set(step, parts);
      parent.append(parts.root);
    }
    // Skip unchanged rows: the key covers everything the row shows.
    const key = `${step.state}|${step.endedAt}|${step.notes.length}|${step.error?.code}|${outcome}`;
    if (parts.rendered === key) return;
    parts.rendered = key;
    parts.root.dataset.state = outcome ?? step.state;
    if (step.state === 'running') parts.root.setAttribute('aria-current', 'step');
    else parts.root.removeAttribute('aria-current');
    const to = el('span', 'sr-only', ' to ');
    const arrow = el('span', 'arrow', '→');
    arrow.setAttribute('aria-hidden', 'true');
    parts.times.replaceChildren(this.timeEl(step.startedAt), to, arrow, this.timeEl(step.endedAt));
    parts.duration.textContent =
      step.endedAt === undefined
        ? 'running'
        : formatDuration(Math.max(0, step.endedAt - step.startedAt));
    parts.result.textContent = this.RESULT_TEXT[outcome ?? step.state];
    const extra: HTMLElement[] = [];
    if (step.notes.length > 0) extra.push(el('p', 'step-note', step.notes.join(' · ')));
    if (step.error) {
      const box = el('div', 'step-error');
      // The connector's message as it is, then the code and what it means.
      box.append(
        el('p', 'error-message', step.error.message),
        el('p', 'error-hint', `${step.error.code} · ${step.error.hint}`),
      );
      extra.push(box);
    }
    parts.extra.replaceChildren(...extra);
    parts.extra.hidden = extra.length === 0;
  };
  renderLog = () => {
    this.dom.logEmpty.hidden = this.model.log.runs.length > 0;
    for (const run of this.model.log.runs) {
      let parts = this.runEls.get(run);
      if (!parts) {
        const root = el('li', 'run');
        root.id = `audit-operation-${this.model.log.runs.indexOf(run) + 1}`;
        const head = el('div', 'run-head');
        const title = el('h3', 'run-title', run.title);
        const meta = el('span', 'run-meta');
        head.append(title, meta);
        const steps = el('ol', 'steps');
        root.append(head, steps);
        parts = { root, meta, steps };
        this.runEls.set(run, parts);
        // Newest first: the running action stays at the top, next to the progress bar.
        this.dom.logEl.prepend(root);
      }
      const operation = operationForRun(this.model.log, run, Date.now());
      parts.root.dataset.state = operation.phase;
      const meta =
        run.endedAt === undefined
          ? `Started ${clockTime(run.startedAt)} · ${this.OUTCOME_TEXT[operation.phase]}`
          : `Started ${clockTime(run.startedAt)} · ${formatDuration(operation.elapsedMs)} · ${this.OUTCOME_TEXT[operation.phase]}`;
      if (parts.meta.textContent !== meta) parts.meta.textContent = meta;
      for (const step of run.steps) {
        const outcome =
          step === run.steps.at(-1) &&
          (operation.phase === 'cancelled' || operation.phase === 'unknown')
            ? operation.phase
            : undefined;
        this.renderStep(step, parts.steps, outcome);
      }
    }
  };
  fullLog = () =>
    evidenceJson({
      header: this.model.header,
      page: location.origin,
      account: this.model.account,
      wallet: this.model.wallet,
      runs: this.model.log.toJSON().map((row, index) => ({
        ...row,
        // Keep the raw legacy attempt result and add the same observed outcome shown in Audit.
        outcome: operationForRun(
          this.model.log,
          this.model.log.runs[index] ?? missingRun(),
          Date.now(),
        ).phase,
      })),
      trace: this.model.log.traceJSON(),
    });
  auditVisible = (element: HTMLElement, details: HTMLDetailsElement | null) =>
    details
      ? details.open
      : !element.closest<HTMLElement>('[data-workspace-page]')?.hidden &&
        !element.closest<HTMLElement>('[data-workspace]')?.hidden;
  renderEvidence = () => {
    if (this.auditVisible(this.dom.evidenceEl, this.dom.evidenceDetails))
      this.dom.evidenceEl.textContent = this.fullLog();
    if (this.auditVisible(this.dom.traceEl, this.dom.traceDetails))
      this.dom.traceEl.textContent = JSON.stringify(this.model.log.traceJSON(), null, 2);
  };
}
