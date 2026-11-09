import { renderSessionState, updateSessionClock } from './session-view.js';
import { PassportConnectorError } from '@input-output-hk/mn-passport-account';
import { fetchServiceConfig } from '@input-output-hk/mn-passport-adapter-service';
import type {
  PassportAccount,
  PassportConnectorAPI,
  PassportConnectorDescriptor,
  PassportTxResult,
  PassportEvent,
} from '@input-output-hk/mn-passport-protocol';
import {
  ARM,
  BINDING_ID,
  MANIFEST_SHA256,
  NETWORK_ID,
  ORIGIN,
  RP_ID,
  SERVICE_URL,
  installShim,
  exportDemoGrantOpening,
  connect as connectAccount,
} from './connector.js';
import { DEPLOY_ESTIMATE_S, EVENT_STAGES, FLOWS, knownAccAddress } from './flows.js';
import { withdrawalRequest } from './withdrawal.js';
import { fixedUnshieldedGrant, fixedUnshieldedGrantLimits } from './grant-input.js';
import { prepareGranteePasskey } from './grantee-passkey.js';
import { spendDemoGrant, spendDemoSessionGrant } from './grant-holder-demo.js';
import { parseGrantHandoff } from './grant-handoff.js';
import { MidnightBech32m, UnshieldedAddress } from '@midnightntwrk/wallet-sdk-address-format';
import { Buffer } from 'buffer';
import { parseDeviceHandoff, prepareDeviceHandoff } from './device-handoff.js';
import { setOperationTraceSink, tracedFetch, traceOperation } from './operation-trace.js';
import { createUi } from './ui.js';
import {
  parseFundingDiscovery,
  fundingRequestFailure,
  fundingExchange,
  fundingUnsettled,
} from './funding.js';
import type { DevWallet } from './wallet/dev-wallet.js';
import { createWalletPresentation } from './wallet/presentation.js';
import { walletSeed } from './wallet/seed.js';
import {
  beforeDemoCeremony,
  finishDemoConsent,
  reviewDemoAction,
  assertExactGrantExport,
} from './consent.js';
import { showDemoCapabilities } from './capabilities.js';
import { createDemoSession } from './session.js';
import { unlockDemoSessionKey } from './session-key.js';
import { sessionCheckpoint } from './session-checkpoint.js';
import { demoOperationGuard } from './operation-guard.js';
import { createMockNameService } from './mock-name-service.js';
import { showDemoNameService } from './name-service.js';
import { createDemoWorkspace } from './workspace.js';
import { ActivityPanel } from './activity-controls.js';
import { installLaceWallet } from './lace-wallet.js';
import {
  routineKeys,
  beginRoutineReview,
  checkRoutineReview,
  finishRoutineReview,
  OWNER_ACTIONS,
  withRoutineLogin,
  beforeAuthenticatedOperation,
  ensureRoutineReview,
} from './routine-access.js';
import { authenticateOwnerAccount, routeAuthenticatedAccount } from './owner-access.js';
import { transactionReceipts, receiptStorageRequired } from './transaction-receipts.js';
import { completeLocalCleanup } from './local-cleanup.js';
import { createOwnerReview } from './owner-review.js';
const retainedTransactions = transactionReceipts(localStorage, NETWORK_ID, BINDING_ID);
let receiptStorageFailed = false;
let reviewedRoutineMinutes = 15;

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
        if (receiptStorageFailed)
          throw Error(
            'Copy Audit before leaving: transaction receipt persistence failed. Restore storage before another key operation.',
          );
        retainedTransactions.assertWritable();
      }
      const routineMinutes = Number(
        (document.getElementById('routine-minutes') as HTMLSelectElement).value,
      );
      const routineUnlocked = beginRoutineReview(primaryAccount ?? account, action);
      const approved = await reviewDemoAction(action, {
        network,
        arm: ARM,
        account: account?.address,
        target: ui.knownAddress(),
        routineUnlocked,
        ownerUnlocked: !!routineKeys.snapshot().ownerVerified && OWNER_ACTIONS.includes(action),
        routineMinutes,
        check: checkRoutineReview,
      });
      if (approved) {
        checkRoutineReview();
        reviewedRoutineMinutes = routineMinutes;
      }
      if (approved)
        await ensureRoutineReview(
          primaryAccount ?? account,
          action,
          routineUnlocked,
          reviewedRoutineMinutes,
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
      if (receiptStorageFailed)
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
    failed = receiptStorageFailed = true;
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
  receiptStorageFailed = true;
  ui.note(
    'Stored transaction receipts need inspection. Further key operations are blocked; preserve site data.',
  );
}
installLaceWallet(network, ui.showExternalWalletConnection);
showDemoCapabilities(ARM);
showDemoNameService(createMockNameService(network), network);

