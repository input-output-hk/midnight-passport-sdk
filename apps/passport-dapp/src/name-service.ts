import {
  PassportNameError,
  resolvePassportName,
  type PassportNameService,
} from '@input-output-hk/mn-passport-account/names';

/** Example host wiring. Replace the injected adapter, not the SDK or lookup control. */
export function showDemoNameService(service: PassportNameService, networkId: string): () => void {
  const form = document.getElementById('name-service-form') as HTMLFormElement;
  const input = document.getElementById('name-service-name') as HTMLInputElement;
  const button = document.getElementById('name-service-resolve') as HTMLButtonElement;
  const status = document.getElementById('name-service-status')!;
  const output = document.getElementById('name-service-result')!;
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
        status.textContent = record
          ? 'Mock record found. Synthetic ACC address only; not verified on chain or usable for transfers here.'
          : 'Name not found in this mock namespace and network.';
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
