import { PassportConnectorError } from '@input-output-hk/mn-passport-account';
import { fetchServiceConfig } from '@input-output-hk/mn-passport-adapter-service';
import type {
  PassportAccount,
  PassportConnectorAPI,
  PassportConnectorDescriptor,
  PassportTxResult,
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
} from './connector.js';
import { DEPLOY_ESTIMATE_S, EVENT_STAGES, FLOWS, knownAccAddress } from './flows.js';
import { withdrawalRequest } from './withdrawal.js';
import { parseDeviceHandoff, prepareDeviceHandoff } from './device-handoff.js';
import { setOperationTraceSink, tracedFetch, traceOperation } from './operation-trace.js';
import { createUi } from './ui.js';
import type { DevWallet } from './wallet/dev-wallet.js';
import { walletSeed } from './wallet/seed.js';

installShim();
const mockPasskey = (navigator.credentials as unknown as { mock?: boolean }).mock === true;
const network = NETWORK_ID;
const injected = () =>
  (window as unknown as { midnight?: { passport?: PassportConnectorDescriptor } }).midnight
    ?.passport;
const apiVersion = injected()?.apiVersion;

// Presentation (buttons, progress, event log, cards, evidence) lives in ui.ts; this file keeps the
// connector calls. `stage` moves the progress bar and the log to the next step of the action.
const ui = createUi(
  {
    note:
      ARM === 'jubjub'
        ? 'JubJub preview: the ACC viewing secret is random and sealed to the passkey-derived reader. Create/open are available; rotation needs chain-backed holding and grant sources.'
        : 'P-256 preview: the ACC viewing secret is random and sealed to the passkey-derived reader. Create/open are available; rotation needs a chain-verified device roster.',
    passkey: mockPasskey
      ? 'MOCK (dev only, software key in localStorage)'
      : 'browser authenticator',
    network,
    serviceUrl: SERVICE_URL,
    pinnedManifestSha256: MANIFEST_SHA256,
    ...(apiVersion !== undefined && { apiVersion }),
  },
  ARM,
);
if (ARM === 'jubjub') {
  const note = document.getElementById('key-note');
  if (note)
    note.textContent =
      'The ACC viewing secret is random and sealed to the passkey-derived reader. This preview supports create/open and reviewed device enrollment. Removal requires complete reader and read-grant openings.';
}
const { status, stage, record, event: onEvent } = ui;
setOperationTraceSink(ui.trace);

let api: PassportConnectorAPI | undefined;
let devWallet: DevWallet | undefined;
let account: PassportAccount | undefined;
let balanceAssetColor: string | undefined;
const fundingUrl = new URL('/v1/demo/funding', SERVICE_URL);
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
    const data = (await response.json()) as { assets?: unknown; balanceAssetColor?: unknown };
    if (
      Array.isArray(data.assets) &&
      data.assets.length > 0 &&
      data.assets.every(
        (asset: unknown) =>
          typeof asset === 'object' &&
          asset !== null &&
          typeof (asset as Record<string, unknown>).color === 'string' &&
          /^[0-9a-f]{64}$/.test(String((asset as Record<string, unknown>).color)) &&
          typeof (asset as Record<string, unknown>).amount === 'string' &&
          /^[1-9][0-9]*$/.test(String((asset as Record<string, unknown>).amount)),
      ) &&
      typeof data.balanceAssetColor === 'string' &&
      data.assets.some((asset: { color: string }) => asset.color === data.balanceAssetColor)
    ) {
      balanceAssetColor = data.balanceAssetColor;
      ui.enableFunding(data.assets as { color: string; amount: string }[]);
      if (account) {
        const address = account.address;
        void refreshAccountBalances(address).catch(() => ui.showAccountBalanceError(address));
      }
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
  account = a;
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
};

if (injected()) {
  status('Ready. Create a Passport account, or open one with your passkey.');
} else {
  ui.setReady(false);
  status('The Passport connector is not injected (window.midnight.passport).');
}

