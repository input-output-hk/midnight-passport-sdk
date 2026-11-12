import { byId } from './ui-dom.js';
import { createDemoAppState, type DemoActionHost } from './app-model.js';
import { AccountEntryActions } from './app-entry-actions.js';
import { DeviceActions } from './app-devices-actions.js';
import { GrantActions } from './app-grants-actions.js';
import { TransferActions } from './app-transfers-actions.js';
import { WalletActions } from './app-wallet-actions.js';
import { renderSessionState, updateSessionClock } from './session-view.js';
import { observeSessionWithdrawal } from './value-call.js';

import type {
  PassportAccount,
  PassportConnectorDescriptor,
  PassportTxResult,
  PassportEvent,
} from '@input-output-hk/mn-passport-protocol';
import {
  ARM,
  SIGNING_MODE,
  BINDING_ID,
  MANIFEST_SHA256,
  NETWORK_ID,
  ORIGIN,
  RP_ID,
  SERVICE_URL,
  installShim,
  exportDemoGrantOpening,
} from './connector.js';

import { spendDemoSessionGrant } from './grant-holder-demo.js';

import { setOperationTraceSink, tracedFetch, traceOperation } from './operation-trace.js';
import { createUi } from './ui.js';
import { createFundingBalanceReader, fundingReadMessage } from './funding-balances.js';
import { parseFundingDiscovery } from './funding.js';

import { createWalletPresentation } from './wallet/presentation.js';

import { finishDemoConsent, reviewDemoAction } from './consent.js';
import { showDemoCapabilities } from './capabilities.js';
import { createDemoSession } from './session.js';
import { unlockDemoSessionKey } from './session-key.js';
import { sessionCheckpoint } from './session-checkpoint.js';
import { demoOperationGuard } from './operation-guard.js';
import { createMockNameService } from './mock-name-service.js';
import { showDemoNameService, showNameConfigurationError } from './name-service.js';
import { configureMidnames } from './midnames/config.js';
import { demoClaimPreparation } from './midnames/claim-demo-owner.js';
import { showClaimRecovery } from './midnames/claim-recovery-ui.js';
import { createDemoWorkspace } from './workspace.js';
import { ActivityPanel } from './activity-controls.js';
import { installLaceWallet } from './lace-wallet.js';
import {
  routineKeys,
  beginRoutineReview,
  checkRoutineReview,
  finishRoutineReview,
  OWNER_ACTIONS,
  beforeAuthenticatedOperation,
  ensureRoutineReview,
} from './routine-access.js';
import { routeAuthenticatedAccount } from './owner-access.js';
import { transactionReceipts, receiptStorageRequired } from './transaction-receipts.js';
import { completeLocalCleanup } from './local-cleanup.js';
import { createOwnerReview } from './owner-review.js';
import { showSigningMode } from './signing-mode.js';
const appState = createDemoAppState();
const retainedTransactions = transactionReceipts(localStorage, NETWORK_ID, BINDING_ID);

installShim();
const mockPasskey = (navigator.credentials as unknown as { mock?: boolean }).mock === true;
const network = NETWORK_ID;
const injected = () =>
  (window as unknown as { midnight?: { passport?: PassportConnectorDescriptor } }).midnight
    ?.passport;
const apiVersion = injected()?.apiVersion;

