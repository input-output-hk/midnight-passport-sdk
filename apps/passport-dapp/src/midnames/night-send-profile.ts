import type { CandidateAccountQualification } from './ledger-reader.js';

/** The 0.36.1 registry remains an isolated, provisional local route. */
export function supportsLocalNamedNightSend(
  profile: string | undefined,
  isolated0361: string | undefined,
  candidate: Pick<CandidateAccountQualification, 'bindingId'> | undefined,
): boolean {
  if (profile === 'standalone-0.35') return true;
  return (
    profile === 'standalone-0.36.1' &&
    isolated0361 === '1' &&
    candidate?.bindingId === 'acc-s3r1.1-zkir036'
  );
}
