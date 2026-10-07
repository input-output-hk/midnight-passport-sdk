// Presentation: the action buttons, the progress bar, the event log, the account and wallet cards
// and the evidence. app.ts keeps the connector calls and drives this through `createUi`.
// Every dynamic string goes in through textContent or an attribute, never innerHTML.
import type { PassportAccountState, PassportTxResult } from '@midnight-ntwrk/mn-passport-protocol';
import { EventLog, type LogRun, type LogStep } from './event-log.js';
import {
  type ActionId,
  FLOWS,
  formatClock,
  formatDuration,
  plainError,
  promptLabel,
  promptsFor,
} from './flows.js';

export interface EvidenceHeader {
  readonly note: string;
  readonly passkey: string;
  readonly network: string;
  readonly serviceUrl: string;
  readonly pinnedManifestSha256: string;
  readonly apiVersion?: string;
}

export interface AccountView {
  readonly address: string;
  readonly networkId: string;
  readonly bindingId: string;
  readonly state: PassportAccountState;
  readonly lastTx?: PassportTxResult;
}

export interface WalletView {
  readonly unshieldedAddress?: string;
  readonly shieldedAddress?: string;
  readonly dustAddress?: string;
  readonly unshieldedBalances?: Record<string, bigint>;
  readonly dust?: { balance: bigint; cap: bigint };
  /** Set when the balances could not be read (the wallet itself connected). */
  readonly balanceError?: string;
}

const ACTIONS: readonly ActionId[] = ['create', 'open', 'rotate', 'wallet'];

const byId = <T extends HTMLElement = HTMLElement>(id: string): T => {
  const element = document.getElementById(id);
  if (!element) throw new Error(`index.html has no element with id "${id}"`);
  return element as T;
};

/** createElement with a class and text, all through safe setters. */
function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

const clockTime = (t: number) =>
  new Date(t).toLocaleTimeString('en-GB', { hour12: false, timeStyle: 'medium' });

export const shorten = (value: string, head = 8, tail = 6): string =>
  value.length <= head + tail + 1 ? value : `${value.slice(0, head)}…${value.slice(-tail)}`;

const jsonReplacer = (_k: string, v: unknown) => (typeof v === 'bigint' ? v.toString() : v);

const formatAmount = (v: bigint) => v.toLocaleString('en-GB');

