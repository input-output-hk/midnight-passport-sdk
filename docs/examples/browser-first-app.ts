import { accountActions } from './browser-first-integration.js';
import { PassportConnectorError } from '@input-output-hk/mn-passport-account/errors';

const name = document.querySelector<HTMLInputElement>('#user-name');
const retire = document.querySelector<HTMLInputElement>('#retire');
const create = document.querySelector<HTMLButtonElement>('#create');
const open = document.querySelector<HTMLButtonElement>('#open');
const status = document.querySelector<HTMLOutputElement>('#status');
if (!name || !retire || !create || !open || !status) throw new Error('Missing account controls');
const createButton: HTMLButtonElement = create;
const openButton: HTMLButtonElement = open;

const show = (message: string) => { status.textContent = message; };
const passport = await accountActions(
  window.localStorage,
  event => show(`${event.step}: ${event.phase}${event.detail?.txId ? ` · ${event.detail.txId}` : ''}`),
  ceremony => {
    if (!window.confirm(`Allow passkey ${ceremony.purpose} for ${ceremony.rpId}? Request ${ceremony.attempt}.`))
      throw new Error('Credential request declined');
  },
);

async function run(work: (signal: AbortSignal) => Promise<{ address: string; state(): Promise<unknown> }>) {
  createButton.disabled = true;
  openButton.disabled = true;
  try {
    const account = await work(new AbortController().signal);
    await account.state();
    show(`Account ${account.address} is open and its chain state was read.`);
  } catch (error) {
    show(error instanceof PassportConnectorError ? error.code : 'Host or provider error; inspect the service and original operation ID');
  } finally {
    createButton.disabled = false;
    openButton.disabled = false;
  }
}

createButton.addEventListener('click', () => {
  const userName = name.value.trim();
  if (!userName) { show('Enter a name first.'); return; }
  const retireAuthority = retire.checked;
  if (!window.confirm(`Create an ACC for ${userName}? Maintenance authority ${retireAuthority ? 'will be permanently retired' : 'will remain active'}.`)) return;
  void run(signal => passport.create(userName, retireAuthority, signal));
});
openButton.addEventListener('click', () => {
  if (!window.confirm('Reopen the account with its enrolled passkey and read live state?')) return;
  void run(signal => passport.open(signal));
});