let api: PassportConnectorAPI | undefined;
let devWallet: DevWallet | undefined;
const walletPresentation = createWalletPresentation({
  network,
  showWallet: ui.showWallet,
  record,
  status,
  trace: traceOperation,
});
let account: PassportAccount | undefined;
let primaryAccount: PassportAccount | undefined;
let authenticatedAccount: PassportAccount | undefined;
const ownerReview = createOwnerReview({
  current: () => account,
  primary: () => primaryAccount,
  authenticated: () => authenticatedAccount,
  ownerSession: (primary) => routineKeys.ownerSession(primary),
  lease: (primary) => routineKeys.lease(primary),
  check: checkRoutineReview,
  confirm: (text) => window.confirm(text),
});
let balanceAssetColor: string | undefined;
const fundingUrl = new URL('/v1/demo/funding', SERVICE_URL);
let sessionUsesRoutine = false;
const session = createDemoSession({
  checkpoint: sessionCheckpoint(localStorage, network, BINDING_ID),
  unlock: async (account, context) => {
    const key = await unlockDemoSessionKey(account, context);
    sessionUsesRoutine = key.routineBound;
    return key;
  },
  opening: exportDemoGrantOpening,
  spend: spendDemoSessionGrant,
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
    if (!['active', 'spending', 'authorizing'].includes(phase)) sessionUsesRoutine = false;
    renderSessionState(snapshot, network);
    const safetyNotice = document.getElementById('operation-safety-notice')!;
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
  authenticatedAccount && routineKeys.snapshot().ownerVerified
    ? 'authenticated JubJub owner after fresh passkey approval'
    : 'fresh owner passkey';
setInterval(() => updateSessionClock(session.snapshot()), 1000);
routineKeys.subscribe((snapshot) => {
  if (snapshot.status !== 'active' || !snapshot.ownerVerified) authenticatedAccount = undefined;
  ui.refreshPrompts();
  document.getElementById('authenticated-owner-key')!.textContent =
    snapshot.authority === 'owner' ? snapshot.publicKey! : 'Not unlocked';
  document.getElementById('routine-status')!.textContent =
    snapshot.status === 'active'
      ? snapshot.authority === 'owner'
        ? snapshot.ownerVerified
          ? `Authenticated until ${new Date(snapshot.expiresAt!).toLocaleTimeString()}. Routine actions reuse unlocked keys. Critical owner actions require fresh passkey approval before the JubJub signature.`
          : 'Verifying the deterministic JubJub owner. First enrollment may require passkey signatures.'
        : `Unlocked until ${new Date(snapshot.expiresAt!).toLocaleTimeString()}. Reading and wallet connection need no new passkey. Transfers require a separate permission.`
      : `Quick actions ${snapshot.status}. Unlock with your account passkey to continue.`;
  document.getElementById('routine-summary')!.textContent =
    snapshot.status === 'active' ? 'Quick actions unlocked' : `Quick actions ${snapshot.status}`;
  if (
    sessionUsesRoutine &&
    snapshot.status !== 'active' &&
    ['active', 'spending', 'authorizing'].includes(session.snapshot().status)
  )
    session.lock();
});
setInterval(() => routineKeys.snapshot(), 1000);
document.getElementById('lock-routine')!.addEventListener('click', () => routineKeys.lock());
window.addEventListener('pagehide', lockAllLocalKeys);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) lockAllLocalKeys();
});

async function refreshAccountBalances(
  address: string,
): Promise<{ night: string; fundedAsset: string } | undefined> {
  if (!balanceAssetColor) return;
  const url = new URL(fundingUrl);
  url.searchParams.set('accountAddress', address);
  const response = await tracedFetch(url.toString());
  if (!response.ok) throw new Error('ACC balance read unavailable');
  const body = (await response.json()) as Record<string, unknown>;
  const balances = body.balances as Record<string, unknown> | undefined;
  if (
    body.accountAddress !== address ||
    typeof balances?.night !== 'string' ||
    !/^\d+$/.test(balances.night) ||
    typeof balances.fundedAsset !== 'string' ||
    !/^\d+$/.test(balances.fundedAsset)
  ) {
    throw new Error('ACC balance response is invalid');
  }
  const discovery = parseFundingDiscovery(body);
  ui.enableFunding(discovery.assets);
  ui.showAccountBalances(address, balanceAssetColor, balances.night, balances.fundedAsset);
  traceOperation('account.balances', {
    accountAddress: address,
    night: balances.night,
    color: balanceAssetColor,
    fundedAsset: balances.fundedAsset,
  });
  return { night: balances.night, fundedAsset: balances.fundedAsset };
}
void tracedFetch(fundingUrl.toString())
  .then(async (response) => {
    if (!response.ok) return;
    const data = parseFundingDiscovery(await response.json());
    balanceAssetColor = data.balanceAssetColor;
    ui.enableFunding(data.assets);
    if (account) {
      const address = account.address;
      void refreshAccountBalances(address).catch(() => ui.showAccountBalanceError(address));
    }
  })
  .catch(() => {
    // Funding is an optional localnet service; the rest of the demo remains usable.
  });
