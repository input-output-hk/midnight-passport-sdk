import { PassportConnectorError } from '@input-output-hk/mn-passport-account';
import { fetchServiceConfig } from '@input-output-hk/mn-passport-adapter-service';
import type {
  PassportAccount,
  PassportConnectorAPI,
  PassportConnectorDescriptor,
  PassportTxResult,
} from '@input-output-hk/mn-passport-protocol';
import { ARM, MANIFEST_SHA256, NETWORK_ID, RP_ID, SERVICE_URL, installShim } from './connector.js';
import { DEPLOY_ESTIMATE_S, EVENT_STAGES, FLOWS } from './flows.js';
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
      'The ACC viewing secret is random and sealed to the passkey-derived reader. This preview supports create/open. Viewing-key rotation requires chain-backed holdings and read-grant sources.';
}
const { status, stage, record, event: onEvent } = ui;
setOperationTraceSink(ui.trace);

let api: PassportConnectorAPI | undefined;
let devWallet: DevWallet | undefined;
let account: PassportAccount | undefined;
let balanceAssetColor: string | undefined;
const fundingUrl = new URL('/v1/demo/funding', SERVICE_URL);
async function refreshAccountBalances(address: string): Promise<void> {
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
