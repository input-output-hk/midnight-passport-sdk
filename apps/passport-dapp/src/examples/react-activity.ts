/** Browser-only synthetic consumer entry. SDK packages remain free of React dependencies. */
import { createElement as h, StrictMode, useState, version as reactVersion } from 'react';
import { createRoot } from 'react-dom/client';
import {
  createActivityStore,
  createOperationStatus,
} from '@input-output-hk/mn-passport-account/interaction';
import { usePassportActivity, type ActivityReader } from './react-store.js';
import { OperationStatus, Journey, ActivityPanel } from './react-controls.js';

function Host({
  store,
  label,
  theme,
  journeyFirst,
  onAudit,
}: {
  store: ActivityReader;
  label: string;
  theme: 'a' | 'b';
  journeyFirst?: boolean;
  onAudit(id: string): void;
}) {
  const snapshot = usePassportActivity(store);
  const operation = h(OperationStatus, {
    key: 'operation',
    operation: snapshot.operation,
    onAudit,
  });
  const journey = h(Journey, { key: 'journey', steps: snapshot.journey });
  return h(
    ActivityPanel,
    { label, theme },
    ...(journeyFirst ? [journey, operation] : [operation, journey]),
  );
}

// The host owns this presentation store outside React. Effect replay and renderer cleanup
// must not dispose the shared controller, derive a key or send an account command.
const activity = createActivityStore({
  journey: [
    { id: 'account', title: 'Read a synthetic ACC observation', phase: 'done' },
    { id: 'wallet', title: 'Connect a separate wallet', phase: 'optional' },
  ],
});

function publishUnknown() {
  const previous = activity.getSnapshot();
  const now = Date.now();
  const operation = createOperationStatus(
    {
      id: 'synthetic-operation',
      title: 'Synthetic submission observation',
      phase: 'unknown',
      startedAt: now,
      endedAt: now,
      references: { intentId: 'original-synthetic-intent' },
      stages: [],
    },
    now,
  );
  activity.replace({ operation, journey: previous.journey }, previous.revision);
}

function simulateResolution() {
  const previous = activity.getSnapshot();
  if (!previous.operation) return;
  const now = Date.now();
  const operation = createOperationStatus(
    {
      ...previous.operation,
      title: 'Synthetic confirmed observation',
      phase: 'succeeded',
      endedAt: now,
    },
    now,
  );
  activity.replace({ operation, journey: previous.journey }, previous.revision);
}

function Demo() {
  const snapshot = usePassportActivity(activity);
  const [showA, setShowA] = useState(true);
  const [audit, setAudit] = useState('No Audit reference selected.');
  const onAudit = (id: string) => setAudit(`Public presentation reference: ${id}`);
  return h(
    'main',
    null,
    h('h1', null, 'Optional React host example'),
    h(
      'p',
      { className: 'notice' },
      'Synthetic presentation data only. No account, wallet, passkey, network or transaction is accessed. No SSR, React Native or lace-sdk integration is established.',
    ),
    h(
      'p',
      null,
      'Two hosts share public snapshots under React StrictMode. Host A uses operation first; Host B demonstrates an alternative slot order and theme.',
    ),
    h('p', { id: 'react-runtime' }, `React ${reactVersion}`),
    h(
      'div',
      { className: 'example-actions' },
      h(
        'button',
        { id: 'react-publish', type: 'button', onClick: publishUnknown },
        'Publish synthetic unknown observation',
      ),
      h(
        'button',
        {
          id: 'react-resolve',
          type: 'button',
          disabled: !snapshot.operation,
          onClick: simulateResolution,
        },
        'Simulate a verified observation',
      ),
      h(
        'button',
        { id: 'react-toggle', type: 'button', onClick: () => setShowA((visible) => !visible) },
        showA ? 'Unmount host A' : 'Remount host A',
      ),
    ),
    h('p', { id: 'react-revision' }, `Revision ${snapshot.revision}`),
    h('p', { id: 'react-audit-output', role: 'status' }, audit),
    h(
      'div',
      { className: 'example-hosts' },
      showA && h(Host, { key: 'a', store: activity, label: 'Partner host A', theme: 'a', onAudit }),
      h(Host, {
        key: 'b',
        store: activity,
        label: 'Partner host B',
        theme: 'b',
        journeyFirst: true,
        onAudit,
      }),
    ),
    h(
      'p',
      null,
      '“Simulate a verified observation” only changes public example data. A real host must verify original intents through its journals and chain adapters; this button is not a reconciliation API.',
    ),
    h('a', { href: '/' }, 'Return to Passport prototype'),
  );
}

const root = document.getElementById('react-example-root');
if (!root) throw new Error('React example mount is missing.');
createRoot(root).render(h(StrictMode, null, h(Demo)));
