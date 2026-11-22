import { resolvePinnedBinding } from '@input-output-hk/mn-passport-contract';

/** Only these two exact local source bindings may enter the named NIGHT route. */
export function localNightBinding(bindingId: string, manifestSha256?: string): boolean {
  if (bindingId !== 'acc-s3r1.1' && bindingId !== 'acc-s3r1.1-zkir036') return false;
  const pin = resolvePinnedBinding(bindingId);
  return manifestSha256 === undefined || pin.manifestSha256 === manifestSha256;
}
