import {
  PassportNameError,
  resolvePassportContractCallName,
  resolvePassportName,
  type PassportNameService,
  type ResolvedPassportName,
} from '@input-output-hk/mn-passport-account/names';
import { byId } from './ui-dom.js';

/** Provider metadata describes the hint; neither mode establishes ownership on chain. */
export const nameLookupMessage = (mode: 'mock' | 'external', found: boolean): string =>
  !found
    ? 'Name not found in this provider namespace and network.'
    : mode === 'mock'
      ? 'Mock record found. Synthetic ACC address only; not verified on chain or usable for transfers here.'
      : 'Provider record found. ACC address hint only; ownership is not verified on chain or usable for transfers here.';

/** Example host wiring. Replace the injected adapter, not the SDK or lookup control. */
export function showDemoNameService(
  service: PassportNameService,
  networkId: string,
  openAccount?: (address: string) => boolean,
): () => void {
  const form = document.getElementById('name-service-form') as HTMLFormElement;
  const input = document.getElementById('name-service-name') as HTMLInputElement;
  const button = document.getElementById('name-service-resolve') as HTMLButtonElement;
  const status = document.getElementById('name-service-status')!;
  const output = document.getElementById('name-service-result')!;
  const open = byId<HTMLButtonElement>('name-service-open');
  let selected: Readonly<ResolvedPassportName> | undefined;
  const clear = () => {
    selected = undefined;
    output.textContent = '';
    open.hidden = true;
    open.disabled = true;
  };
  if (service.provider.mode === 'external') {
    byId('name-service-title').textContent = 'Name service · provider adapter';
    byId('name-service-help').textContent =
      'Read-only provider lookup. The address is a hint, not a proof of name ownership. Opening it checks the name again and requires an enrolled passkey. Lookup does not register a name or change a transfer destination.';
    input.value = '';
  }
  let revision = 0;
  let busy = false;
  const changed = () => {
    revision++;
    busy = false;
    button.disabled = false;
    clear();
    status.textContent = 'Name changed. Look it up again.';
  };
  input.addEventListener('input', changed);
  const submit = (event: Event) => {
    event.preventDefault();
    if (busy) return;
    const current = ++revision;
    busy = true;
    button.disabled = true;
    clear();
    status.textContent = 'Looking up the name…';
    void resolvePassportName(service, { name: input.value, networkId })
      .then((record) => {
        if (revision !== current) return;
        selected = record;
        status.textContent = nameLookupMessage(record?.mode ?? service.provider.mode, !!record);
        output.textContent = record ? JSON.stringify(record, null, 2) : '';
        open.hidden = !(record && record.mode === 'external' && openAccount);
        open.disabled = open.hidden;
      })
      .catch((error: unknown) => {
        if (revision !== current) return;
        status.textContent =
          error instanceof PassportNameError
            ? `${error.code}: ${error.message}`
            : 'Unavailable: The naming provider could not be queried.';
      })
      .finally(() => {
        if (revision !== current) return;
        busy = false;
        button.disabled = false;
      });
  };
  const use = () => {
    if (!selected || selected.mode !== 'external' || !openAccount || busy) return;
    const previous = selected;
    const current = ++revision;
    busy = true;
    button.disabled = true;
    open.disabled = true;
    status.textContent = 'Checking the name again before Passport login…';
    void resolvePassportContractCallName(service, { name: previous.name, networkId })
      .then((fresh) => {
        if (revision !== current) return;
        if (!fresh || input.value !== previous.name) {
          clear();
          status.textContent = 'Name is no longer available. Look it up again.';
          return;
        }
        if (
          fresh.accountAddress !== previous.accountAddress ||
          fresh.providerId !== previous.providerId ||
          fresh.namespace !== previous.namespace
        ) {
          clear();
          status.textContent = 'Name target changed. Look it up again before login.';
          return;
        }
        if (!openAccount(fresh.accountAddress)) {
          status.textContent = 'Passport login is busy. Try again when it is ready.';
          return;
        }
        status.textContent = 'Review the exact account address and approve the passkey login.';
      })
      .catch((error: unknown) => {
        if (revision !== current) return;
        clear();
        status.textContent =
          error instanceof PassportNameError
            ? `${error.code}: ${error.message}`
            : 'Unavailable: The naming provider could not be queried.';
      })
      .finally(() => {
        if (revision !== current) return;
        busy = false;
        button.disabled = false;
        open.disabled = Boolean(open.hidden) || !selected;
      });
  };
  form.addEventListener('submit', submit);
  open.addEventListener('click', use);
  return () => {
    revision++;
    input.removeEventListener('input', changed);
    form.removeEventListener('submit', submit);
    open.removeEventListener('click', use);
  };
}

export function showNameConfigurationError(): void {
  byId('name-service-title').textContent = 'Name service · configuration required';
  byId('name-service-help').textContent =
    'Configure the registry and indexer for this demo network to enable lookup.';
  const button = document.getElementById('name-service-resolve') as HTMLButtonElement;
  button.disabled = true;
}
