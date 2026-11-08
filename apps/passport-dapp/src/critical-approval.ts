import {
  createAuthenticatedJubjubOwner,
  seedFromRoot,
  type AuthenticatedJubjubOwner,
  type JubjubDeviceCircuits,
} from '@input-output-hk/mn-passport-keys';
import type { RoutineAccount } from './routine-keys.js';

/** Fresh presence for a reviewed owner action; never replaces or extends the approved lease. */
export async function verifyCriticalOwner(input: {
  account: RoutineAccount;
  owner: AuthenticatedJubjubOwner;
  check(): void;
  unlock(): Promise<{ authoriser: Uint8Array; root: Uint8Array }>;
  pure(): Promise<JubjubDeviceCircuits>;
}) {
  const context = input.owner.context;
  const credential = input.account.credentialId;
  if (
    input.account.address !== context.account ||
    input.account.networkId !== context.networkId ||
    input.account.bindingId !== context.bindingId ||
    !credential ||
    credential.length !== context.credentialId.length ||
    !credential.every((byte, index) => byte === context.credentialId[index])
  )
    throw new Error('The reviewed account does not match the authenticated owner.');
  input.check();
  input.owner.check();
  const pure = await input.pure();
  input.check();
  input.owner.check();
  const output = await input.unlock();
  let seed: Uint8Array | undefined;
  let proof: AuthenticatedJubjubOwner | undefined;
  try {
    input.check();
    input.owner.check();
    seed = seedFromRoot(output.root);
    proof = createAuthenticatedJubjubOwner({
      context: input.owner.context,
      authoriser: output.authoriser,
      walletSeed: seed,
      pure,
      companionReader: input.account.scheme !== 'jubjub-schnorr',
      check: input.check,
    });
    if (
      proof.publicKey !== input.owner.publicKey ||
      proof.readerPublicKey !== input.owner.readerPublicKey
    )
      throw new Error('The fresh passkey does not match the reviewed account owner.');
    input.check();
  } finally {
    proof?.dispose();
    seed?.fill(0);
    output.authoriser.fill(0);
    output.root.fill(0);
  }
}
