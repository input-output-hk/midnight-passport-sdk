import { resolvePinnedBinding } from '@input-output-hk/mn-passport-contract';

/** Admit only the stable binding or an explicitly opted-in local candidate pin. */
export function localNightBinding(
  bindingId: string,
  manifestSha256?: string,
  provisionalLocal = false,
): boolean {
  if (bindingId !== 'acc-s3r1.1' && bindingId !== 'acc-s3r1.1-zkir036') return false;
  const pin = resolvePinnedBinding(bindingId);
  if (bindingId === 'acc-s3r1.1-zkir036')
    return provisionalLocal === true && manifestSha256 === pin.manifestSha256;
  return manifestSha256 === undefined || pin.manifestSha256 === manifestSha256;
}

/** A local source may use its own binding, or the pinned old recipient of a candidate source. */
export function localNightRecipientBinding(
  sourceBindingId: string,
  recipientBindingId: string,
  candidate?: { readonly manifestSha256: string; readonly provisionalLocal?: boolean },
): boolean {
  const manifest =
    recipientBindingId === 'acc-s3r1.1-zkir036' ? candidate?.manifestSha256 : undefined;
  return (
    localNightBinding(
      recipientBindingId,
      manifest,
      recipientBindingId === 'acc-s3r1.1-zkir036' && !!candidate?.provisionalLocal,
    ) &&
    (recipientBindingId === sourceBindingId ||
      (sourceBindingId === 'acc-s3r1.1-zkir036' && recipientBindingId === 'acc-s3r1.1'))
  );
}
