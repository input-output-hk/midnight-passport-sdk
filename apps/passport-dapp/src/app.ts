import { PassportConnectorError } from '@input-output-hk/mn-passport-account';
import { defaultFetch, fetchServiceConfig } from '@input-output-hk/mn-passport-adapter-service';
import type {
  PassportAccount,
  PassportConnectorAPI,
  PassportConnectorDescriptor,
  PassportTxResult,
} from '@input-output-hk/mn-passport-protocol';
import { ARM, MANIFEST_SHA256, NETWORK_ID, RP_ID, SERVICE_URL, installShim } from './connector.js';
import { DEPLOY_ESTIMATE_S, EVENT_STAGES, FLOWS } from './flows.js';
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

let api: PassportConnectorAPI | undefined;
let devWallet: DevWallet | undefined;
let account: PassportAccount | undefined;
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
ui.on('wallet', connectBuiltInWallet);
async function connectBuiltInWallet(): Promise<void> {
  status('Reading the service configuration…');
  const config = await fetchServiceConfig(SERVICE_URL, defaultFetch, network);
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
  stage('sync');
  status('Syncing the built-in wallet…');
  try {
    // Loaded on demand: the ledger WASM and the wallet SDK stay out of page start-up.
    const { createDevWallet } = await import('./wallet/dev-wallet.js');
    await devWallet?.stop();
    devWallet = undefined;
    devWallet = await createDevWallet(seed, config);
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
