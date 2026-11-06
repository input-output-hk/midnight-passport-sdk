import { passkeyPrf } from '@input-output-hk/mn-passport-adapter-webauthn';
import type { JubjubDeviceCircuits } from '@input-output-hk/mn-passport-keys';
import { beforeDemoCeremony } from './consent.js';
import { createRoutineKeys } from './routine-keys.js';

export const routineKeys = createRoutineKeys({
  unlock: (account, rpId) =>
    passkeyPrf({ credentialId: account.credentialId!, rpId, beforeCeremony: beforeDemoCeremony }),
  pure: async () =>
    (await import('./acc-module.js')).accModule.pureCircuits as JubjubDeviceCircuits,
});
