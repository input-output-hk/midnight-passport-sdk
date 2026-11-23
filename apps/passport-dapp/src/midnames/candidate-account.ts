import { ledger } from '#acc';
import type { CandidateAccountQualification } from './ledger-reader.js';
import { isStandaloneRegistryProfile, registryProfile } from './registry-pins.js';

/** Browser candidate admission is possible only after Vite's exact local build pin. */
export function localCandidateAccount(
  bindingId: string,
  manifestSha256: string,
  profile: string | undefined,
): CandidateAccountQualification | undefined {
  return bindingId === 'acc-s3r1.1-zkir036' &&
    profile !== undefined &&
    isStandaloneRegistryProfile(registryProfile(profile, 'undeployed'))
    ? { bindingId, manifestSha256, decodeState: (state) => ledger(state.data) }
    : undefined;
}