const connector = async () => {
  const descriptor = injected();
  if (!descriptor) throw new Error('window.midnight.passport is not injected');
  return (api ??= await descriptor.connect(network));
};
const opened = async (a: PassportAccount, how: string, lastTx?: PassportTxResult) => {
  session.lock();
  primaryAccount = a;
  authenticatedAccount = undefined;
  account = routeAuthenticatedAccount(
    a,
    () => authenticatedAccount,
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
    ui.showAccountBalanceError(a.address);
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

ui.on('create', async () => {
  routineKeys.lock();
  status(
    ARM === 'jubjub'
      ? `Creating a JubJub account… confirm the passkey ceremonies, then wait for deployment (about ${DEPLOY_ESTIMATE_S / 60} minutes).`
      : `Creating… confirm the passkey and its reader key, then wait for deployment (about ${DEPLOY_ESTIMATE_S / 60} minutes) and two sealed-key publications.`,
  );
  const a = await (
    await connector()
  ).createAccount({
    userName: `passport-${Date.now()}`,
    // The prototype has always retired the maintenance authority: irreversible, so the account
    // can never be upgraded. The account API makes that the caller's explicit choice.
    retireAuthority: true,
    onEvent: (e) => {
      onEvent(e);
      const next = e.phase === 'start' ? EVENT_STAGES.create[e.step] : undefined;
      const label = FLOWS.create.stages.find((x) => x.id === next)?.label;
      if (label) status(`Creating: ${label.charAt(0).toLowerCase()}${label.slice(1)}…`);
    },
  });
  await opened(a, 'created');
});
ui.on('open', async () => {
  status('Opening… choose your passkey once to open the account and enable routine access.');
  await withRoutineLogin(reviewedRoutineMinutes, async () =>
    opened(await (await connector()).openAccount({ onEvent }), 'reopened'),
  );
});
ui.on('openAt', async () => {
  const requestedAddress = knownAccAddress(ui.knownAddress());
  traceOperation('account.openByAddress.requested', { accountAddress: requestedAddress });
  status('Opening the known ACC… choose an enrolled passkey once.');
  await withRoutineLogin(reviewedRoutineMinutes, async () => {
    const accountApi = await connector();
    if (!accountApi.openAccountAt)
      throw new Error('This Passport connector cannot open by address.');
    const restored = await accountApi.openAccountAt(requestedAddress, { onEvent });
    if (restored.address !== requestedAddress)
      throw new Error('The connector returned a different ACC address.');
    await opened(restored, 'opened by address');
    traceOperation('account.openByAddress.verified', { accountAddress: restored.address });
  });
});
ui.on('unlockRoutine', async () => {
  if (!account) throw new Error('Open a Passport account first.');
  await routineKeys.unlock(account, reviewedRoutineMinutes, RP_ID, ORIGIN);
  status(
    'Quick actions unlocked. A PRF-derived JubJub key is ready; transfers still need a separate scoped permission.',
  );
  traceOperation('routine.unlocked', {
    accountAddress: account.address,
    expiresAt: routineKeys.snapshot().expiresAt,
    publicKey: routineKeys.snapshot().publicKey,
  });
});
ui.on('unlockOwner', async () => {
  const primary = primaryAccount;
  if (!primary) throw new Error('Open a Passport account first.');
  try {
    await routineKeys.unlock(primary, reviewedRoutineMinutes, RP_ID, ORIGIN, true);
    const owner = routineKeys.ownerSession(primary)!;
    stage('verify');
    const api = await connectAccount(network, owner);
    const authenticated = await authenticateOwnerAccount({
      primary,
      owner,
      storage: localStorage,
      options: { onEvent },
      open: () => api.openAccountAt!(primary.address, { onEvent }),
      confirm: async (publicKey, readerPublicKey) =>
        window.confirm(
          `Enable this deterministic JubJub key as a FULL owner of your Passport account?\n\nAccount: ${primary.address}\nOwner key: ${publicKey}\nReader key: ${readerPublicKey}\n\nIt can transfer assets, change devices, rotate keys, and issue or revoke permissions, just like your passkey. Local timeout only clears this browser's key. The on-chain owner remains until removed. Code with page-memory access could copy this key and bypass this app’s fresh-approval policy. This first enrollment needs passkey signatures.`,
        ),
      trace: traceOperation,
    });
    owner.check();
    authenticatedAccount = authenticated;
    routineKeys.verifyOwner(primary);
    record('authenticatedOwner', {
      accountAddress: primary.address,
      publicKey: owner.publicKey,
      readerPublicKey: owner.readerPublicKey,
      expiresAt: routineKeys.snapshot().expiresAt,
    });
    status(
      'Account unlocked. Routine actions reuse keys; critical operations require fresh passkey approval before using the JubJub owner.',
    );
  } catch (error) {
    routineKeys.lock();
    throw error;
  }
});
ui.on('refresh', async () => {
  if (!account) throw new Error('Open a Passport account before refreshing it.');
  const current = account;
  const state = await current.state();
  ui.showAccount({
    address: current.address,
    networkId: current.networkId,
    bindingId: current.bindingId,
    state,
  });
  record('refreshed', { accountAddress: current.address, state });
  traceOperation('account.state.refreshed', {
    accountAddress: current.address,
    authNonce: state.authNonce.toString(),
    deviceEpoch: state.deviceEpoch.toString(),
    entryCount: state.entryCount,
    specVersion: state.specVersion,
  });
  const balancesRead = balanceAssetColor
    ? await ui.attempt('balances', async () => {
        try {
          await refreshAccountBalances(current.address);
          return true;
        } catch (error) {
          ui.showAccountBalanceError(current.address);
          throw error;
        }
      })
    : undefined;
  status(
    balanceAssetColor && !balancesRead
      ? `ACC ${current.address.slice(0, 12)}… state refreshed; balances unavailable (see event log).`
      : `ACC ${current.address.slice(0, 12)}… state refreshed from the chain.`,
  );
});
ui.on('holdings', async () => {
  checkRoutineReview();
  if (!account?.readShieldedHoldings)
    throw new Error('Open a sealed Passport account before reading its shielded holdings.');
  const current = account;
  const read = current.readShieldedHoldings;
  if (!read) throw new Error('This Passport account cannot read shielded holdings.');
  status('Opening the sealed ACC inbox and checking coin commitments against the chain…');
  stage('verify');
  const verified = await read({ onEvent });
  checkRoutineReview();
  const coins = verified.map((holding) => ({
    inboxIndex: holding.inboxIndex,
    color: Array.from(holding.coin.color, (byte) => byte.toString(16).padStart(2, '0')).join(''),
    value: holding.coin.value.toString(),
  }));
  ui.showShieldedHoldings(current.address, coins);
  record('shieldedHoldings', { accountAddress: current.address, coins });
  traceOperation('account.shieldedHoldings.verified', {
    accountAddress: current.address,
    count: coins.length,
    coins,
  });
  status(
    `Verified ${coins.length} shielded ${coins.length === 1 ? 'coin' : 'coins'} held by ACC ${current.address.slice(0, 12)}….`,
  );
});
ui.on('prepareJoiner', async () => {
  const address = knownAccAddress(ui.knownAddress());
  stage('passkey');
  const handoff = await prepareDeviceHandoff(address, network, ARM, {
    bindingId: BINDING_ID,
    rpId: RP_ID,
    origin: ORIGIN,
    beforeCeremony: beforeDemoCeremony,
  });
  ui.showHandoff(handoff);
  record('joiningDevicePublicHandoff', {
    accountAddress: address,
    scheme: handoff.scheme,
    fingerprint: handoff.fingerprint,
    readerPublicKey: handoff.readerPublicKey,
    devicePublicKey: handoff.devicePublicKey,
  });
  status('Public handoff ready. Copy the JSON to the owner browser and compare its fingerprint.');
});
ui.on('roster', async () => {
  const current = account;
  const readRoster = current?.deviceRoster;
  if (!current || !readRoster) throw new Error('Open an ACC before reading its device roster.');
  const roster = await readRoster();
  ui.showRoster(current.address, roster);
  record('deviceRoster', {
    accountAddress: current.address,
    epoch: roster.deviceEpoch.toString(),
    authNonce: roster.authNonce.toString(),
    commitments: roster.commitments,
  });
  status(
    `Read ${roster.commitments.length} live ACC device entries at epoch ${roster.deviceEpoch}.`,
  );
});
ui.on('grantRoster', async () => {
  const current = account;
  if (!current?.grantRoster) throw new Error('Open an ACC with a live grant source first.');
  const roster = await current.grantRoster();
  ui.showGrantRoster(current.address, roster);
  const publicRoster = {
    accountAddress: current.address,
    authNonce: roster.authNonce.toString(),
    generation: roster.generation.toString(),
    entries: roster.entries,
  };
  record('grantRoster', publicRoster);
  traceOperation('account.grants.roster', publicRoster);
  status(
    `Read ${roster.entries.filter((entry) => entry.active).length} active grants from the ACC.`,
  );
});
ui.on('prepareGrantee', async () => {
  const target = knownAccAddress(ui.knownAddress());
  stage('passkey');
  status('Creating a separate grant-holder passkey and deriving its public JubJub key…');
  const publicKey = await prepareGranteePasskey({
    rpId: RP_ID,
    origin: ORIGIN,
    beforeCeremony: beforeDemoCeremony,
  });
  ui.showGranteePublicKey(publicKey);
  record('granteePublicKey', { accountAddress: target, publicKey });
  traceOperation('grant.holder.prepared', { accountAddress: target, publicKey });
  status('Public grantee key ready. Copy it to the ACC owner browser for the scoped grant.');
});
ui.on('issueGrant', async () => {
  const current = account;
  if (!current?.issueGrant || !current.grantRoster)
    throw new Error('Open a supported Passport account before issuing a grant.');
  const input = ui.grantInput();
  const scope = fixedUnshieldedGrant(network, input);
  stage('review');
  const before = await current.grantRoster();
  ui.showGrantRoster(current.address, before);
  const approved = window.confirm(
    `Issue a scoped ACC withdrawal grant?\n\nACC: ${current.address}\nNetwork: ${network}\n` +
      `Grantee JubJub key: ${scope.grantee.publicKey}\nAsset color: ${scope.color}\n` +
      `Fixed recipient: ${input.recipient}\nPer-call cap: ${scope.perCallCap}\n` +
      `Total cap: ${scope.cap}\nExpiry: none\n\nThe grant can move ACC funds to this recipient until revoked.`,
  );
  if (!approved) {
    status('Grant issue cancelled before signing.');
    traceOperation('grant.issue.cancelled', { accountAddress: current.address });
    return;
  }
  stage('submit');
  const result = await current.issueGrant(scope, { onEvent });
  const after = await refreshAfterReceipt(
    {
      action: 'issueGrant',
      accountAddress: current.address,
      txHash: result.txHash,
      grantId: result.grantId,
    },
    () => current.grantRoster!(),
  );
  if (!after) return;
  if (!after.entries.some((entry) => entry.id === result.grantId && entry.active))
    throw new Error('The issued grant is not active in the live roster.');
  ui.showGrantRoster(current.address, after);
  const publicResult = {
    accountAddress: current.address,
    grantId: result.grantId,
    slot: result.slot,
    scopeDigest: result.scopeDigest,
    txHash: result.txHash,
    generation: after.generation.toString(),
    granteePublicKey: scope.grantee.publicKey,
    color: scope.color,
    recipient: scope.recipient,
    perCallCap: scope.perCallCap,
    cap: scope.cap,
  };
  record('grantIssued', publicResult);
  traceOperation('account.grants.issued', publicResult);
  status(`Grant ${result.grantId.slice(0, 12)}… is active for the fixed recipient.`);
});
ui.on('exportGrant', async () => {
  const current = account;
  if (!current?.grantRoster) throw new Error('Open the owner ACC before exporting a grant.');
  const grantId = ui.exportGrantId();
  if (!/^[0-9a-f]{64}$/.test(grantId)) throw new Error('Enter a valid grant ID.');
  stage('review');
  const roster = await current.grantRoster();
  if (!roster.entries.some((entry) => entry.id === grantId && entry.active))
    throw new Error('The grant is not active in the live ACC.');
  ownerReview.stageGrantExportReview(current, grantId);
  stage('export');
  const handoff = await exportDemoGrantOpening(current.address, grantId);
  checkRoutineReview();
  assertExactGrantExport(handoff.account, handoff.grantId);
  if (handoff.networkId !== network || handoff.bindingId !== BINDING_ID)
    throw new Error('The exported grant belongs to another network or binding.');
  ui.showGrantHandoff(handoff);
  record('grantOpeningExported', { accountAddress: current.address, grantId });
  traceOperation('account.grants.openingExported', { accountAddress: current.address, grantId });
  status('Opening ready. Transfer its JSON directly to the named grantee browser.');
});
ui.on('spendGrant', async () => {
  const input = ui.grantSpendInput();
  const handoff = parseGrantHandoff(input.handoff, network);
  stage('read');
  status('Checking the live ACC grant and selected grantee passkey…');
  const result = await spendDemoGrant(
    input.handoff,
    network,
    input.amount,
    input.spentPrev,
    async (fields) => {
      stage('review');
      const address = MidnightBech32m.encode(
        network,
        new UnshieldedAddress(Buffer.from(fields.recipient, 'hex')),
      ).asString();
      const approved = window.confirm(
        `Spend this scoped grant?\n\nACC: ${fields.account}\nGrant: ${fields.grantId}\n` +
          `Asset color: ${fields.color}\nAmount: ${fields.amount} smallest units\n` +
          `Remaining cap: ${fields.remainingCap}\nFixed recipient: ${address}\n\n` +
          'Approve this exact transfer before signing and submission.',
      );
      if (approved) stage('submit');
      else
        traceOperation('grant.spend.cancelled', {
          accountAddress: fields.account,
          grantId: fields.grantId,
        });
      return approved;
    },
  );
  ui.showGrantSpentTotal(result.spentTotal);
  const publicResult = {
    accountAddress: handoff.account,
    grantId: result.grantId,
    color: handoff.color,
    amount: input.amount,
    recipient: handoff.recipient,
    spentTotal: result.spentTotal.toString(),
    grantNonce: result.grantNonce.toString(),
    txHash: result.txHash,
  };
  record('grantSpent', publicResult);
  traceOperation('grant.holder.spent', publicResult);
  status(`Grant spend ${result.txHash.slice(0, 12)}… confirmed on the ACC.`);
});
ui.on('revokeGrant', async () => {
  const current = account;
  if (!current?.revokeGrant || !current.grantRoster)
    throw new Error('Open a supported Passport account before revoking a grant.');
  const grantId = ui.revokeGrantId();
  if (!/^[0-9a-f]{64}$/.test(grantId)) throw new Error('Enter a valid grant ID.');
  stage('review');
  const before = await current.grantRoster();
  if (!before.entries.some((entry) => entry.id === grantId && entry.active))
    throw new Error('This grant is not active in the live ACC.');
  ui.showGrantRoster(current.address, before);
  const approved = window.confirm(
    `Revoke this ACC grant?\n\nACC: ${current.address}\nNetwork: ${network}\n` +
      `Grant ID: ${grantId}\nGeneration: ${before.generation}\n\nConfirm before signing.`,
  );
  if (!approved) {
    status('Grant revocation cancelled before signing.');
    traceOperation('grant.revoke.cancelled', { accountAddress: current.address, grantId });
    return;
  }
  stage('submit');
  const result = await current.revokeGrant(grantId, { onEvent });
  const after = await refreshAfterReceipt(
    { action: 'revokeGrant', accountAddress: current.address, txHash: result.txHash, grantId },
    () => current.grantRoster!(),
  );
  if (!after) return;
  if (!after.entries.some((entry) => entry.id === grantId && !entry.active))
    throw new Error('The grant revocation did not appear in the live roster.');
  ui.showGrantRoster(current.address, after);
  ui.clearGrantHandoff();
  const publicResult = {
    accountAddress: current.address,
    grantId,
    txHash: result.txHash,
    status: result.status,
    generation: after.generation.toString(),
  };
  record('grantRevoked', publicResult);
  traceOperation('account.grants.revoked', publicResult);
  status(`Grant ${grantId.slice(0, 12)}… is revoked on chain.`);
});
ui.on('recoverGrants', async () => {
  const current = account;
  if (!current?.recoverPendingGrants || !current.grantRoster)
    throw new Error('Open a supported Passport account before recovering grants.');
  stage('recover');
  status('Checking staged openings against the live ACC and resuming publication…');
  const result = await current.recoverPendingGrants({ onEvent });
  const roster = await refreshAfterReceipt(
    {
      action: 'recoverGrants',
      accountAddress: current.address,
      txIds: result.published.flatMap((grant) => grant.appendTxHashes),
    },
    () => current.grantRoster!(),
  );
  if (!roster) return;
  ui.showGrantRoster(current.address, roster);
  const publicResult = {
    accountAddress: current.address,
    published: result.published.map((grant) => ({
      grantId: grant.grantId,
      status: grant.status,
      appendTxHashes: grant.appendTxHashes,
      nextUseCounter: grant.nextUseCounter.toString(),
    })),
    unsettledGrantIds: result.unsettledGrantIds,
    generation: roster.generation.toString(),
  };
  record('grantRecovery', publicResult);
  traceOperation('account.grants.recovered', publicResult);
  status(
    `Published ${result.published.length} pending grants; ${result.unsettledGrantIds.length} remain unsettled.`,
  );
});
ui.on('enrollDevice', async () => {
  const current = account;
  const readRoster = current?.deviceRoster;
  const addDevice = current?.addDevice;
  if (!current || !readRoster || !addDevice)
    throw new Error('Open a sealed ACC before enrolling a device.');
  stage('review');
  const { handoff, reader } = await parseDeviceHandoff(ui.handoffJson(), {
    accountAddress: current.address,
    networkId: network,
    arm: ARM,
    bindingId: BINDING_ID,
    rpId: RP_ID,
    origin: ORIGIN,
  });
  const [before, state] = await Promise.all([readRoster(), current.state()]);
  if (before.deviceEpoch !== state.deviceEpoch || before.authNonce !== state.authNonce)
    throw new Error('The ACC roster changed while preparing enrollment. Refresh and review again.');
  ui.showRoster(current.address, before);
  const approved = window.confirm(
    `Enroll a second ${ARM === 'p256' ? 'P-256' : 'JubJub'} device for ACC ${current.address}?\n\n` +
      `Network: ${network}\nEpoch: ${before.deviceEpoch}\nLive entries: ${before.commitments.length}\n` +
      `Joiner fingerprint: ${handoff.fingerprint}\n\n` +
      'Compare the fingerprint with the joining browser before consenting.',
  );
  if (!approved) {
    traceOperation('account.device.enrollmentCancelled', { accountAddress: current.address });
    throw new Error('Device enrollment was cancelled before signing.');
  }
  stage('submit');
  const enrolled = await addDevice(reader, { onEvent });
  const refreshed = await refreshAfterReceipt(
    { action: 'enrollDevice', accountAddress: current.address, txHash: enrolled.txHash },
    () => Promise.all([readRoster(), current.state()]),
  );
  if (!refreshed) return;
  const [after, nextState] = refreshed;
  if (!after.commitments.includes(enrolled.commitmentHex))
    throw new Error('The joining device entry is absent from the confirmed ACC roster.');
  ui.showAccount({
    address: current.address,
    networkId: current.networkId,
    bindingId: current.bindingId,
    state: nextState,
    lastTx: enrolled,
  });
  ui.showRoster(current.address, after);
  record('deviceEnrolled', {
    accountAddress: current.address,
    fingerprint: handoff.fingerprint,
    commitment: enrolled.commitmentHex,
    txHash: enrolled.txHash,
    deviceEpoch: after.deviceEpoch.toString(),
    liveEntries: after.commitments.length,
  });
  traceOperation('account.device.enrolled', {
    accountAddress: current.address,
    fingerprint: handoff.fingerprint,
    commitment: enrolled.commitmentHex,
    txHash: enrolled.txHash,
  });
  status('Joining device confirmed in the ACC roster. Open by ACC address on that browser.');
});
ui.on('removeDevice', async () => {
  const current = account;
  if (!current?.deviceRoster || !current.removeDevice)
    throw new Error('Open a sealed Passport account before removing a device.');
  const target = ui.removalCommitment();
  if (!/^[0-9a-f]{64}$/.test(target))
    throw new Error('Enter one full lowercase commitment from the live device roster.');
  stage('review');
  const [before, state] = await Promise.all([current.deviceRoster(), current.state()]);
  if (before.authNonce !== state.authNonce || before.deviceEpoch !== state.deviceEpoch)
    throw new Error('The device roster changed. Refresh and review it again.');
  ui.showRoster(current.address, before);
  if (before.commitments.length < 2) throw new Error('The ACC has no second device to remove.');
  if (!before.commitments.includes(target))
    throw new Error('That commitment is absent from the live ACC device roster.');
  const approved = window.confirm(
    `Remove this device entry from Passport ACC?\n\nNetwork: ${network}\nACC: ${current.address}\n` +
      `Device commitment: ${target}\nDevice epoch: ${before.deviceEpoch}\n` +
      `Live entries: ${before.commitments.length}\n\n` +
      'The SDK rotates the viewing and roster keys and removes this one entry. This does not guarantee full revocation of a compromised key: another entry may still authorise calls. Previously learned data stays known. Confirm the full commitment against the live roster.',
  );
  if (!approved) {
    status('Device removal cancelled before signing.');
    traceOperation('account.device.removalCancelled', { accountAddress: current.address, target });
    return;
  }
  stage('submit');
  status(
    'Rotating sealed keys and removing the selected device; this takes multiple transactions…',
  );
  const removed = await current.removeDevice(target, { onEvent });
  const refreshed = await refreshAfterReceipt(
    {
      action: 'removeDevice',
      accountAddress: current.address,
      txHash: removed.txHash,
      txIds: [removed.rotationTxHash, removed.txHash],
    },
    () => Promise.all([current.deviceRoster!(), current.state()]),
  );
  if (!refreshed) return;
  const [after, nextState] = refreshed;
  if (
    after.commitments.includes(target) ||
    after.commitments.length !== before.commitments.length - 1
  )
    throw new Error('The selected device was not removed from the confirmed ACC roster.');
  ui.showAccount({
    address: current.address,
    networkId: current.networkId,
    bindingId: current.bindingId,
    state: nextState,
    lastTx: removed,
  });
  ui.showRoster(current.address, after);
  const result = {
    accountAddress: current.address,
    removedCommitment: target,
    removalScope: 'entry',
    rotationTxHash: removed.rotationTxHash,
    removalTxHash: removed.txHash,
    deviceEpoch: after.deviceEpoch.toString(),
    liveEntries: after.commitments.length,
  };
  record('deviceRemoved', result);
  traceOperation('account.device.removed', result);
  status(
    'The selected entry is absent from the live ACC roster. This confirms entry removal, not complete compromised-key revocation.',
  );
});
ui.on('rotate', async () => {
  const current = account;
  if (
    !current?.rotateViewingKey ||
    !current.deviceRoster ||
    !current.grantRoster ||
    !current.readShieldedHoldings
  )
    throw new Error('Open a sealed Passport account with complete chain-backed sources first.');
  stage('review');
  const [before, devices, grants, holdings] = await Promise.all([
    current.state(),
    current.deviceRoster(),
    current.grantRoster(),
    current.readShieldedHoldings({ onEvent }),
  ]);
  if (before.authNonce !== devices.authNonce || before.authNonce !== grants.authNonce)
    throw new Error('The ACC changed while its readers were reviewed. Refresh and try again.');
  const activeReadGrants = grants.entries.filter((entry) => entry.active && entry.read).length;
  const approved = window.confirm(
    `Rotate this Passport ACC's viewing secret?\n\nNetwork: ${network}\nACC: ${current.address}\n` +
      `Live devices: ${devices.commitments.length}\nShielded holdings: ${holdings.length}\n` +
      `Active read grants: ${activeReadGrants}\n\n` +
      'Every live device, holding and read grantee must receive a fresh seal. The SDK refuses an incomplete roster before changing the ACC.',
  );
  if (!approved) {
    status('Viewing-key rotation cancelled before signing.');
    traceOperation('account.viewingKey.rotationCancelled', { accountAddress: current.address });
    return;
  }
  stage('submit');
  status('Sealing a new viewing secret to verified readers, then signing and confirming rotation…');
  const rotated = await current.rotateViewingKey({ onEvent });
  const after = await refreshAfterReceipt(
    { action: 'rotate', accountAddress: current.address, txHash: rotated.txHash },
    () => current.state(),
  );
  if (!after) return;
  if (rotated.droppedDeviceEntries.length || rotated.unsealedGrantIds.length)
    throw new Error('Rotation reported an incomplete reader delivery; inspect the event log.');
  if (after.authNonce <= before.authNonce)
    throw new Error('The ACC did not confirm a newer authorisation nonce.');
  ui.showAccount({
    address: current.address,
    networkId: current.networkId,
    bindingId: current.bindingId,
    state: after,
    lastTx: rotated,
  });
  const result = {
    accountAddress: current.address,
    txHash: rotated.txHash,
    authNonceBefore: before.authNonce.toString(),
    authNonceAfter: after.authNonce.toString(),
    deviceCount: devices.commitments.length,
    holdingCount: holdings.length,
    activeReadGrants,
    sealedReadGrants: rotated.sealedReadGrants.map(({ grantId }) => grantId),
  };
  record('viewingKeyRotated', result);
  traceOperation('account.viewingKey.rotated', result);
  status('The ACC confirmed its new sealed viewing secret.');
});
ui.on('fund', async () => {
  if (!account || !ui.selectedFundingAsset())
    throw new Error('Open a Passport account before funding it.');
  const target = account.address;
  const asset = ui.selectedFundingAsset()!;
  const key = `passport-demo:fund:${network}:${target}:${asset.color}`;
  const legacyKey = `passport-demo:fund:${network}:${target}`;
  let requestId = localStorage.getItem(key);
  if (!requestId && asset.color !== '00'.repeat(32)) {
    requestId = localStorage.getItem(legacyKey);
    if (requestId) localStorage.setItem(key, requestId);
  }
  if (!requestId) {
    requestId = crypto.randomUUID();
    localStorage.setItem(key, requestId);
  }
  stage('deposit');
  traceOperation('funding.intent', {
    requestId,
    accountAddress: target,
    networkId: network,
    color: asset.color,
    amount: asset.amount,
  });
  status(
    `Funding account ${target.slice(0, 12)}… with ${asset.amount} ${asset.color === '00'.repeat(32) ? 'NIGHT' : 'test units'}…`,
  );
  const { response, result } = await fundingExchange(() =>
    tracedFetch(fundingUrl.toString(), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ accountAddress: target, requestId, color: asset.color }),
    }),
  );
  if (!response.ok) {
    throw fundingRequestFailure({
      status: response.status,
      result,
      requestId,
      storage: localStorage,
      keys: [key, legacyKey],
      onNotStarted: (details) => traceOperation('funding.notStarted', details),
    });
  }
  if (
    result.requestId !== requestId ||
    result.accountAddress !== target ||
    result.color !== asset.color ||
    result.amount !== asset.amount ||
    typeof result.txId !== 'string' ||
    !/^(?:[0-9a-f]{64}|[0-9a-f]{66})$/.test(result.txId) ||
    (result.preparationTxId !== undefined &&
      (typeof result.preparationTxId !== 'string' ||
        !/^(?:[0-9a-f]{64}|[0-9a-f]{66})$/.test(result.preparationTxId))) ||
    typeof result.creditedBalance !== 'string' ||
    !/^\d+$/.test(result.creditedBalance)
  ) {
    throw fundingUnsettled('Funding service returned an invalid confirmation');
  }
  record('funding', {
    requestId,
    accountAddress: target,
    color: asset.color,
    amount: asset.amount,
    txId: result.txId,
    ...(result.preparationTxId && { preparationTxId: result.preparationTxId }),
    creditedBalance: result.creditedBalance,
  });
  ui.showFunding(target, asset.color, result.creditedBalance);
  void refreshAccountBalances(target).catch(() => {
    ui.showAccountBalanceError(target);
    traceOperation('account.balances.unavailable', { accountAddress: target });
  });
  traceOperation('funding.confirmed', {
    requestId,
    accountAddress: target,
    color: asset.color,
    amount: asset.amount,
    txId: result.txId,
    ...(result.preparationTxId && { preparationTxId: result.preparationTxId }),
    creditedBalance: result.creditedBalance,
  });
  localStorage.removeItem(key);
  if (asset.color !== '00'.repeat(32)) localStorage.removeItem(legacyKey);
  status(
    `Passport account balance: ${result.creditedBalance} ${asset.color === '00'.repeat(32) ? 'NIGHT smallest units' : 'test token units'}. Transaction ${result.txId.slice(0, 12)}…`,
  );
});
ui.on('startSession', async () => {
  const current = account;
  if (!current?.credentialId) throw new Error('Open your passkey-backed ACC first.');
  const input = ui.withdrawalInput();
  const minutes = Number((document.getElementById('session-minutes') as HTMLSelectElement).value);
  // Validate asset, recipient and limits before any credential access.
  const scope = fixedUnshieldedGrantLimits(network, {
    ...input,
    perCallCap: (document.getElementById('session-per-call') as HTMLInputElement).value,
    cap: (document.getElementById('session-cap') as HTMLInputElement).value,
    maxDemoCall: ui.withdrawalCallLimit(),
  });
  if (!Number.isInteger(minutes) || minutes < 10 || minutes > 30)
    throw new Error('Choose 10–30 minutes.');
  if (
    !window.confirm(
      `Authorize a scoped JubJub session?\n\nACC: ${current.address}\nNetwork: ${network}\nAsset: ${scope.color}\nRecipient: ${input.recipient}\nPer transfer: ${scope.perCallCap}\nTotal cap: ${scope.cap} smallest units\nAbsolute lifetime: ${minutes} minutes from authorization start (including proving).\n\nGrant issuer: ${ownerAuthorization()}. Unlock the separate scoped signer if needed, then approve issuing this grant. No owner or read authority is delegated. A copied key may spend until chain expiry or confirmed revocation.`,
    )
  ) {
    status('Session authorization declined before passkey access.');
    traceOperation('session.authorize.cancelled', { accountAddress: current.address });
    return;
  }
  await session.start(current, scope, minutes, RP_ID, { onEvent });
  status(
    'JubJub session active. Matching withdrawals need transfer consent, with no new passkey prompt.',
  );
});
ui.on('endSession', async () => {
  const complete = lockAllLocalKeys();
  if (!complete)
    ui.note(
      'Local key cleanup ran, but its checkpoint or presentation failed. Preserve Audit before leaving.',
    );
  status(
    'Local session locked. Its on-chain grant is not revoked; already-submitted effects still require reconciliation.',
  );
});
ui.on('revokeSession', async () => {
  if (!account) throw new Error('Open the issuing ACC first.');
  const snapshot = session.snapshot();
  if (
    !window.confirm(
      `Revoke session grant ${snapshot.grantId ?? '(unknown; reconcile the original issue)'} for ACC ${account.address}?\n\nAuthorization: ${ownerAuthorization()}. This does not undo transfers.`,
    )
  ) {
    status('Session grant revocation cancelled before signing.');
    traceOperation('session.revoke.cancelled', {
      accountAddress: account.address,
      grantId: snapshot.grantId,
    });
    return;
  }
  const result = await session.revoke(account, { onEvent });
  record('sessionRevoked', { grantId: snapshot.grantId, txHash: result.txHash });
  status('Session grant revoked on chain. Authorize a new session to renew.');
});
ui.on('withdraw', async () => {
  if (!account?.withdrawUnshielded || !balanceAssetColor)
    throw new Error('Open a supported Passport account and enable localnet balances first.');
  const current = account;
  const withdrawUnshielded = current.withdrawUnshielded;
  if (!withdrawUnshielded) throw new Error('This Passport account cannot withdraw assets.');
  const input = ui.withdrawalInput();
  stage('balance');
  status('Reading the live ACC balance before withdrawal…');
  const balances = await refreshAccountBalances(current.address);
  if (!balances) throw new Error('Fresh ACC balances are unavailable.');
  const freshBalance =
    input.color === '00'.repeat(32)
      ? balances.night
      : input.color === balanceAssetColor
        ? balances.fundedAsset
        : undefined;
  if (freshBalance === undefined) throw new Error('The selected asset has no verified balance.');
  const transfer = withdrawalRequest(
    network,
    input.color,
    input.amount,
    input.recipient,
    freshBalance,
  );
  stage('review');
  traceOperation('withdrawal.intent', {
    accountAddress: current.address,
    networkId: network,
    color: transfer.color,
    amount: transfer.amount,
    recipient: input.recipient.trim(),
    recipientHex: transfer.recipient,
    freshBalance,
  });
  if (session.snapshot().status === 'blocked')
    throw new Error(
      'Reconcile the original session transaction and revoke its grant before another withdrawal. No owner fallback is allowed.',
    );
  const useSession = sessionUse() && session.matches(current, transfer);
  const route = useSession ? 'scoped JubJub session (no passkey prompt)' : ownerAuthorization();
  const review = {
    ...transfer,
    recipientAddress: input.recipient.trim(),
    balance: freshBalance,
    outsideSession: sessionUse() && !useSession,
  };
  if (useSession) {
    if (!ownerReview.reviewScopedWithdrawal(current, review)) {
      status('Withdrawal cancelled before signing.');
      traceOperation('withdrawal.cancelled', { accountAddress: current.address });
      return;
    }
  } else ownerReview.stageOwnerWithdrawalReview(current, review);
  stage('submit');
  status(
    useSession
      ? 'Signing the scoped withdrawal with the active JubJub session…'
      : `Signing with ${route}; proving and submission may take time…`,
  );
  // A failed/unknown session spend never falls back to an owner send.
  const result = useSession
    ? { ...(await session.spend(current, transfer)), nextUseCounter: undefined }
    : await withdrawUnshielded(transfer, { onEvent });
  record('withdrawal', {
    accountAddress: current.address,
    networkId: network,
    ...transfer,
    recipientAddress: input.recipient.trim(),
    balanceBefore: freshBalance,
    txHash: result.txHash,
    nextUseCounter: result.nextUseCounter,
  });
  traceOperation('withdrawal.confirmed', {
    accountAddress: current.address,
    networkId: network,
    ...transfer,
    recipientAddress: input.recipient.trim(),
    txHash: result.txHash,
    authorization: route,
    ...(result.nextUseCounter !== undefined && {
      nextUseCounter: result.nextUseCounter.toString(),
    }),
  });
  const after = await ui.attempt('read', async () => {
    const state = await current.state();
    ui.showAccount({
      address: current.address,
      networkId: current.networkId,
      bindingId: current.bindingId,
      state,
      lastTx: result,
    });
    return refreshAccountBalances(current.address);
  });
  status(
    after
      ? `Withdrawal confirmed: ${result.txHash.slice(0, 12)}… ACC balance is ${input.color === '00'.repeat(32) ? after.night : after.fundedAsset} smallest units.`
      : `Withdrawal confirmed: ${result.txHash.slice(0, 12)}… Refresh ACC state to check its balance.`,
  );
});
ui.on('wallet', connectBuiltInWallet);
ui.on('walletRefresh', async () => {
  if (!devWallet) throw new Error('Connect the built-in wallet before refreshing its balance.');
  status('Waiting for wallet sync to refresh balances…');
  const w = await devWallet.descriptor.connect(network);
  await ui.attempt('balances', () => walletPresentation.refresh(w, 'refresh'));
});
async function connectBuiltInWallet(): Promise<void> {
  checkRoutineReview();
  const lease = account && routineKeys.lease(account);
  status('Reading the service configuration…');
  const config = await fetchServiceConfig(SERVICE_URL, tracedFetch, network);
  if (config.networkId !== network) {
    throw new PassportConnectorError(
      'NetworkMismatch',
      `service is on ${config.networkId}, the page is bound to ${network}`,
    );
  }
  stage('seed');
  checkRoutineReview();
  lease?.();
  // With an open account the PRF ceremony is pinned to its passkey (one prompt, no picker); with
  // none, the user picks a passkey first. Fails closed: without PRF this throws
  // UnsupportedAuthenticator, and no other wallet opens.
  status(
    lease
      ? 'Using the unlocked built-in wallet seed…'
      : account
        ? "Confirm with this account's passkey to derive the wallet seed (PRF)…"
        : 'Choose your passkey once to derive the wallet seed (PRF)…',
  );
  const cachedSeed = account && routineKeys.walletSeed(account);
  if (lease && !cachedSeed)
    throw new Error('Quick actions are locked or expired. Unlock again with your passkey.');
  const seed =
    cachedSeed ||
    (await walletSeed({
      rpId: RP_ID,
      accountCredentialId: account?.credentialId,
      beforeCeremony: beforeDemoCeremony,
    }));
  traceOperation('wallet.seed.derived', {
    source: 'passkey PRF (Lace recipe v1)',
    accountPinned: !!account,
  });
  stage('sync');
  status('Syncing the built-in wallet…');
  try {
    // Loaded on demand: the ledger WASM and the wallet SDK stay out of page start-up.
    const { createDevWallet } = await import('./wallet/dev-wallet.js');
    const previousWallet = devWallet;
    devWallet = undefined;
    walletPresentation.invalidate();
    ui.clearWallet();
    await previousWallet?.stop();
    lease?.();
    checkRoutineReview();
    const started = await createDevWallet(seed, config);
    try {
      lease?.();
      checkRoutineReview();
    } catch (error) {
      await started.stop();
      throw error;
    }
    devWallet = started;
    traceOperation('wallet.facade.started', { networkId: network });
  } finally {
    seed.fill(0);
  }
  const midnight = ((window as unknown as { midnight?: Record<string, unknown> }).midnight ??= {});
  midnight.devwallet = devWallet.descriptor;
  const w = await devWallet.descriptor.connect(network);
  const unshielded = await w.getUnshieldedAddress();
  const dust = await w.getDustAddress();
  record('wallet', {
    seedSource: 'passkey PRF (Lace recipe v1)',
    configuration: await w.getConfiguration(),
    unshielded,
    dust,
  });
  traceOperation('wallet.connected', {
    seedSource: 'passkey PRF (Lace recipe v1)',
    networkId: network,
    unshieldedAddress: unshielded.unshieldedAddress,
    dustAddress: dust.dustAddress,
  });
  ui.showWallet({ unshieldedAddress: unshielded.unshieldedAddress, dustAddress: dust.dustAddress });
  status('Built-in wallet connected; waiting for it to sync to read the balances…');
  // Reads that can time out while the wallet itself works: a failure marks only this step.
  await ui.attempt('balances', () => walletPresentation.refresh(w, 'connect'));
}
