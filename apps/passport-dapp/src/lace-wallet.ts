/** Demo-owned connector UI. This is separate from both the ACC API and built-in wallet. */
import {
  discoverWalletProviders,
  connectWalletReader,
  WalletReaderError,
  type WalletReader,
  type WalletProvider,
} from '@input-output-hk/mn-passport-adapter-browser/wallet';
import { MidnightBech32m, UnshieldedAddress } from '@midnightntwrk/wallet-sdk-address-format';
import { traceOperation } from './operation-trace.js';

const element = <K extends keyof HTMLElementTagNameMap>(tag: K, text?: string) => {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  return node;
};
export function installLaceWallet(networkId: string, changed: (connected: boolean) => void) {
  const registry = () => (window as unknown as { midnight?: unknown }).midnight;
  const settings = document.getElementById('settings-wallet-connections')!;
  const wallet = document.getElementById('workspace-wallet')!;
  const controls = element('div');
  controls.id = 'lace-wallet-controls';
  const label = element('label', 'Lace Wallet advertisement (self-reported)');
  label.htmlFor = 'lace-wallet-provider';
  const select = element('select');
  select.id = label.htmlFor;
  select.className = 'action-input';
  const discover = element('button', 'Find Lace Wallet');
  discover.id = 'lace-wallet-discover';
  const connect = element('button', 'Connect Lace Wallet');
  connect.id = 'lace-wallet-connect';
  const refresh = element('button', 'Refresh Lace Wallet balance');
  refresh.id = 'lace-wallet-refresh';
  const forget = element('button', 'Forget local connection');
  forget.id = 'lace-wallet-forget';
  for (const button of [discover, connect, refresh, forget]) {
    button.type = 'button';
    button.className = 'btn btn-secondary';
  }
  const status = element(
    'p',
    'Not connected. Choose Find Lace Wallet to inspect compatible advertisements.',
  );
  status.id = 'lace-wallet-status';
  status.className = 'hint';
  status.setAttribute('role', 'status');
  controls.append(
    element('h4', 'External Lace Wallet'),
    label,
    select,
    discover,
    connect,
    forget,
    status,
  );
  settings.append(controls);
  const panel = element('section');
  panel.id = 'lace-wallet-view';
  panel.className = 'panel';
  panel.append(
    element('h3', 'Lace Wallet · separate external wallet'),
    element(
      'p',
      'Read-only display in this demo. Connecting does not open, enroll into, fund, or grant viewing/spending access to a Passport ACC.',
    ),
  );
  const snapshot = element('div', 'No external wallet balance loaded.');
  snapshot.id = 'lace-wallet-snapshot';
  snapshot.className = 'wallet-snapshot';
  panel.append(snapshot, refresh);
  wallet.append(panel);
  const dialog = element('dialog');
  dialog.id = 'lace-wallet-review';
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-labelledby', 'lace-wallet-review-title');
  const title = element('h2', 'Review wallet connection');
  title.id = 'lace-wallet-review-title';
  const description = element('p');
  description.className = 'consent-details';
  const approve = element('button', 'Continue to wallet');
  approve.id = 'lace-wallet-approve';
  const cancel = element('button', 'Cancel connection');
  cancel.id = 'lace-wallet-cancel';
  approve.type = cancel.type = 'button';
  dialog.addEventListener('keydown', (event) => {
    if (event.key !== 'Tab') return;
    const target = event.shiftKey ? cancel : approve;
    if (
      (event.shiftKey && document.activeElement === approve) ||
      (!event.shiftKey && document.activeElement === cancel)
    ) {
      event.preventDefault();
      target.focus();
    }
  });
  dialog.append(title, description, approve, cancel);
  document.body.append(dialog);
  let candidates: readonly WalletProvider[] = [];
  let reader: WalletReader | undefined;
  let generation = 0;
  let busy = false;
  const buttons = () => {
    connect.disabled = busy || reader !== undefined || candidates.length === 0 || !select.value;
    discover.disabled = busy || reader !== undefined;
    select.disabled = busy || reader !== undefined || candidates.length === 0;
    refresh.disabled = busy || !reader;
    forget.disabled = !reader && !busy;
  };
  const unavailable = () => {
    snapshot.textContent = 'Balance unavailable. No zero balance is inferred.';
  };
  const report = (error: unknown) => {
    const code = error instanceof WalletReaderError ? error.code : 'WalletRequestFailed';
    status.textContent = `${code}. Check the wallet and selected network, then explicitly reconnect. A wallet may be locked; this response does not identify the cause. No ACC permission was changed.`;
    traceOperation('wallet.external.refused', { code, networkId });
  };
  const read = async (active: WalletReader, token: number) => {
    unavailable();
    const view = await active.read();
    if (generation !== token || reader !== active) return;
    const balances = element('dl');
    balances.className = 'facts';
    for (const [color, amount] of Object.entries(view.unshieldedBalances)) {
      const row = element('div');
      row.className = 'fact';
      const label =
        color === '00'.repeat(32) ? 'NIGHT' : `Token ${color.slice(0, 8)}…${color.slice(-6)}`;
      row.append(element('dt', label), element('dd', `${amount.toString()} smallest units`));
      balances.append(row);
    }
    const exact = element('details');
    exact.append(element('summary', 'Exact address & token identifiers'));
    const identifiers = element('dl');
    identifiers.className = 'facts exact-values';
    for (const [label, value] of [
      ['Unshielded address', view.unshieldedAddress],
      ...Object.entries(view.unshieldedBalances).map(([color, amount]) => [
        color,
        `${amount.toString()} smallest units`,
      ]),
    ]) {
      const row = element('div');
      row.className = 'fact';
      row.append(element('dt', label), element('dd', value));
      identifiers.append(row);
    }
    exact.append(identifiers);
    snapshot.replaceChildren(
      ...(balances.childElementCount
        ? [balances]
        : [element('p', 'No unshielded tokens reported')]),
      element(
        'p',
        `Read ${new Date().toISOString()}. Wallet-reported snapshot; no continuous synchronization or finality guarantee.`,
      ),
      exact,
    );
    traceOperation('wallet.external.snapshot', {
      networkId,
      unshieldedAddress: view.unshieldedAddress,
      balances: Object.fromEntries(
        Object.entries(view.unshieldedBalances).map(([color, value]) => [color, value.toString()]),
      ),
    });
    changed(true);
    status.textContent =
      'Connected for this page. Only address and unshielded balances are read; ACC authority is unchanged.';
  };
  discover.addEventListener('click', () => {
    candidates = discoverWalletProviders(registry()).filter((p) => p.rdns === 'io.lace.wallet');
    select.replaceChildren();
    const placeholder = element(
      'option',
      candidates.length ? 'Choose an advertisement' : 'No compatible Lace Wallet found',
    );
    placeholder.value = '';
    select.append(placeholder);
    for (const candidate of candidates) {
      const option = element(
        'option',
        `${candidate.name} · API ${candidate.apiVersion} · ${candidate.id}`,
      );
      option.value = candidate.id;
      select.append(option);
    }
    status.textContent = candidates.length
      ? 'Select one advertisement explicitly. Names and rdns are not proof of identity; check the wallet permission prompt. Multiple entries can be different versions or lookalikes.'
      : 'No compatible Lace Wallet advertisement found. This demo supports the public 4.0.x/4.1.x read subset. Install/unlock the extension and choose Find again; no automatic connection occurs.';
    buttons();
    connect.disabled = true;
  });
  select.addEventListener('change', () => {
    buttons();
    connect.disabled ||= !select.value;
  });
  connect.addEventListener('click', () => {
    const provider = candidates.find((p) => p.id === select.value);
    if (!provider || busy || reader) return;
    description.textContent = `${provider.name} · ${provider.rdns} · API ${provider.apiVersion} · ${provider.id}. Request network ${networkId}. This demo will read your unshielded address and balances only. The wallet may offer broader permissions: inspect its own prompt. Connection grants no Passport ACC authority. Forgetting here does not revoke extension permissions.`;
    dialog.returnValue = '';
    dialog.showModal();
    cancel.focus();
    const reviewedGeneration = generation;
    const close = async () => {
      dialog.removeEventListener('close', close);
      if (dialog.returnValue !== 'approve' || reviewedGeneration !== generation) {
        connect.focus();
        return;
      }
      const token = ++generation;
      busy = true;
      buttons();
      status.textContent =
        'Waiting for the selected wallet. You can forget locally while its request is pending.';
      let connected: WalletReader | undefined;
      try {
        traceOperation('wallet.external.connect.request', {
          providerId: provider.id,
          apiVersion: provider.apiVersion,
          networkId,
        });
        connected = await connectWalletReader(provider, {
          networkId,
          registry,
          validateAddress(value, network) {
            try {
              MidnightBech32m.parse(value).decode(UnshieldedAddress, network);
              return true;
            } catch {
              return false;
            }
          },
        });
        if (generation !== token) {
          connected.forget();
          return;
        }
        reader = connected;
        await read(connected, token);
      } catch (error) {
        connected?.forget();
        if (generation === token) {
          reader = undefined;
          changed(false);
          unavailable();
          report(error);
        }
      } finally {
        if (generation === token) {
          busy = false;
          buttons();
          connect.focus();
        }
      }
    };
    dialog.addEventListener('close', close);
  });
  approve.addEventListener('click', () => dialog.close('approve'));
  cancel.addEventListener('click', () => dialog.close('cancel'));
  forget.addEventListener('click', () => {
    ++generation;
    changed(false);
    reader?.forget();
    reader = undefined;
    busy = false;
    unavailable();
    buttons();
    status.textContent =
      'Local connection forgotten. Revoke permissions in Lace Wallet if needed. No transaction or ACC permission was changed.';
    traceOperation('wallet.external.forgotten', { networkId });
  });
  refresh.addEventListener('click', async () => {
    if (!reader || busy) return;
    const active = reader,
      token = generation;
    busy = true;
    buttons();
    try {
      await read(active, token);
    } catch (error) {
      if (generation === token) {
        active.forget();
        reader = undefined;
        changed(false);
        unavailable();
        report(error);
      }
    } finally {
      if (generation === token) {
        busy = false;
        buttons();
      }
    }
  });
  buttons();
}
