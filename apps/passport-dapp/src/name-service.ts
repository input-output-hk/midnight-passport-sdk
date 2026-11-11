import {
  PassportNameError,
  resolvePassportName,
  type PassportNameService,
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
export function showDemoNameService(service: PassportNameService, networkId: string): () => void {
  const form = document.getElementById('name-service-form') as HTMLFormElement;
  const input = document.getElementById('name-service-name') as HTMLInputElement;
  const button = document.getElementById('name-service-resolve') as HTMLButtonElement;
  const status = document.getElementById('name-service-status')!;
  const output = document.getElementById('name-service-result')!;
  if (service.provider.mode === 'external') {
    byId('name-service-title').textContent = 'Name service · provider adapter';
    byId('name-service-help').textContent =
      'Read-only provider lookup. The address is a hint, not a proof of name ownership. No name is registered, passkey requested or transfer destination changed.';
    input.value = '';
  }
  let revision = 0;
  let busy = false;
  const submit = (event: Event) => {
    event.preventDefault();
    if (busy) return;
    const current = ++revision;
    busy = true;
    button.disabled = true;
    output.textContent = '';
    status.textContent = 'Looking up the name…';
    void resolvePassportName(service, { name: input.value, networkId })
      .then((record) => {
        if (revision !== current) return;
        status.textContent = nameLookupMessage(record?.mode ?? service.provider.mode, !!record);
        output.textContent = record ? JSON.stringify(record, null, 2) : '';
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
  form.addEventListener('submit', submit);
  return () => {
    revision++;
    form.removeEventListener('submit', submit);
  };
}

export function showNameConfigurationError(): void {
  byId('name-service-title').textContent = 'Name service · configuration required';
  byId('name-service-help').textContent =
    'Configure the registry and indexer for this demo network to enable lookup.';
  const button = document.getElementById('name-service-resolve') as HTMLButtonElement;
  button.disabled = true;
}