// Presentation (buttons, progress, event log, cards, evidence) lives in ui.ts; this file keeps the
// connector calls. `stage` moves the progress bar and the log to the next step of the action.
const workspace = createDemoWorkspace({
  networkId: network,
  bindingId: BINDING_ID,
  serviceUrl: SERVICE_URL,
  manifestSha256: MANIFEST_SHA256,
});
const ui = createUi(
  {
    note:
      ARM === 'jubjub'
        ? 'JubJub preview: the ACC viewing secret is random and sealed to the passkey-derived reader. Rotation checks live devices, holdings and read grants.'
        : 'P-256 preview: the ACC viewing secret is random and sealed to the passkey-derived reader. Rotation checks live devices, holdings and read grants.',
    passkey: mockPasskey
      ? 'MOCK (dev only, software key in localStorage)'
      : 'browser authenticator',
    network,
    serviceUrl: SERVICE_URL,
    pinnedManifestSha256: MANIFEST_SHA256,
    ...(apiVersion !== undefined && { apiVersion }),
  },
  ARM,
  {
    before: async (action) => {
      if (receiptStorageRequired(action)) {
        if (appState.receiptStorageFailed)
          throw Error(
            'Copy Audit before leaving: transaction receipt persistence failed. Restore storage before another key operation.',
          );
        retainedTransactions.assertWritable();
      }
      const routineMinutes = Number(
        (document.getElementById('routine-minutes') as HTMLSelectElement).value,
      );
      const routineUnlocked = beginRoutineReview(
        appState.primaryAccount ?? appState.account,
        action,
      );
      const approved = await reviewDemoAction(action, {
        network,
        arm: ARM,
        account: appState.account?.address,
        target: ui.knownAddress(),
        routineUnlocked,
        ownerUnlocked: !!routineKeys.snapshot().ownerVerified && OWNER_ACTIONS.includes(action),
        routineMinutes,
        check: checkRoutineReview,
      });
      if (approved) {
        checkRoutineReview();
        appState.reviewedRoutineMinutes = routineMinutes;
      }
      if (approved)
        await ensureRoutineReview(
          appState.primaryAccount ?? appState.account,
          action,
          routineUnlocked,
          appState.reviewedRoutineMinutes,
          RP_ID,
          ORIGIN,
        );
      if (
        approved &&
        ['withdraw', 'startSession', 'spendGrant', 'fund'].includes(action) &&
        session.snapshot().status === 'blocked'
      )
        throw new Error(
          'Reconcile the original session transaction before another transfer or session.',
        );
      return approved;
    },
    run: demoOperationGuard(network, BINDING_ID, navigator.locks),
    after: () => {
      finishRoutineReview();
      finishDemoConsent();
      if (appState.receiptStorageFailed)
        ui.status(
          'Transaction receipt storage failed. Local keys are locked. Copy Audit before leaving; restore storage before another key operation.',
        );
    },
  },
);
ActivityPanel(
  workspace.activityRoot,
  ui.activity,
  (id) => workspace.showAudit(id),
  {},
  workspace.operationDetails,
);
if (ARM === 'jubjub') {
  const note = document.getElementById('key-note');
  if (note)
    note.textContent =
      'The ACC viewing secret is random and sealed to the passkey-derived reader. Rotation and device changes require complete live reader and read-grant openings.';
}
const recoveryNote = document.getElementById('key-note');
if (recoveryNote)
  recoveryNote.textContent +=
    ' Keep the original passkey: another enrolled reader cannot recover its grant openings. If an owner operation is interrupted, reconcile its transactions before retrying.';
const { status, stage, record } = ui;
function lockAllLocalKeys() {
  return completeLocalCleanup([() => routineKeys.lock(), () => session.lock()]);
}
const onEvent = (event: PassportEvent) => {
  let receipt: ReturnType<typeof retainedTransactions.observe>;
  let failed = false;
  // Durable receipt capture must be independent of rendering and other observers.
  try {
    receipt = retainedTransactions.observe(event);
  } catch {
    failed = appState.receiptStorageFailed = true;
    completeLocalCleanup([() => routineKeys.lock(), () => session.lock(), finishDemoConsent]);
  }
  try {
    ui.event(event);
  } catch {
    /* The immutable receipt and key cleanup still stand. */
  }
  if (receipt) traceOperation('account.transaction.submitted', { ...receipt });
  if (failed) {
    try {
      ui.note(
        'Transaction receipt storage failed. Copy Audit before leaving; further key operations are blocked.',
      );
    } catch {
      /* Cleanup has already completed independently. */
    }
  }
};

