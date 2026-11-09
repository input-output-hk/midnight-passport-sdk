import type { PassportAccount } from '@input-output-hk/mn-passport-protocol';
import type {
  PasskeyLoginKeys,
  webauthnPasskey,
} from '@input-output-hk/mn-passport-adapter-webauthn';

type Handoff = (account: PassportAccount, keys: PasskeyLoginKeys) => Promise<void>;
/** Host opt-in callbacks; authenticated-owner compositions never acquire browser credentials. */
export function browserKeyHandoffs(
  owner: boolean,
  passkey: ReturnType<typeof webauthnPasskey>,
  opened?: Handoff,
  created?: Handoff,
) {
  if (owner) return {};
  return {
    ...(opened && {
      onAccountOpened: (account: PassportAccount) =>
        opened(account, passkey.readLoginKeys(account.credentialId)),
    }),
    ...(created && {
      onAccountCreated: (account: PassportAccount) =>
        created(account, passkey.readCreationKeys(account.credentialId)),
    }),
  };
}
