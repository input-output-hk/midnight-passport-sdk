// Optional HTML renderers, with host-owned layout/labels/theme. Importing does not mount UI.
import { createElement as h, type ReactNode } from 'react';
import type {
  JourneyStep,
  OperationStatusSnapshot,
} from '@input-output-hk/mn-passport-account/interaction';

export function OperationStatus({
  operation,
  onAudit,
}: {
  operation?: OperationStatusSnapshot | undefined;
  onAudit(id: string): void;
}) {
  return h(
    'section',
    { className: 'react-operation' },
    h('h3', null, 'Current operation'),
    h(
      'p',
      { 'data-phase': operation?.phase ?? 'idle' },
      operation ? `${operation.title} · ${operation.phase}` : 'No synthetic observation yet.',
    ),
    operation?.phase === 'unknown' &&
      h('p', null, 'Keep the original intent and reconcile; rendering never retries it.'),
    operation && h('p', { className: 'intent' }, operation.references.intentId),
    operation &&
      h(
        'button',
        { type: 'button', 'data-action': 'audit', onClick: () => onAudit(operation.id) },
        'Inspect public Audit reference',
      ),
  );
}

export function Journey({ steps }: { steps: readonly JourneyStep[] }) {
  return h(
    'section',
    { className: 'react-journey' },
    h('h3', null, 'Your journey'),
    h(
      'ol',
      null,
      ...steps.map((step) =>
        h('li', { key: step.id, 'data-phase': step.phase }, `${step.title} · ${step.phase}`),
      ),
    ),
  );
}

/** Slots let hosts arrange the same controls differently; ordinary branding is host-owned. */
export function ActivityPanel({
  label,
  theme,
  children,
}: {
  label: string;
  theme: 'a' | 'b';
  children?: ReactNode;
}) {
  return h(
    'section',
    { className: `react-host theme-${theme}`, 'aria-label': label },
    h('h2', null, label),
    children,
  );
}