/** Record public receipts before a best-effort indexer refresh can fail or outlive a lease. */
async function refreshAfterReceipt<T>(
  receipt: {
    action: string;
    accountAddress: string;
    txHash?: string;
    txIds?: readonly string[];
    grantId?: string;
  },
  read: () => Promise<T>,
): Promise<T | undefined> {
  record('accountOperationReceipt', receipt);
  traceOperation('account.operation.receipt', receipt);
  const refreshed = await ui.attempt('read', read);
  if (refreshed === undefined)
    status(
      `Transaction receipt retained${receipt.txHash ? ` (${receipt.txHash.slice(0, 12)}…)` : ''}. Live state could not be refreshed. Inspect Audit and refresh the account before another operation; do not resubmit this transaction.`,
    );
  return refreshed;
}

setOperationTraceSink(ui.trace);
try {
  for (const receipt of retainedTransactions.load())
    traceOperation('account.transaction.retained', { ...receipt });
} catch {
  appState.receiptStorageFailed = true;
  ui.note(
    'Stored transaction receipts need inspection. Further key operations are blocked; preserve site data.',
  );
}
installLaceWallet(network, ui.showExternalWalletConnection);
showDemoCapabilities(ARM);
showSigningMode(SIGNING_MODE);
let resetClaimRecovery: (() => void) | undefined;
try {
  const naming = configureMidnames(
    {
      claimSponsor: import.meta.env.VITE_MIDNAMES_CLAIM_SPONSOR,
      registryProfile: import.meta.env.VITE_MIDNAMES_REGISTRY_PROFILE,
      registryAddress: import.meta.env.VITE_MIDNAMES_REGISTRY_ADDRESS,
      namespace: import.meta.env.VITE_MIDNAMES_NAMESPACE,
      networkId: import.meta.env.VITE_MIDNAMES_NETWORK_ID,
      indexerUrl: import.meta.env.VITE_MIDNAMES_INDEXER_URL,
      indexerWsUrl: import.meta.env.VITE_MIDNAMES_INDEXER_WS_URL,
    },
    network,
    BINDING_ID,
    demoClaimPreparation(
      import.meta.env.VITE_MIDNAMES_CLAIM_PREPARATION,
      () => appState.primaryAccount,
    ),
  );
  showDemoNameService(naming ?? createMockNameService(network), network);
  if (naming?.recovery)
    resetClaimRecovery = showClaimRecovery(naming.recovery, () => appState.primaryAccount);
} catch {
  showNameConfigurationError();
}

const walletPresentation = createWalletPresentation({
  network,
  showWallet: ui.showWallet,
  record,
  status,
  trace: traceOperation,
});

const ownerReview = createOwnerReview({
  current: () => appState.account,
  primary: () => appState.primaryAccount,
  authenticated: () => appState.authenticatedAccount,
  ownerSession: (primary) => routineKeys.ownerSession(primary),
  lease: (primary) => routineKeys.lease(primary),
  check: checkRoutineReview,
  confirm: (text) => window.confirm(text),
});

const fundingUrl = new URL('/v1/demo/funding', SERVICE_URL);

