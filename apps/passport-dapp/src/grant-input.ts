import { MidnightBech32m, UnshieldedAddress } from '@midnightntwrk/wallet-sdk-address-format';
import { granteePoint } from '@input-output-hk/mn-passport-account';
import type { GrantScopeInput } from '@input-output-hk/mn-passport-protocol';

const U128 = (1n << 128n) - 1n;
const amount = (name: string, value: string): bigint => {
  if (!/^[1-9][0-9]*$/.test(value)) throw new Error(`${name} must be a positive whole number.`);
  const parsed = BigInt(value);
  if (parsed > U128) throw new Error(`${name} exceeds the ACC amount limit.`);
  return parsed;
};

/** The demo exposes one purposefully narrow grant: fixed recipient, asset and spend caps. */
export function fixedUnshieldedGrant(
  networkId: string,
  input: {
    grantee: string;
    color: string;
    recipient: string;
    perCallCap: string;
    cap: string;
    maxDemoCall: string;
  },
): GrantScopeInput {
  if (!/^[0-9a-f]{64}$/.test(input.grantee)) throw new Error('Enter a JubJub grantee public key.');
  granteePoint(input.grantee);
  if (!/^[0-9a-f]{64}$/.test(input.color)) throw new Error('Select a valid asset.');
  const perCall = amount('Per-call cap', input.perCallCap);
  const total = amount('Total cap', input.cap);
  if (perCall > total) throw new Error('The per-call cap exceeds the total cap.');
  if (perCall > amount('Demo call limit', input.maxDemoCall))
    throw new Error('The per-call cap exceeds the demo value service limit.');
  let recipient: string;
  try {
    recipient = MidnightBech32m.parse(input.recipient).decode(
      UnshieldedAddress,
      networkId,
    ).hexString;
  } catch {
    throw new Error(`Enter an unshielded Midnight recipient for ${networkId}.`);
  }
  return {
    grantee: { scheme: 'jubjub-schnorr', publicKey: input.grantee },
    operations: ['withdraw-unshielded'],
    color: input.color,
    recipient: { kind: 'user-address', value: recipient },
    maxCoinValue: input.cap,
    perCallCap: input.perCallCap,
    cap: input.cap,
    expiresAt: null,
  };
}
