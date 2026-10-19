// Presentation: the action buttons, the progress bar, the event log, the account and wallet cards
// and the evidence. app.ts keeps the connector calls and drives this through `createUi`.
// Every dynamic string goes in through textContent or an attribute, never innerHTML.
import type {
  PassportAccountState,
  PassportEvent,
  PassportGrantRoster,
  PassportTxResult,
} from '@input-output-hk/mn-passport-protocol';
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
import { evidenceJson } from './evidence.js';
import { progressView, segmentGrow } from './progress.js';
import type { OperationTraceEntry } from './operation-trace.js';

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
  /** Explicit undefined clears a previous snapshot after a failed read. */
  readonly unshieldedBalances?: Record<string, bigint> | undefined;
  readonly dust?: { balance: bigint; cap: bigint } | undefined;
  /** Set when the balances could not be read (the wallet itself connected). */
  readonly balanceError?: string | undefined;
  readonly balanceUpdatedAt?: string | undefined;
}

const ACTIONS: readonly ActionId[] = [
  'create',
  'open',
  'openAt',
  'refresh',
  'holdings',
  'roster',
  'grantRoster',
  'prepareGrantee',
  'issueGrant',
  'exportGrant',
  'spendGrant',
  'revokeGrant',
  'recoverGrants',
  'prepareJoiner',
  'enrollDevice',
  'removeDevice',
  'rotate',
  'wallet',
  'walletRefresh',
  'fund',
  'withdraw',
];

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

const formatAmount = (v: bigint) => v.toLocaleString('en-GB');

