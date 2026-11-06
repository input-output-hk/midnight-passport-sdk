// Imported only by the isolated browser qualification runner, never the production entry.
import {
  createActivityStore,
  createOperationStatus,
} from '@input-output-hk/mn-passport-account/interaction';
import { ActivityPanel } from '../../src/activity-controls.js';

export function checkActivityControls() {
  const check = (condition: boolean, message: string) => {
    if (!condition) throw new Error(message);
  };
  const sandbox = document.createElement('div');
  sandbox.style.position = 'absolute';
  sandbox.style.insetInlineStart = '-10000px';
  const a = document.createElement('aside');
  const b = document.createElement('aside');
  a.style.setProperty('--heading', 'rgb(10, 20, 30)');
  b.style.setProperty('--heading', 'rgb(40, 50, 60)');
  sandbox.append(a, b);
  document.body.append(sandbox);
  const store = createActivityStore({
    journey: [{ id: 'wallet', title: 'Separate wallet connection', phase: 'optional' }],
  });
  const visits: string[] = [];
  let detachA = ActivityPanel(a, store, (id) => visits.push(`a:${id}`), {
    operationHeading: 'Partner A <script>',
    journeyHeading: 'Next steps A',
    auditLabel: 'Inspect A',
  });
  const detachB = ActivityPanel(b, store, (id) => visits.push(`b:${id}`), {
    operationHeading: 'Partner B',
    journeyHeading: 'Next steps B',
    auditLabel: 'Inspect B',
  });
  try {
    check(a.querySelector('h2')?.textContent === 'Partner A <script>', 'Host labels must be text.');
    check(a.querySelectorAll('script').length === 0, 'Renderer must not interpret label markup.');
    check(
      getComputedStyle(a.querySelector('h2')!).color === 'rgb(10, 20, 30)',
      'Host A theme was lost.',
    );
    check(
      getComputedStyle(b.querySelector('h2')!).color === 'rgb(40, 50, 60)',
      'Host B theme was lost.',
    );
    check(
      store.getSnapshot().revision === 0 && visits.length === 0,
      'Mounting must not issue a command.',
    );
    const operation = createOperationStatus(
      {
        id: 'original-operation',
        title: 'Await reconciliation',
        phase: 'unknown',
        startedAt: 1000,
        references: { intentId: 'original-intent' },
        stages: [],
      },
      2000,
    );
    store.replace({ operation, journey: store.getSnapshot().journey }, 0);
    for (const parent of [a, b]) {
      check(
        parent.querySelector('.operation-status')?.getAttribute('data-phase') === 'unknown',
        'Host lost unknown outcome.',
      );
      check(
        parent.textContent?.includes('original-intent') === true,
        'Host lost original intent ID.',
      );
      check(
        parent.textContent?.includes('optional') === true,
        'Wallet connection became mandatory.',
      );
    }
    (a.querySelector('[data-control="operation-audit-link"]') as HTMLButtonElement).click();
    check(visits.join(',') === 'a:original-operation', 'Audit callback was replayed or misrouted.');
    const before = store.getSnapshot();
    detachA();
    check(a.childElementCount === 0, 'Detached renderer retained its controls.');
    detachA = ActivityPanel(a, store, (id) => visits.push(`remount:${id}`));
    check(store.getSnapshot() === before, 'Effect-style remount changed the snapshot.');
    check(visits.length === 1, 'Effect-style remount replayed an Audit action.');
    check(b.querySelectorAll('.operation-status').length === 1, 'Remount duplicated another host.');
    return {
      hosts: 2,
      markupEscaped: true,
      themesIndependent: true,
      remountReplays: 0,
      originalIntentPreserved: true,
    };
  } finally {
    detachA();
    detachB();
    store.dispose();
    sandbox.remove();
  }
}