export function createUi(header: EvidenceHeader) {
  const log = new EventLog();
  const buttons = Object.fromEntries(ACTIONS.map((a) => [a, byId<HTMLButtonElement>(a)])) as Record<
    ActionId,
    HTMLButtonElement
  >;
  const copyButton = byId<HTMLButtonElement>('copy');
  const statusEl = byId('status');
  const announceEl = byId('announce');
  const progressEl = byId('progress');
  const progressLabel = byId('progress-label');
  const elapsedEl = byId('elapsed');
  const logEl = byId('log');
  const logEmpty = byId('log-empty');
  const evidenceEl = byId('evidence');
  let ready = true;
  let account: AccountView | undefined;
  let wallet: WalletView = {};
  let ticker: ReturnType<typeof setInterval> | undefined;

  // The action cards: prompt counts and summaries come from flows.ts only.
  for (const action of ACTIONS) byId(`${action}-desc`).textContent = FLOWS[action].summary;
  const renderPrompts = () => {
    for (const action of ACTIONS) {
      byId(`${action}-prompts`).textContent = promptLabel(promptsFor(action, !!account));
    }
  };

  const status = (text: string) => {
    statusEl.textContent = text;
  };
  const announce = (text: string) => {
    // Cleared first so that the same message twice is announced twice.
    announceEl.textContent = '';
    requestAnimationFrame(() => {
      announceEl.textContent = text;
    });
  };

  // --- buttons -----------------------------------------------------------------------------
  const renderButtons = () => {
    const busy = log.current !== undefined;
    buttons.create.disabled = busy || !ready;
    buttons.open.disabled = busy || !ready;
    buttons.rotate.disabled = busy || !account;
    buttons.wallet.disabled = busy;
    copyButton.disabled = busy || log.runs.length === 0;
    // With an account open, rotating is the next thing to show; before that, creating is.
    buttons.create.classList.toggle('btn-primary', !account);
    buttons.create.classList.toggle('btn-secondary', !!account);
    buttons.rotate.classList.toggle('btn-primary', !!account);
    buttons.rotate.classList.toggle('btn-secondary', !account);
    byId('rotate-needs').hidden = !!account;
    renderPrompts();
    document.body.toggleAttribute('data-busy', busy);
  };

  // --- progress ----------------------------------------------------------------------------
  let segmentsFor: LogRun | undefined;
  let segmentFills: HTMLElement[] = [];
  const renderProgress = () => {
    const run = log.last;
    if (!run) {
      progressEl.replaceChildren();
      progressEl.setAttribute('aria-valuetext', 'No action has run yet');
      progressLabel.textContent = 'Choose an action to begin.';
      elapsedEl.textContent = '';
      return;
    }
    const stages = log.stagesOf(run);
    if (segmentsFor !== run || segmentFills.length !== stages.length) {
      segmentsFor = run;
      segmentFills = [];
      progressEl.replaceChildren(
        ...stages.map((stage) => {
          const segment = el('div', 'segment');
          // Known durations get wider segments, so the deployment reads as the long part.
          segment.style.flexGrow = String(Math.max(1, (stage.estimateMs ?? 0) / 20_000));
          segment.title = stage.label;
          const fill = el('div', 'fill');
          segment.append(fill);
          segmentFills.push(fill);
          return segment;
        }),
      );
    }
    const now = Date.now();
    let label = '';
    stages.forEach((stage, i) => {
      const step = run.steps.find((s) => s.id === stage.id);
      const segment = segmentFills[i]?.parentElement;
      const fill = segmentFills[i];
      if (!segment || !fill) return;
      let state = 'pending';
      let width = 0;
      if (step?.state === 'done') {
        state = 'done';
        width = 100;
      } else if (step?.state === 'failed') {
        state = 'failed';
        width = 100;
      } else if (step?.state === 'running') {
        const elapsed = now - step.startedAt;
        if (step.estimateMs) {
          state = 'running';
          // Never shows full before the stage really ends.
          width = Math.min(97, (elapsed / step.estimateMs) * 100);
          const over = elapsed > step.estimateMs;
          label =
            `Step ${i + 1} of ${stages.length}: ${step.label} · ${formatClock(elapsed)} of about ` +
            `${formatClock(step.estimateMs)}${over ? ' (taking longer than usual)' : ''}`;
        } else {
          state = 'indeterminate';
          width = 100;
          label = `Step ${i + 1} of ${stages.length}: ${step.label}`;
        }
      }
      segment.dataset.state = state;
      fill.style.width = `${width}%`;
    });
    const end = run.endedAt ?? now;
    elapsedEl.textContent = formatClock(end - run.startedAt);
    if (run.state === 'done') {
      label = `${run.title} finished in ${formatDuration(end - run.startedAt)}.`;
    } else if (run.state === 'failed') {
      const at = run.steps.findIndex((s) => s.state === 'failed');
      const step = run.steps[at];
      label = `${run.title} failed${step ? ` at “${step.label}”` : ''}.`;
    }
    progressLabel.textContent = label;
    progressEl.setAttribute('aria-valuetext', label);
    if (run.state === 'done') progressEl.setAttribute('aria-valuenow', '100');
    else progressEl.removeAttribute('aria-valuenow');
  };

  // --- event log ---------------------------------------------------------------------------
  // Rendered in place, never rebuilt, so that the aria-live log announces only new rows.
  const runEls = new WeakMap<
    LogRun,
    { root: HTMLElement; meta: HTMLElement; steps: HTMLElement }
  >();
  const stepEls = new WeakMap<LogStep, ReturnType<typeof stepElement>>();

  const timeEl = (t: number | undefined) => {
    const node = el('time', undefined, t === undefined ? '…' : clockTime(t));
    if (t !== undefined) node.dateTime = new Date(t).toISOString();
    return node;
  };

  function stepElement(step: LogStep) {
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

  const RESULT_TEXT = { running: 'Running', done: 'Done', failed: 'Failed' } as const;

  const renderStep = (step: LogStep, parent: HTMLElement) => {
    let parts = stepEls.get(step);
    if (!parts) {
      parts = stepElement(step);
      stepEls.set(step, parts);
      parent.append(parts.root);
    }
    // Skip unchanged rows: the key covers everything the row shows.
    const key = `${step.state}|${step.endedAt}|${step.notes.length}|${step.error?.code}`;
    if (parts.rendered === key) return;
    parts.rendered = key;
    parts.root.dataset.state = step.state;
    if (step.state === 'running') parts.root.setAttribute('aria-current', 'step');
    else parts.root.removeAttribute('aria-current');
    const to = el('span', 'sr-only', ' to ');
    const arrow = el('span', 'arrow', '→');
    arrow.setAttribute('aria-hidden', 'true');
    parts.times.replaceChildren(timeEl(step.startedAt), to, arrow, timeEl(step.endedAt));
    parts.duration.textContent =
      step.endedAt === undefined ? 'running' : formatDuration(step.endedAt - step.startedAt);
    parts.result.textContent = RESULT_TEXT[step.state];
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

  const renderLog = () => {
    logEmpty.hidden = log.runs.length > 0;
    for (const run of log.runs) {
      let parts = runEls.get(run);
      if (!parts) {
        const root = el('li', 'run');
        const head = el('div', 'run-head');
        const title = el('h3', 'run-title', run.title);
        const meta = el('span', 'run-meta');
        head.append(title, meta);
        const steps = el('ol', 'steps');
        root.append(head, steps);
        parts = { root, meta, steps };
        runEls.set(run, parts);
        // Newest first: the running action stays at the top, next to the progress bar.
        logEl.prepend(root);
      }
      parts.root.dataset.state = run.state;
      const meta =
        run.endedAt === undefined
          ? `Started ${clockTime(run.startedAt)} · running`
          : `Started ${clockTime(run.startedAt)} · ${formatDuration(run.endedAt - run.startedAt)} · ${RESULT_TEXT[run.state]}`;
      if (parts.meta.textContent !== meta) parts.meta.textContent = meta;
      for (const step of run.steps) renderStep(step, parts.steps);
    }
  };

  // --- evidence ----------------------------------------------------------------------------
  const evidence = () => ({
    ...header,
    page: location.origin,
    account: account && {
      address: account.address,
      networkId: account.networkId,
      bindingId: account.bindingId,
      state: account.state,
      lastTx: account.lastTx,
    },
    wallet: Object.keys(wallet).length > 0 ? wallet : undefined,
    runs: log.toJSON(),
  });
  const renderEvidence = () => {
    evidenceEl.textContent = JSON.stringify(evidence(), jsonReplacer, 2);
  };

  // --- account and wallet cards --------------------------------------------------------------
  const copyTo = async (button: HTMLButtonElement, value: string, what: string) => {
    try {
      await navigator.clipboard.writeText(value);
      button.textContent = 'Copied';
      announce(`${what} copied.`);
      setTimeout(() => {
        button.textContent = 'Copy';
      }, 1500);
    } catch {
      announce('Copy failed: the browser refused clipboard access.');
    }
  };

  type Fact = { label: string; value: string; full?: string; copy?: string; hint?: string };
  const renderFacts = (list: HTMLElement, facts: readonly Fact[]) => {
    list.replaceChildren(
      ...facts.map((fact) => {
        const row = el('div', 'fact');
        const dt = el('dt', undefined, fact.label);
        const dd = el('dd');
        const value = el('span', 'value', fact.value);
        if (fact.full) value.title = fact.full;
        dd.append(value);
        if (fact.copy !== undefined) {
          const copy = el('button', 'btn-copy', 'Copy');
          copy.type = 'button';
          copy.setAttribute('aria-label', `Copy ${fact.label.toLowerCase()}`);
          const text = fact.copy;
          copy.addEventListener('click', () => void copyTo(copy, text, fact.label));
          dd.append(copy);
        }
        if (fact.hint) dd.append(el('span', 'fact-hint', fact.hint));
        row.append(dt, dd);
        return row;
      }),
    );
  };

  const renderAccount = () => {
    byId('account-empty').hidden = !!account;
    const list = byId('account-facts');
    list.hidden = !account;
    if (!account) return;
    const { address, networkId, bindingId, state, lastTx } = account;
    renderFacts(list, [
      { label: 'Address', value: shorten(address, 10, 8), full: address, copy: address },
      { label: 'Network', value: networkId },
      { label: 'Auth nonce', value: state.authNonce.toString() },
      {
        label: 'Device entries',
        value: String(state.entryCount),
        hint: 'Entries in the device set, not a device count (erratum 8).',
      },
      { label: 'Binding', value: bindingId },
      lastTx
        ? {
            label: 'Last transaction',
            value:
              shorten(lastTx.txHash, 10, 8) +
              (lastTx.blockHeight !== undefined ? ` · block ${lastTx.blockHeight}` : ''),
            full: lastTx.txHash,
            copy: lastTx.txHash,
          }
        : {
            label: 'Last transaction',
            value: '—',
            hint: 'Create and open do not report a transaction; rotate does.',
          },
    ]);
  };

  const renderWallet = () => {
    const connected = Object.keys(wallet).length > 0;
    byId('wallet-empty').hidden = connected;
    const list = byId('wallet-facts');
    list.hidden = !connected;
    if (!connected) return;
    const facts: Fact[] = [];
    const address = (label: string, value: string | undefined) => {
      if (value) facts.push({ label, value: shorten(value, 14, 8), full: value, copy: value });
    };
    address('Unshielded address', wallet.unshieldedAddress);
    address('Shielded address', wallet.shieldedAddress);
    address('Dust address', wallet.dustAddress);
    if (wallet.unshieldedBalances) {
      const entries = Object.entries(wallet.unshieldedBalances);
      if (entries.length === 0) facts.push({ label: 'Unshielded balance', value: '0' });
      for (const [token, amount] of entries) {
        facts.push({
          label: /^0+$/.test(token) ? 'NIGHT' : `Token ${shorten(token, 6, 4)}`,
          value: formatAmount(amount),
          full: token,
          hint: 'Smallest unit.',
        });
      }
    } else if (wallet.balanceError) {
      facts.push({ label: 'Balances', value: 'Not read', hint: wallet.balanceError });
    } else {
      facts.push({ label: 'Balances', value: 'Waiting for the wallet to sync…' });
    }
    if (wallet.dust) {
      facts.push({
        label: 'DUST',
        value: `${formatAmount(wallet.dust.balance)} of ${formatAmount(wallet.dust.cap)}`,
        hint: 'Balance of cap, in Specks.',
      });
    }
    renderFacts(list, facts);
  };

  // --- wiring ------------------------------------------------------------------------------
  const tick = () => renderProgress();
  log.subscribe(() => {
    renderButtons();
    renderProgress();
    renderLog();
    renderEvidence();
    if (log.current && !ticker) ticker = setInterval(tick, 250);
    if (!log.current && ticker) {
      clearInterval(ticker);
      ticker = undefined;
    }
  });

  copyButton.addEventListener('click', () => {
    renderEvidence();
    void navigator.clipboard
      .writeText(evidenceEl.textContent ?? '')
      .then(() => {
        status('Evidence copied: the event log, the account and the wallet, with no secrets.');
      })
      .catch(() => status('Copy failed: the browser refused clipboard access.'));
  });

  renderButtons();
  renderProgress();
  renderAccount();
  renderWallet();
  renderEvidence();

  return {
    status,
    /** Ends the running stage and starts `id`. */
    stage: (id: string) => log.stage(id),
    note: (text: string) => log.note(text),
    /** Public values to keep with the running step and the evidence. */
    record: (name: string, data: Record<string, unknown> = {}) => log.attach({ [name]: data }),
    /**
     * Runs `fn` as stage `id`; a failure marks the step failed but does not end the action
     * (for reads that can time out while the rest has worked).
     */
    attempt: async <T>(id: string, fn: () => Promise<T>): Promise<T | undefined> => {
      log.stage(id);
      try {
        return await fn();
      } catch (e) {
        log.failStep(plainError(e, header.serviceUrl));
        return undefined;
      }
    },
    /** Binds an action button: one action at a time, timed and logged, errors in plain language. */
    on(action: ActionId, fn: () => Promise<void>) {
      const button = buttons[action];
      button.addEventListener('click', async () => {
        if (log.current) return;
        log.start(action);
        try {
          await fn();
          log.finish();
        } catch (e) {
          const err = plainError(e, header.serviceUrl);
          log.fail(err);
          status(`${FLOWS[action].title} failed. ${err.hint} (${err.code})`);
        } finally {
          // The button was disabled while the action ran, which drops focus: give it back.
          if (document.activeElement === document.body && !button.disabled) button.focus();
        }
      });
    },
    setReady(value: boolean) {
      ready = value;
      renderButtons();
    },
    showAccount(view: AccountView) {
      // The last transaction carries over only while the same account stays open.
      const keep = account?.address === view.address ? account.lastTx : undefined;
      const lastTx = view.lastTx ?? keep;
      account = { ...view, ...(lastTx && { lastTx }) };
      renderAccount();
      renderButtons();
      renderEvidence();
    },
    showWallet(view: WalletView) {
      wallet = { ...wallet, ...view };
      renderWallet();
      renderEvidence();
    },
  };
}
