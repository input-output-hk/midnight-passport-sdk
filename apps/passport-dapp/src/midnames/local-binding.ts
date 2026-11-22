import { resolvePinnedBinding } from '@input-output-hk/mn-passport-contract';

/** The connected named NIGHT route has a qualified deposit adapter only for the stable binding. */
export function localNightBinding(bindingId: string, manifestSha256?: string): boolean {
  if (bindingId !== 'acc-s3r1.1') return false;
  const pin = resolvePinnedBinding(bindingId);
  return manifestSha256 === undefined || pin.manifestSha256 === manifestSha256;
}