const session = createDemoSession({
  checkpoint: sessionCheckpoint(localStorage, network, BINDING_ID),
  unlock: async (account, context) => {
    const key = await unlockDemoSessionKey(account, context);
    appState.sessionUsesRoutine = key.routineBound;
    return key;
  },
  opening: exportDemoGrantOpening,
  spend: spendDemoSessionGrant,
  recoverWithdrawal: (input) => observeSessionWithdrawal(SERVICE_URL, input),
  changed(snapshot) {
    const {
      status: phase,
      account: address,
      grantId,
      expiresAt,
      color,
      recipient,
      perCallCap,
      cap,
      spent,
      txHash,
      intentId,
    } = snapshot;
    if (!['active', 'spending', 'authorizing'].includes(phase)) appState.sessionUsesRoutine = false;
    renderSessionState(snapshot, network);
    const safetyNotice = byId('operation-safety-notice');
    safetyNotice.hidden = phase !== 'blocked';
    safetyNotice.textContent =
      phase === 'blocked'
        ? `A session operation needs reconciliation${intentId ? ` (original intent ${intentId})` : ''}. The local key is locked. Do not retry a transfer; inspect Settings → Quick actions and Audit.`
        : '';
    traceOperation('session.state', {
      phase,
      accountAddress: address,
      grantId,
      expiresAt,
      color,
      recipient,
      perCallCap,
      cap,
      spent,
      txHash,
      intentId,
    });
  },
});
const sessionUse = () => (document.getElementById('session-use') as HTMLInputElement).checked;
const ownerAuthorization = () =>
  appState.authenticatedAccount && routineKeys.snapshot().ownerVerified
    ? 'authenticated JubJub owner after fresh passkey approval'
    : 'fresh owner passkey';
setInterval(() => updateSessionClock(session.snapshot()), 1000);
routineKeys.subscribe((snapshot) => {
  if (snapshot.status !== 'active' || !snapshot.ownerVerified)
    appState.authenticatedAccount = undefined;
  ui.refreshPrompts();
  byId('authenticated-owner-key').textContent =
    snapshot.authority === 'owner' ? (snapshot.publicKey ?? 'Not unlocked') : 'Not unlocked';
  byId('routine-status').textContent =
    snapshot.status === 'active'
      ? snapshot.authority === 'owner'
        ? snapshot.ownerVerified
          ? `Authenticated until ${new Date(snapshot.expiresAt ?? Number.NaN).toLocaleTimeString()}. Routine actions reuse unlocked keys. Critical owner actions require fresh passkey approval before the JubJub signature.`
          : 'Verifying the deterministic JubJub owner. First enrollment may require passkey signatures.'
        : `Unlocked until ${new Date(snapshot.expiresAt ?? Number.NaN).toLocaleTimeString()}. Reading and wallet connection need no new passkey. Transfers require a separate permission.`
      : `Quick actions ${snapshot.status}. Unlock with your account passkey to continue.`;
  byId('routine-summary').textContent =
    snapshot.status === 'active' ? 'Quick actions unlocked' : `Quick actions ${snapshot.status}`;
  if (
    appState.sessionUsesRoutine &&
    snapshot.status !== 'active' &&
    ['active', 'spending', 'authorizing'].includes(session.snapshot().status)
  )
    session.lock();
});
setInterval(() => routineKeys.snapshot(), 1000);
byId('lock-routine').addEventListener('click', () => routineKeys.lock());
window.addEventListener('pagehide', lockAllLocalKeys);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) lockAllLocalKeys();
});

const refreshAccountBalances = createFundingBalanceReader({
  current: () => appState.account,
  color: () => appState.balanceAssetColor,
  url: fundingUrl,
  fetch: tracedFetch,
  state: (state) => {
    const output = document.getElementById('funding-read-status');
    if (output) output.textContent = fundingReadMessage(state);
  },
  show: (view) => {
    ui.enableFunding(view.assets);
    ui.showAccountBalances(view.address, view.color, view.night, view.fundedAsset);
    traceOperation('account.balances', {
      accountAddress: view.address,
      night: view.night,
      color: view.color,
      fundedAsset: view.fundedAsset,
    });
  },
  unavailable: (address) => {
    ui.showFundingUnavailable();
    ui.showAccountBalanceError(address);
  },
});

window.addEventListener('pagehide', () => refreshAccountBalances.stop());
void tracedFetch(fundingUrl.toString())
  .then(async (response) => {
    if (!response.ok) return;
    const data = parseFundingDiscovery(await response.json());
    appState.balanceAssetColor = data.balanceAssetColor;
    ui.enableFunding(data.assets);
    if (appState.account) {
      const address = appState.account.address;
      void refreshAccountBalances(address).catch(() => {
        /* The guarded read renders current failures. */
      });
    }
  })
  .catch(() => {
    // Funding is an optional localnet service; the rest of the demo remains usable.
  });
