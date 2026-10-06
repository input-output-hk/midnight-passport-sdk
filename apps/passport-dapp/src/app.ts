import { PassportConnectorError, toPassportError } from '@midnight-ntwrk/mn-passport-account';
import { defaultFetch, fetchServiceConfig } from '@midnight-ntwrk/mn-passport-adapter-browser';
import type {
  PassportAccount,
  PassportConnectorAPI,
  PassportConnectorDescriptor,
} from '@midnight-ntwrk/mn-passport-protocol';
import { MANIFEST_SHA256, RP_ID, SERVICE_URL, installShim } from './connector.js';
import type { DevWallet } from './wallet/dev-wallet.js';
import { walletSeed } from './wallet/seed.js';

installShim();
const $ = <T extends HTMLElement>(id: string) => {
  const element = document.getElementById(id);
  if (!element) throw new Error(`index.html has no element with id "${id}"`);
  return element as T;
};
const mockPasskey = (navigator.credentials as unknown as { mock?: boolean }).mock === true;
const evidence: {
  note: string;
  passkey: string;
  network: string;
  serviceUrl: string;
  pinnedManifestSha256: string;
  steps: unknown[];
} = {
  note: "Prototype: the account's first encryption key derives from the passkey's PRF (Lace recipe v1, MIP-0015); rotated keys are random and not retained.",
  passkey: mockPasskey ? 'MOCK (dev only, software key in localStorage)' : 'browser authenticator',
  network: 'undeployed',
  serviceUrl: SERVICE_URL,
  pinnedManifestSha256: MANIFEST_SHA256,
  steps: [],
};
const record = (name: string, data: Record<string, unknown> = {}) => {
  evidence.steps.push({ name, at: new Date().toISOString(), ...data });
  $('evidence').textContent = JSON.stringify(
    evidence,
    (_k, v: unknown) => (typeof v === 'bigint' ? v.toString() : v),
    2,
  );
};
const status = (text: string) => {
  $('status').textContent = text;
};

let api: PassportConnectorAPI | undefined;
let devWallet: DevWallet | undefined;
let account: PassportAccount | undefined;
const injected = () =>
  (window as unknown as { midnight?: { passport?: PassportConnectorDescriptor } }).midnight
    ?.passport;
const connector = async () => {
  const descriptor = injected();
  if (!descriptor) throw new Error('window.midnight.passport is not injected');
  return (api ??= await descriptor.connect(evidence.network));
};
const run = (fn: () => Promise<void>) => async () => {
  try {
    await fn();
  } catch (e) {
    // A thrown null or undefined is a value too: narrow it to an empty object.
    const err = (e ?? {}) as { code?: string; message?: string };
    status(`Failed: ${err.code ?? 'Error'} — ${err.message ?? String(e)}`);
    record('error', { code: err.code, message: err.message });
  }
};
const opened = async (a: PassportAccount, how: string) => {
  account = a;
  ($('rotate') as HTMLButtonElement).disabled = false;
  record(how, { address: a.address, binding: a.bindingId, state: await a.state() });
  status(`Account ${a.address.slice(0, 12)}… is ${how}.`);
};

record('page-loaded', { apiVersion: injected()?.apiVersion });

$('create').onclick = run(async () => {
  status(
    'Creating… the passkey prompt appears three times: create it, verify the authenticator, then derive the encryption key (PRF).',
  );
  const a = await (
    await connector()
  ).createAccount({
    userName: `passport-${Date.now()}`,
    onProgress: (s) => {
      status(s);
      record(`create:${s}`);
    },
  });
  await opened(a, 'created');
});
$('open').onclick = run(async () => {
  status('Opening…');
  await opened(await (await connector()).openAccount(), 'reopened');
});
$('rotate').onclick = run(async () => {
  if (!account) throw new Error('open or create an account first');
  status('Proving on the service (≈ 30 s)…');
  // Lace has no rotation recipe yet: a random target key is this prototype's extension.
  const r = await account.rotateEncryptionKey(crypto.getRandomValues(new Uint8Array(32)));
  record('rotate', { ...r, state: await account.state() });
  status(`Rotated in transaction ${r.txHash.slice(0, 16)}….`);
});
const walletButton = $<HTMLButtonElement>('wallet');
walletButton.onclick = run(async () => {
  walletButton.disabled = true;
  try {
    await connectBuiltInWallet();
  } finally {
    walletButton.disabled = false;
  }
});
async function connectBuiltInWallet(): Promise<void> {
  const network = evidence.network;
  status('Reading the service configuration…');
  const config = await fetchServiceConfig(SERVICE_URL, defaultFetch, network);
  if (config.networkId !== network) {
    throw new PassportConnectorError(
      'NetworkMismatch',
      `service is on ${config.networkId}, the page is bound to ${network}`,
    );
  }
  status('Choose your passkey, then confirm again to derive the wallet seed (PRF)…');
  // The PRF ceremony is its own WebAuthn prompt, so the user picks the passkey here first.
  let picked: PublicKeyCredential | null;
  try {
    picked = (await navigator.credentials.get({
      publicKey: {
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        rpId: RP_ID,
        userVerification: 'required',
      },
    })) as PublicKeyCredential | null;
  } catch (e) {
    throw toPassportError(e);
  }
  if (!picked)
    throw new PassportConnectorError('UserCancelled', 'The passkey prompt was cancelled.');
  // Fails closed: without PRF this throws UnsupportedAuthenticator, and no other wallet opens.
  const seed = await walletSeed({ credentialId: new Uint8Array(picked.rawId), rpId: RP_ID });
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
  record('wallet', {
    seedSource: 'passkey PRF (Lace recipe v1)',
    configuration: await w.getConfiguration(),
    unshielded: await w.getUnshieldedAddress(),
    dust: await w.getDustAddress(),
  });
  status('Built-in wallet connected through the DApp Connector API.');
}
$('copy').onclick = () =>
  void navigator.clipboard
    .writeText($('evidence').textContent ?? '')
    .then(() => status('Evidence copied.'))
    .catch(() => status('Copy failed: the browser refused clipboard access.'));