ui.on('create', async () => {
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
  status(
    ARM === 'jubjub'
      ? 'Opening… choose your passkey and unlock its sealed ACC viewing secret.'
      : 'Opening… choose your passkey, then unlock its sealed ACC viewing secret.',
  );
  await opened(await (await connector()).openAccount({ onEvent }), 'reopened');
});
ui.on('openAt', async () => {
  const requestedAddress = knownAccAddress(ui.knownAddress());
  traceOperation('account.openByAddress.requested', { accountAddress: requestedAddress });
  status('Opening the known ACC… choose an enrolled passkey and unlock its sealed viewing key.');
  const accountApi = await connector();
  if (!accountApi.openAccountAt) throw new Error('This Passport connector cannot open by address.');
  const restored = await accountApi.openAccountAt(requestedAddress, { onEvent });
  if (restored.address !== requestedAddress)
    throw new Error('The connector returned a different ACC address.');
  await opened(restored, 'opened by address');
  traceOperation('account.openByAddress.verified', { accountAddress: restored.address });
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
        await refreshAccountBalances(current.address);
        return true;
      })
    : undefined;
  status(
    balanceAssetColor && !balancesRead
      ? `ACC ${current.address.slice(0, 12)}… state refreshed; balances unavailable (see event log).`
      : `ACC ${current.address.slice(0, 12)}… state refreshed from the chain.`,
  );
});
ui.on('holdings', async () => {
  if (!account?.readShieldedHoldings)
    throw new Error('Open a sealed Passport account before reading its shielded holdings.');
  const current = account;
  const read = current.readShieldedHoldings;
  if (!read) throw new Error('This Passport account cannot read shielded holdings.');
  status('Opening the sealed ACC inbox and checking coin commitments against the chain…');
  stage('verify');
  const verified = await read({ onEvent });
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
ui.on('recoverGrants', async () => {
  const current = account;
  if (!current?.recoverPendingGrants || !current.grantRoster)
    throw new Error('Open a supported Passport account before recovering grants.');
  stage('recover');
  status('Checking staged openings against the live ACC and resuming publication…');
  const result = await current.recoverPendingGrants({ onEvent });
  stage('read');
  const roster = await current.grantRoster();
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
  if (!approved) throw new Error('Device enrollment was cancelled before signing.');
  stage('submit');
  const enrolled = await addDevice(reader, { onEvent });
  stage('read');
  const [after, nextState] = await Promise.all([readRoster(), current.state()]);
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
    `Remove this enrolled device from Passport ACC?\n\nNetwork: ${network}\nACC: ${current.address}\n` +
      `Device commitment: ${target}\nDevice epoch: ${before.deviceEpoch}\n` +
      `Live entries: ${before.commitments.length}\n\n` +
      'The SDK rotates the viewing and roster keys before removal. The removed passkey will lose access. Confirm the full commitment against the live roster.',
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
  stage('read');
  const [after, nextState] = await Promise.all([current.deviceRoster(), current.state()]);
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
    rotationTxHash: removed.rotationTxHash,
    removalTxHash: removed.txHash,
    deviceEpoch: after.deviceEpoch.toString(),
    liveEntries: after.commitments.length,
  };
  record('deviceRemoved', result);
  traceOperation('account.device.removed', result);
  status('The selected device is absent from the live ACC roster.');
});
ui.on('rotate', async () => {
  throw new Error('Viewing-key rotation needs chain-backed roster and grant sources.');
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
  const response = await tracedFetch(fundingUrl.toString(), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ accountAddress: target, requestId, color: asset.color }),
  });
  const result = (await response.json()) as Record<string, unknown>;
  if (!response.ok) {
    const error = new Error(
      typeof result.error === 'string' ? result.error : 'Funding was refused',
    );
    error.name = 'FundingRejected';
    throw error;
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
    throw new Error('Funding service returned an invalid confirmation');
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
  const confirmed = window.confirm(
    `Withdraw from Passport ACC?\n\nNetwork: ${network}\nACC: ${current.address}\nAsset color: ${transfer.color}\nAmount: ${transfer.amount} smallest units\nFresh ACC balance: ${freshBalance}\nRecipient: ${input.recipient.trim()}\n\nConfirm this destination and amount before the passkey prompt.`,
  );
  if (!confirmed) {
    status('Withdrawal cancelled before signing.');
    traceOperation('withdrawal.cancelled', { accountAddress: current.address });
    return;
  }
  stage('submit');
  status('Confirm the owner withdrawal with your passkey; proving and submission may take time…');
  const result = await withdrawUnshielded(transfer, { onEvent });
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
    nextUseCounter: result.nextUseCounter.toString(),
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
async function connectBuiltInWallet(): Promise<void> {
  status('Reading the service configuration…');
  const config = await fetchServiceConfig(SERVICE_URL, tracedFetch, network);
  if (config.networkId !== network) {
    throw new PassportConnectorError(
      'NetworkMismatch',
      `service is on ${config.networkId}, the page is bound to ${network}`,
    );
  }
  stage('seed');
  // With an open account the PRF ceremony is pinned to its passkey (one prompt, no picker); with
  // none, the user picks a passkey first. Fails closed: without PRF this throws
  // UnsupportedAuthenticator, and no other wallet opens.
  status(
    account
      ? "Confirm with this account's passkey to derive the wallet seed (PRF)…"
      : 'Choose your passkey, then confirm again to derive the wallet seed (PRF)…',
  );
  const seed = await walletSeed({ rpId: RP_ID, accountCredentialId: account?.credentialId });
  traceOperation('wallet.seed.derived', {
    source: 'passkey PRF (Lace recipe v1)',
    accountPinned: !!account,
  });
  stage('sync');
  status('Syncing the built-in wallet…');
  try {
    // Loaded on demand: the ledger WASM and the wallet SDK stay out of page start-up.
    const { createDevWallet } = await import('./wallet/dev-wallet.js');
    await devWallet?.stop();
    devWallet = undefined;
    devWallet = await createDevWallet(seed, config);
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
  const balances = await ui.attempt('balances', async () => {
    const shielded = await w.getShieldedAddresses();
    ui.showWallet({ shieldedAddress: shielded.shieldedAddress });
    const [unshieldedBalances, dustBalance] = await Promise.all([
      w.getUnshieldedBalances(),
      w.getDustBalance(),
    ]);
    record('balances', { shielded, unshieldedBalances, dust: dustBalance });
    traceOperation('wallet.sync.completed', { networkId: network });
    traceOperation('wallet.balances', {
      shieldedAddress: shielded.shieldedAddress,
      unshieldedBalances: Object.fromEntries(
        Object.entries(unshieldedBalances).map(([color, value]) => [color, value.toString()]),
      ),
      dustBalance: dustBalance.balance.toString(),
      dustCap: dustBalance.cap.toString(),
    });
    return { unshieldedBalances, dust: dustBalance };
  });
  if (balances) {
    ui.showWallet(balances);
    status('Built-in wallet connected through the DApp Connector API.');
  } else {
    ui.showWallet({ balanceError: 'See the event log.' });
    status('Built-in wallet connected, but its balances could not be read (see the event log).');
  }
}