const connector = async () => {
  const descriptor = injected();
  if (!descriptor) throw new Error('window.midnight.passport is not injected');
  return (appState.api ??= await descriptor.connect(network));
};
const opened = async (a: PassportAccount, how: string, lastTx?: PassportTxResult) => {
  session.lock();
  appState.primaryAccount = a;
  resetClaimRecovery?.();
  appState.authenticatedAccount = undefined;
  appState.account = routeAuthenticatedAccount(
    a,
    () => appState.authenticatedAccount,
    checkRoutineReview,
    beforeAuthenticatedOperation,
  );
  stage('read');
  const state = await a.state();
  record(how, { address: a.address, binding: a.bindingId, state, ...(lastTx && { lastTx }) });
  ui.showAccount({
    address: a.address,
    networkId: a.networkId,
    bindingId: a.bindingId,
    state,
    ...(lastTx && { lastTx }),
  });
  void refreshAccountBalances(a.address).catch(() => {
    traceOperation('account.balances.unavailable', { accountAddress: a.address });
  });
  traceOperation('account.opened', {
    how,
    address: a.address,
    networkId: a.networkId,
    bindingId: a.bindingId,
    authNonce: state.authNonce.toString(),
    entryCount: state.entryCount,
  });
  status(`Account ${a.address.slice(0, 12)}… is ${how}.`);
  workspace.showAccount();
};

if (injected()) {
  status('Ready. Create a Passport account, or open one with your passkey.');
} else {
  ui.setReady(false);
  status('The Passport connector is not injected (window.midnight.passport).');
}

const actionHost: DemoActionHost = {
  state: appState,
  ui,
  network,
  session,
  ownerReview,
  fundingUrl,
  walletPresentation,
  stage,
  record,
  status,
  onEvent,
  connector,
  opened,
  refreshAccountBalances,
  refreshAfterReceipt,
  sessionUse,
  ownerAuthorization,
  lockAllLocalKeys,
};
const entryActions = new AccountEntryActions(actionHost);
const devicesActions = new DeviceActions(actionHost);
const grantsActions = new GrantActions(actionHost);
const transfersActions = new TransferActions(actionHost);
const walletActions = new WalletActions(actionHost);
ui.on('create', entryActions.create);
ui.on('open', entryActions.open);
ui.on('openAt', entryActions.openAt);
ui.on('unlockRoutine', entryActions.unlockRoutine);
ui.on('unlockOwner', entryActions.unlockOwner);
ui.on('refresh', entryActions.refresh);
ui.on('holdings', entryActions.holdings);
ui.on('prepareJoiner', devicesActions.prepareJoiner);
ui.on('roster', devicesActions.roster);
ui.on('grantRoster', grantsActions.grantRoster);
ui.on('prepareGrantee', grantsActions.prepareGrantee);
ui.on('issueGrant', grantsActions.issueGrant);
ui.on('exportGrant', grantsActions.exportGrant);
ui.on('spendGrant', grantsActions.spendGrant);
ui.on('revokeGrant', grantsActions.revokeGrant);
ui.on('recoverGrants', grantsActions.recoverGrants);
ui.on('enrollDevice', devicesActions.enrollDevice);
ui.on('removeDevice', devicesActions.removeDevice);
ui.on('rotate', devicesActions.rotate);
ui.on('fund', transfersActions.fund);
ui.on('startSession', transfersActions.startSession);
ui.on('endSession', transfersActions.endSession);
ui.on('revokeSession', transfersActions.revokeSession);
ui.on('recoverSessionWithdrawal', transfersActions.recoverSessionWithdrawal);
ui.on('withdraw', transfersActions.withdraw);
ui.on('wallet', walletActions.connect);
ui.on('walletRefresh', walletActions.walletRefresh);
