import { webauthnPasskey } from '@input-output-hk/mn-passport-adapter-webauthn';
import {
  recipeJubjubAuthoriser,
  type JubjubDeviceCircuits,
} from '@input-output-hk/mn-passport-keys';
import { accModule } from './acc-module.js';

/** A separate passkey for a grant holder; only its public JubJub key leaves this function. */
export async function prepareGranteePasskey(options: {
  rpId: string;
  origin: string;
  credentials?: CredentialsContainer;
}): Promise<string> {
  const passkey = webauthnPasskey(options);
  await passkey.credentials.create({ name: 'Midnight Passport grant holder' });
  const pure = accModule.pureCircuits;
  if (
    typeof pure.compute_public_point_with_jubjub !== 'function' ||
    typeof pure.derive_device_entry_with_jubjub !== 'function'
  )
    throw new Error('The pinned ACC binding cannot derive a JubJub grantee key.');
  const grantee = recipeJubjubAuthoriser(passkey.prf, pure as JubjubDeviceCircuits);
  const publicKey = await grantee.devicePublicKeyHex();
  if (!/^[0-9a-f]{64}$/.test(publicKey))
    throw new Error('The grant-holder passkey did not produce a JubJub public key.');
  return publicKey;
}
