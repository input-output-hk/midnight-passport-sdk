import type {
  ActivitySnapshot,
  ActivityStore,
  JourneyStep,
  OperationStatusSnapshot,
} from '@input-output-hk/mn-passport-account/interaction';
import { formatClock } from './flows.js';

/** Example DOM renderers: snapshots/callbacks in, text nodes out. No account/credential access. */
const element = <K extends keyof HTMLElementTagNameMap>(tag: K, text?: string) => {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  return node;
};

export interface ActivityLabels {
  readonly operationHeading?: string;
  readonly journeyHeading?: string;
  readonly auditLabel?: string;
  readonly emptyText?: string;
}

export function OperationStatus(
  onAudit: (operationId: string) => void,
  labels: ActivityLabels = {},
  details?: HTMLElement,
) {
  const root = element('section');
  root.className = 'operation-status';
  const title = element('h2', labels.operationHeading ?? 'Current operation');
  const summary = element('p', labels.emptyText ?? 'No operation yet.');
  summary.setAttribute('role', 'status');
  const stage = element('p');
  const elapsed = element('p');
  elapsed.className = 'hint';
  elapsed.setAttribute('aria-hidden', 'true');
  const references = element('dl');
  references.className = 'activity-references';
  const audit = element('button', labels.auditLabel ?? 'View in Audit');
  audit.type = 'button';
  audit.className = 'btn btn-ghost';
  audit.dataset.control = 'operation-audit-link';
  audit.hidden = true;
  let operationId: string | undefined;
  audit.addEventListener('click', () => {
    if (operationId) onAudit(operationId);
  });
  root.append(title, summary, stage, elapsed);
  if (details) root.append(details);
  root.append(references, audit);
  const names = {
    running: 'In progress',
    succeeded: 'Completed',
    failed: 'Attempt failed',
    cancelled: 'Attempt cancelled — earlier effects may remain; inspect Audit',
    unknown: 'Outcome unknown — reconcile the original operation before retrying',
  } as const;
  return {
    root,
    update(operation: OperationStatusSnapshot | undefined) {
      operationId = operation?.id;
      const text = operation
        ? `${operation.title}. ${names[operation.phase]}.`
        : (labels.emptyText ?? 'No operation yet.');
      if (summary.textContent !== text) summary.textContent = text;
      root.dataset.phase = operation?.phase ?? 'idle';
      const current = operation?.stages.find((s) => s.phase === 'running' || s.phase === 'unknown');
      stage.textContent = current ? current.title : '';
      elapsed.textContent = operation ? `${formatClock(operation.elapsedMs)} elapsed` : '';
      audit.hidden = !operation;
      // Public references are text, not URLs or retry commands. Full exchanges stay in Audit.
      references.replaceChildren();
      for (const [kind, value] of Object.entries(operation?.references ?? {})) {
        references.append(element('dt', kind), element('dd', value));
      }
    },
  };
}

export function Journey(heading = 'Your journey') {
  const root = element('section');
  root.className = 'journey';
  root.append(element('h2', heading));
  const list = element('ol');
  const items = new Map<string, HTMLLIElement>();
  root.append(list);
  return {
    root,
    update(steps: readonly JourneyStep[]) {
      const ids = new Set(steps.map((step) => step.id));
      for (const [id, item] of items) {
        if (!ids.has(id)) {
          item.remove();
          items.delete(id);
        }
      }
      for (const step of steps) {
        let item = items.get(step.id);
        if (!item) {
          item = element('li');
          items.set(step.id, item);
        }
        item.textContent = `${step.title} · ${step.phase}`;
        item.dataset.phase = step.phase;
        if (step.phase === 'current') item.setAttribute('aria-current', 'step');
        else item.removeAttribute('aria-current');
        list.append(item);
      }
    },
  };
}

/** Hosts can place the controls independently; the demo chooses operation before journey. */
export function ActivityPanel(
  parent: HTMLElement,
  store: Pick<ActivityStore, 'getSnapshot' | 'subscribe'>,
  onAudit: (operationId: string) => void,
  labels: ActivityLabels = {},
  operationDetails?: HTMLElement,
): () => void {
  const operation = OperationStatus(onAudit, labels, operationDetails);
  const journey = Journey(labels.journeyHeading);
  parent.append(operation.root, journey.root);
  const render = (snapshot: ActivitySnapshot) => {
    operation.update(snapshot.operation);
    journey.update(snapshot.journey);
  };
  render(store.getSnapshot());
  const detach = store.subscribe(() => render(store.getSnapshot()));
  return () => {
    detach();
    operation.root.remove();
    journey.root.remove();
  };
}
