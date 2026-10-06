import './polyfills.js';
import type {
  PassportAccount,
  PassportConnectorAPI,
  PassportConnectorDescriptor,
} from '@midnight-ntwrk/mn-passport-protocol';
import { MANIFEST_SHA256, SERVICE_URL, installShim } from './connector.js';

installShim();
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const evidence: {
  network: string;
  serviceUrl: string;
  pinnedManifestSha256: string;
  steps: unknown[];
} = {
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
    const err = e as { code?: string; message?: string };
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
  status('Creating… the passkey prompt appears twice: create it, then verify the authenticator.');
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
  const r = await account.rotateEncryptionKey(crypto.getRandomValues(new Uint8Array(32)));
  record('rotate', { ...r, state: await account.state() });
  status(`Rotated in transaction ${r.txHash.slice(0, 16)}….`);
});
$('copy').onclick = () => void navigator.clipboard.writeText($('evidence').textContent ?? '');
