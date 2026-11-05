import { passkeyPrf } from '@input-output-hk/mn-passport-adapter-webauthn';
import {
  createSessionJubjubAuthoriser,
  deriveSymmetricSecret,
  seedFromRoot,
  type JubjubDeviceCircuits,
  type SessionKeyContext,
} from '@input-output-hk/mn-passport-keys';
import type { PassportAccount } from '@input-output-hk/mn-passport-protocol';
import { accModule } from './acc-module.js';
import { beforeDemoCeremony } from './consent.js';
import { RP_ID } from './connector.js';

/** Pin the PRF ceremony to the open account; discard both raw PRF outputs immediately. */
export async function unlockDemoSessionKey(account: PassportAccount, context: SessionKeyContext) {
  if (!account.credentialId) throw new Error('A passkey-backed account is required.');
  const outputs = await passkeyPrf({
    credentialId: account.credentialId,
    rpId: RP_ID,
    beforeCeremony: beforeDemoCeremony,
  });
  try {
    return await createSessionJubjubAuthoriser(
      {
        withSession: (work) => work(),
        deviceSecret: async () => {
          throw new Error('The session must never use an owner key.');
        },
        deriveSecret: async (params) => {
          const seed = seedFromRoot(outputs.root);
          try {
            return deriveSymmetricSecret(seed, params);
          } finally {
            seed.fill(0);
          }
        },
      },
      accModule.pureCircuits as JubjubDeviceCircuits,
      context,
    );
  } finally {
    outputs.authoriser.fill(0);
    outputs.root.fill(0);
  }
}
