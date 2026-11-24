/** The two pinned ACC key profiles both deploy exactly 52 proof operations. */
const ACC_OPERATIONS = 52;
const CIRCUIT = /^[a-z][a-z0-9_]*$/;
const HASH = /^[a-f0-9]{64}$/;

interface VerifierState {
  operations(): readonly unknown[];
  operation(name: string): { readonly verifierKey: Uint8Array } | undefined;
}

/** Refuse a changed or partial recipient before proving a saved NIGHT deposit. */
export async function assertPinnedNightRecipientRoster(
  state: VerifierState,
  expected: Readonly<Record<string, string>>,
): Promise<void> {
  const pins = Object.entries(expected);
  const names = state.operations();
  if (
    pins.length !== ACC_OPERATIONS ||
    names.length !== pins.length ||
    pins.some(([name, hash]) => !CIRCUIT.test(name) || !HASH.test(hash))
  )
    throw new Error('The named NIGHT recipient ACC verifier roster differs from its pin.');
  const seen = new Set<string>();
  for (const raw of names) {
    let name: string;
    try {
      name =
        typeof raw === 'string'
          ? raw
          : raw instanceof Uint8Array
            ? new TextDecoder('utf-8', { fatal: true }).decode(raw)
            : '';
    } catch {
      throw new Error('The named NIGHT recipient ACC verifier roster differs from its pin.');
    }
    const verifier = state.operation(name)?.verifierKey;
    if (!CIRCUIT.test(name) || seen.has(name) || !(verifier instanceof Uint8Array))
      throw new Error('The named NIGHT recipient ACC verifier roster differs from its pin.');
    seen.add(name);
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', Uint8Array.from(verifier)));
    const hash = Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('');
    if (!Object.hasOwn(expected, name) || expected[name] !== hash)
      throw new Error('The named NIGHT recipient ACC verifier roster differs from its pin.');
  }
}
