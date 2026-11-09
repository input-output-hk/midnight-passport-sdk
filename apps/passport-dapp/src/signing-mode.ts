export type DemoSigningMode = 'passkey' | 'jubjub';

/** Pin a mode at document startup. Mode changes require a new document, never a live signer swap. */
export function demoSigningMode(input: {
  mode?: string | undefined;
  legacyArm?: string | undefined;
  search?: string | undefined;
}) {
  const parse = (value: string): DemoSigningMode => {
    if (value !== 'passkey' && value !== 'jubjub')
      throw new Error('Passport signing mode must be passkey or jubjub.');
    return value;
  };
  const configured = input.mode === undefined ? undefined : parse(input.mode);
  if (input.legacyArm !== undefined && !['p256', 'jubjub'].includes(input.legacyArm))
    throw new Error('VITE_PASSPORT_ARM must be p256 or jubjub.');
  const legacy =
    input.legacyArm === undefined ? undefined : input.legacyArm === 'p256' ? 'passkey' : 'jubjub';
  if (configured && legacy && configured !== legacy)
    throw new Error('Conflicting Passport signing mode and legacy arm.');
  const overrides = new URLSearchParams(input.search).getAll('signing');
  if (overrides.length > 1) throw new Error('Choose only one Passport signing mode.');
  const override = overrides[0];
  const mode = override === undefined ? (configured ?? legacy ?? 'passkey') : parse(override);
  return Object.freeze({ mode, arm: mode === 'passkey' ? ('p256' as const) : ('jubjub' as const) });
}

/** Settings links reload explicitly; opening the other mode does not migrate an existing ACC. */
export function showSigningMode(mode: DemoSigningMode) {
  const root = document.getElementById('demo-configuration');
  if (root && !document.getElementById('signing-mode-label')) {
    root.insertAdjacentHTML(
      'beforeend',
      `<h3>Owner signing demo</h3>
      <p id="signing-mode-label"></p>
      <p><a id="signing-mode-passkey">Open passkey demo</a> · <a id="signing-mode-jubjub">Open JubJub demo</a></p>
      <p class="hint">Each link opens a new page. Use an account created in that mode; existing accounts are not migrated. Critical actions still require fresh passkey approval.</p>`,
    );
  }
  const label = document.getElementById('signing-mode-label');
  if (label)
    label.textContent =
      mode === 'passkey'
        ? 'Passkey · direct P-256 signatures'
        : 'JubJub · passkey-derived software signatures';
  for (const value of ['passkey', 'jubjub'] as const) {
    const link = document.getElementById(`signing-mode-${value}`) as HTMLAnchorElement | null;
    if (!link) continue;
    const url = new URL(location.href);
    url.searchParams.set('signing', value);
    url.hash = '';
    link.href = url.href;
    link.target = '_blank';
    link.rel = 'noopener';
    if (value === mode) link.setAttribute('aria-current', 'true');
  }
}