export function createUi(header: EvidenceHeader, arm: 'p256' | 'jubjub' = 'p256') {
  const log = new EventLog();
  const buttons = Object.fromEntries(ACTIONS.map((a) => [a, byId<HTMLButtonElement>(a)])) as Record<
    ActionId,
    HTMLButtonElement
  >;
  const copyButton = byId<HTMLButtonElement>('copy');
  const handoffInput = byId<HTMLTextAreaElement>('handoff-input');
  const removalInput = byId<HTMLInputElement>('remove-commitment');
  const handoffOutput = byId<HTMLTextAreaElement>('handoff-output');
  const statusEl = byId('status');
  const announceEl = byId('announce');
  const progressEl = byId('progress');
  const progressLabel = byId('progress-label');
  const elapsedEl = byId('elapsed');
  const logEl = byId('log');
  const logEmpty = byId('log-empty');
  const evidenceEl = byId('evidence');
  const traceEl = byId('trace');
  const evidenceDetails = evidenceEl.closest('details');
  const traceDetails = traceEl.closest('details');
  let ready = true;
  let account: AccountView | undefined;
  let wallet: WalletView = {};
  let fundingAsset: { color: string; amount: string } | undefined;
  let assetsByColor = new Map<string, { color: string; amount: string }>();
  const fundingSelect = byId<HTMLSelectElement>('fund-asset');
  const withdrawalSelect = byId<HTMLSelectElement>('withdraw-asset');
  const withdrawalAmount = byId<HTMLInputElement>('withdraw-amount');
  const withdrawalRecipient = byId<HTMLInputElement>('withdraw-recipient');
  const grantGrantee = byId<HTMLInputElement>('grant-grantee');
  const grantAsset = byId<HTMLSelectElement>('grant-asset');
  const grantRecipient = byId<HTMLInputElement>('grant-recipient');
  const grantPerCall = byId<HTMLInputElement>('grant-per-call');
  const grantCap = byId<HTMLInputElement>('grant-cap');
  const revokeGrantId = byId<HTMLInputElement>('revoke-grant-id');
  const exportGrantId = byId<HTMLInputElement>('export-grant-id');
  const grantOpeningInput = byId<HTMLTextAreaElement>('grant-opening-input');
  const grantSpendAmount = byId<HTMLInputElement>('grant-spend-amount');
  const grantSpentPrev = byId<HTMLInputElement>('grant-spent-prev');
  const knownAddress = byId<HTMLInputElement>('open-address');
  let accountBalances:
    | { address: string; color: string; night?: string; fundedAsset?: string; error?: string }
    | undefined;
  let shieldedHoldings:
    | { address: string; coins: readonly { inboxIndex: number; color: string; value: string }[] }
    | undefined;
  let deviceRoster:
    | { address: string; deviceEpoch: bigint; authNonce: bigint; commitments: readonly string[] }
    | undefined;
  let grantRoster: { address: string; roster: PassportGrantRoster } | undefined;
  let ticker: ReturnType<typeof setInterval> | undefined;

  // The action cards: prompt counts and summaries come from flows.ts only.
  for (const action of ACTIONS) byId(`${action}-desc`).textContent = FLOWS[action].summary;
  if (arm === 'jubjub') {
    byId('create-desc').textContent =
      'Creates a passkey, deploys a JubJub Passport account, and seals a random viewing secret to this device.';
    byId('open-desc').textContent =
      'Reopens the JubJub account with its passkey and checks its sealed viewing secret against the live ACC.';
  }
  const renderPrompts = () => {
    for (const action of ACTIONS) {
      byId(`${action}-prompts`).textContent =
        action === 'create' || action === 'open' || action === 'openAt'
          ? 'Passkey prompts vary by provider and account state.'
          : promptLabel(promptsFor(action, !!account));
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
    buttons.openAt.disabled = busy || !ready || !/^[0-9a-f]{64}$/.test(knownAddress.value.trim());
    knownAddress.disabled = busy;
    buttons.refresh.disabled = busy || !account;
    buttons.holdings.disabled = busy || !account;
    buttons.roster.disabled = busy || !account;
    buttons.grantRoster.disabled = busy || !account;
    buttons.prepareGrantee.disabled =
      busy || !ready || !/^[0-9a-f]{64}$/.test(knownAddress.value.trim());
    buttons.issueGrant.disabled =
      busy ||
      !account ||
      assetsByColor.size === 0 ||
      !/^[0-9a-f]{64}$/.test(grantGrantee.value.trim());
    buttons.issueGrant.closest('li')?.toggleAttribute('hidden', assetsByColor.size === 0);
    buttons.revokeGrant.disabled =
      busy || !account || !/^[0-9a-f]{64}$/.test(revokeGrantId.value.trim());
    grantGrantee.disabled = busy || !account;
    grantAsset.disabled = busy || !account;
    grantRecipient.disabled = busy || !account;
    grantPerCall.disabled = busy || !account;
    grantCap.disabled = busy || !account;
    revokeGrantId.disabled = busy || !account;
    buttons.exportGrant.disabled =
      busy || !account || !/^[0-9a-f]{64}$/.test(exportGrantId.value.trim());
    exportGrantId.disabled = busy || !account;
    buttons.spendGrant.disabled = busy || !ready || !grantOpeningInput.value.trim();
    grantOpeningInput.disabled = busy;
    grantSpendAmount.disabled = busy;
    grantSpentPrev.disabled = busy;
    buttons.recoverGrants.disabled = busy || !account;
    buttons.prepareJoiner.disabled =
      busy || !ready || !/^[0-9a-f]{64}$/.test(knownAddress.value.trim());
    buttons.enrollDevice.disabled = busy || !account || !handoffInput.value.trim();
    buttons.removeDevice.disabled =
      busy || !account || !/^[0-9a-f]{64}$/.test(removalInput.value.trim());
    removalInput.disabled = busy || !account;
    handoffInput.disabled = busy;
    buttons.rotate.disabled = busy || !account;
    buttons.wallet.disabled = busy;
    buttons.walletRefresh.disabled = busy || !wallet.unshieldedAddress;
    buttons.fund.disabled = busy || !account;
    fundingSelect.disabled = busy || !account;
    buttons.fund.closest('li')?.toggleAttribute('hidden', !fundingAsset);
    buttons.withdraw.disabled = busy || !account || assetsByColor.size === 0;
    withdrawalSelect.disabled = busy || !account;
    withdrawalAmount.disabled = busy || !account;
    withdrawalRecipient.disabled = busy || !account;
    buttons.withdraw.closest('li')?.toggleAttribute('hidden', assetsByColor.size === 0);
    copyButton.disabled = busy || (log.runs.length === 0 && log.traceEntries.length === 0);
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
          segment.style.flexGrow = String(segmentGrow(stage));
          segment.title = stage.label;
          const fill = el('div', 'fill');
          segment.append(fill);
          segmentFills.push(fill);
          return segment;
        }),
      );
    }
    const view = progressView(run, stages, Date.now());
    view.segments.forEach((segmentView, i) => {
      const fill = segmentFills[i];
      const segment = fill?.parentElement;
      if (!segment || !fill) return;
      segment.dataset.state = segmentView.state;
      fill.style.width = `${segmentView.width}%`;
    });
    elapsedEl.textContent = formatClock(view.elapsedMs);
    const label = view.label;
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
  const fullLog = () =>
    evidenceJson({
      header,
      page: location.origin,
      account,
      wallet,
      runs: log.toJSON(),
      trace: log.traceJSON(),
    });
  const renderEvidence = () => {
    if (evidenceDetails?.open) evidenceEl.textContent = fullLog();
    if (traceDetails?.open) traceEl.textContent = JSON.stringify(log.traceJSON(), null, 2);
  };
  evidenceDetails?.addEventListener('toggle', renderEvidence);
  traceDetails?.addEventListener('toggle', renderEvidence);

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
      { label: 'Spec version', value: String(state.specVersion) },
      { label: 'Activated', value: state.booted ? 'Yes' : 'No' },
      { label: 'Auth nonce', value: state.authNonce.toString() },
      { label: 'Device epoch', value: state.deviceEpoch.toString() },
      {
        label: 'Device entries',
        value: String(state.entryCount),
        hint: 'Entries in the device set, not a device count (erratum 8).',
      },
      { label: 'Binding', value: bindingId },
      ...(accountBalances?.address === address
        ? [
            {
              label: 'NIGHT (Passport ACC)',
              value: accountBalances.night ?? accountBalances.error ?? 'Reading…',
              hint: 'Unshielded balance in smallest units.',
            },
            ...(accountBalances.color === '00'.repeat(32)
              ? []
              : [
                  {
                    label: `Test token ${shorten(accountBalances.color, 6, 4)}`,
                    value: accountBalances.fundedAsset ?? accountBalances.error ?? 'Reading…',
                    hint: 'Unshielded balance in smallest units.',
                  },
                ]),
          ]
        : []),
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

  const renderHoldings = () => {
    const current =
      account && shieldedHoldings?.address === account.address ? shieldedHoldings : undefined;
    const list = byId('holdings-facts');
    const empty = byId('holdings-empty');
    list.hidden = !current || current.coins.length === 0;
    empty.hidden = !!current && current.coins.length > 0;
    if (!current) {
      empty.textContent = 'Open an account, then read its shielded holdings.';
      return;
    }
    if (current.coins.length === 0) {
      empty.textContent = 'No chain-verified shielded coins found.';
      return;
    }
    renderFacts(
      list,
      current.coins.flatMap((coin) => [
        {
          label: `Inbox #${coin.inboxIndex}`,
          value: `${coin.value} smallest units`,
          hint: 'Chain-verified shielded coin.',
        },
        { label: 'Color', value: shorten(coin.color, 8, 6), full: coin.color, copy: coin.color },
      ]),
    );
  };

  const renderRoster = () => {
    const current = account && deviceRoster?.address === account.address ? deviceRoster : undefined;
    const list = byId('roster-facts');
    const empty = byId('roster-empty');
    list.hidden = !current;
    empty.hidden = !!current;
    if (!current) return;
    renderFacts(list, [
      { label: 'Device epoch', value: current.deviceEpoch.toString() },
      { label: 'Auth nonce', value: current.authNonce.toString() },
      { label: 'Live entries', value: String(current.commitments.length) },
      ...current.commitments.map((commitment, index) => ({
        label: `Entry ${index + 1}`,
        value: shorten(commitment, 10, 8),
        full: commitment,
        copy: commitment,
      })),
    ]);
  };

  const renderGrantRoster = () => {
    const current =
      account && grantRoster?.address === account.address ? grantRoster.roster : undefined;
    const list = byId('grant-roster-facts');
    const empty = byId('grant-roster-empty');
    list.hidden = !current;
    empty.hidden = !!current;
    if (!current) return;
    renderFacts(list, [
      { label: 'Generation', value: current.generation.toString() },
      { label: 'Auth nonce', value: current.authNonce.toString() },
      {
        label: 'Active grants',
        value: String(current.entries.filter((entry) => entry.active).length),
      },
      ...current.entries.map((entry, index) => ({
        label: `Grant ${index + 1}`,
        value: `${shorten(entry.id, 10, 8)} · ${entry.active ? 'active' : 'revoked'}${entry.read ? ' · read' : ''}`,
        full: entry.id,
        copy: entry.id,
      })),
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
      if (!entries.some(([token]) => /^0+$/.test(token)))
        facts.push({ label: 'NIGHT (built-in wallet)', value: '0', hint: 'Smallest unit.' });
      for (const [token, amount] of entries) {
        facts.push({
          label: /^0+$/.test(token) ? 'NIGHT (built-in wallet)' : `Token ${shorten(token, 6, 4)}`,
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
    if (wallet.balanceUpdatedAt)
      facts.push({
        label: 'Balances updated',
        value: wallet.balanceUpdatedAt,
        hint: 'Local read time (UTC), not the chain confirmation time. Refresh after receiving funds.',
      });
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
      .writeText(fullLog())
      .then(() => {
        status(
          'Full operation log copied with public request and response fields, and no secrets.',
        );
      })
      .catch(() => status('Copy failed: the browser refused clipboard access.'));
  });
  knownAddress.addEventListener('input', renderButtons);
  grantGrantee.addEventListener('input', renderButtons);
  revokeGrantId.addEventListener('input', renderButtons);
  exportGrantId.addEventListener('input', renderButtons);
  grantOpeningInput.addEventListener('input', renderButtons);
  handoffInput.addEventListener('input', renderButtons);
  removalInput.addEventListener('input', renderButtons);

  renderButtons();
  renderProgress();
  renderAccount();
  renderHoldings();
  renderRoster();
  renderGrantRoster();
  renderWallet();
  renderEvidence();

  return {
    status,
    knownAddress: () => knownAddress.value,
    handoffJson: () => handoffInput.value,
    grantInput: () => ({
      grantee: grantGrantee.value.trim(),
      color: grantAsset.value,
      maxDemoCall: assetsByColor.get(grantAsset.value)?.amount ?? '0',
      recipient: grantRecipient.value.trim(),
      perCallCap: grantPerCall.value.trim(),
      cap: grantCap.value.trim(),
    }),
    revokeGrantId: () => revokeGrantId.value.trim(),
    exportGrantId: () => exportGrantId.value.trim(),
    grantSpendInput: () => ({
      handoff: grantOpeningInput.value,
      amount: grantSpendAmount.value.trim(),
      spentPrev: grantSpentPrev.value.trim(),
    }),
    showGrantSpentTotal(value: bigint) {
      grantSpentPrev.value = value.toString();
    },
    showGrantHandoff(handoff: unknown) {
      const output = byId<HTMLTextAreaElement>('grant-opening-output');
      output.value = JSON.stringify(handoff, null, 2);
      output.hidden = false;
    },
    clearGrantHandoff() {
      const output = byId<HTMLTextAreaElement>('grant-opening-output');
      output.value = '';
      output.hidden = true;
    },
    showGranteePublicKey(publicKey: string) {
      const output = byId<HTMLInputElement>('grantee-output');
      output.value = publicKey;
      output.hidden = false;
    },
    removalCommitment: () => removalInput.value.trim(),
    showHandoff(handoff: { fingerprint: string }) {
      handoffOutput.value = JSON.stringify(handoff, null, 2);
      handoffOutput.hidden = false;
      byId('handoff-empty').hidden = true;
      const value = byId('handoff-fingerprint');
      value.textContent = `Compare this SHA-256 fingerprint on the owner browser: ${handoff.fingerprint}`;
      value.hidden = false;
    },
    showRoster(
      address: string,
      roster: { deviceEpoch: bigint; authNonce: bigint; commitments: readonly string[] },
    ) {
      if (account?.address !== address) return;
      deviceRoster = { address, ...roster };
      renderRoster();
    },
    showGrantRoster(address: string, roster: PassportGrantRoster) {
      if (account?.address !== address) return;
      grantRoster = { address, roster };
      renderGrantRoster();
    },
    /** Ends the running stage and starts `id`. */
    stage: (id: string) => log.stage(id),
    note: (text: string) => log.note(text),
    /** A connector progress event: it moves the bar and the log (event-log.ts). */
    event: (e: PassportEvent) => log.event(e),
    /** Public values to keep with the running step and the evidence. */
    record: (name: string, data: Record<string, unknown> = {}) => log.attach({ [name]: data }),
    /** Add a public-field operation or HTTP request/response to the shareable trace. */
    trace: (entry: OperationTraceEntry) => log.trace(entry),
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
      if (account?.address !== view.address) {
        const output = byId<HTMLTextAreaElement>('grant-opening-output');
        output.value = '';
        output.hidden = true;
      }
      // The last transaction carries over only while the same account stays open.
      const keep = account?.address === view.address ? account.lastTx : undefined;
      const lastTx = view.lastTx ?? keep;
      account = { ...view, ...(lastTx && { lastTx }) };
      // A later account action may spend a coin; require a fresh chain check.
      shieldedHoldings = undefined;
      deviceRoster = undefined;
      grantRoster = undefined;
      if (accountBalances?.address !== view.address)
        accountBalances = fundingAsset
          ? { address: view.address, color: fundingAsset.color }
          : undefined;
      renderAccount();
      renderHoldings();
      renderRoster();
      renderGrantRoster();
      renderButtons();
      renderEvidence();
    },
    showShieldedHoldings(
      address: string,
      coins: readonly { inboxIndex: number; color: string; value: string }[],
    ) {
      if (account?.address !== address) return;
      shieldedHoldings = { address, coins };
      renderHoldings();
      renderEvidence();
    },
    enableFunding(assets: readonly { color: string; amount: string }[]) {
      assetsByColor = new Map(assets.map((asset) => [asset.color, asset]));
      fundingSelect.replaceChildren(
        ...assets.map((asset) => {
          const option = el(
            'option',
            undefined,
            asset.color === '00'.repeat(32)
              ? `NIGHT (${asset.amount} smallest units)`
              : `Test token ${shorten(asset.color, 6, 4)} (${asset.amount} units)`,
          );
          option.value = asset.color;
          return option;
        }),
      );
      withdrawalSelect.replaceChildren(
        ...assets.map((asset) => {
          const option = el(
            'option',
            undefined,
            asset.color === '00'.repeat(32)
              ? 'NIGHT (smallest units)'
              : `Test token ${shorten(asset.color, 6, 4)} (smallest units)`,
          );
          option.value = asset.color;
          return option;
        }),
      );
      grantAsset.replaceChildren(
        ...assets.map((asset) => {
          const option = el(
            'option',
            undefined,
            asset.color === '00'.repeat(32)
              ? 'NIGHT (smallest units)'
              : `Test token ${shorten(asset.color, 6, 4)} (smallest units)`,
          );
          option.value = asset.color;
          return option;
        }),
      );
      fundingAsset = assets.find((asset) => asset.color === '00'.repeat(32)) ?? assets[0];
      if (fundingAsset) fundingSelect.value = fundingAsset.color;
      if (account && accountBalances?.address !== account.address)
        accountBalances = {
          address: account.address,
          color: assets.find((asset) => asset.color !== '00'.repeat(32))?.color ?? '00'.repeat(32),
        };
      byId('fund-desc').textContent =
        'Deposit the selected asset from the demo funding wallet into this account.';
      renderButtons();
    },
    selectedFundingAsset() {
      return assetsByColor.get(fundingSelect.value);
    },
    withdrawalInput() {
      return {
        color: withdrawalSelect.value,
        amount: withdrawalAmount.value,
        recipient: withdrawalRecipient.value,
      };
    },
    showFunding(address: string, color: string, balance: string) {
      accountBalances = {
        address,
        color: accountBalances?.color ?? color,
        ...(color === '00'.repeat(32)
          ? {
              night: balance,
              ...(accountBalances?.fundedAsset && { fundedAsset: accountBalances.fundedAsset }),
            }
          : {
              ...(accountBalances?.night && { night: accountBalances.night }),
              fundedAsset: balance,
            }),
      };
      renderAccount();
      renderEvidence();
    },
    showAccountBalances(address: string, color: string, night: string, fundedAsset: string) {
      if (account?.address !== address) return;
      accountBalances = { address, color, night, fundedAsset };
      renderAccount();
      renderEvidence();
    },
    showAccountBalanceError(address: string) {
      if (account?.address !== address || !accountBalances) return;
      accountBalances = { ...accountBalances, error: 'Unavailable' };
      renderAccount();
    },
    showWallet(view: WalletView) {
      wallet = { ...wallet, ...view };
      renderWallet();
      renderButtons();
      renderEvidence();
    },
    clearWallet() {
      wallet = {};
      renderWallet();
      renderButtons();
      renderEvidence();
    },
  };
}
