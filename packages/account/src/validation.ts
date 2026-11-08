/** Canonical boundary values. A brand proves parsing, not chain ownership or authority. */
import { z } from 'zod';

const hex32 = z.string().regex(/^[0-9a-f]{64}$/);
export const AccountAddressSchema = hex32.brand<'PassportAccountAddress'>();
export type AccountAddress = z.infer<typeof AccountAddressSchema>;
export const AssetIdSchema = hex32.brand<'PassportAssetId'>();
export type AssetId = z.infer<typeof AssetIdSchema>;
export const RecipientSchema = hex32.brand<'PassportRecipient'>();
export type Recipient = z.infer<typeof RecipientSchema>;
export const NetworkIdSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/)
  .brand<'PassportNetworkId'>();
export type NetworkId = z.infer<typeof NetworkIdSchema>;
export const BindingIdSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/)
  .brand<'PassportBindingId'>();
export type BindingId = z.infer<typeof BindingIdSchema>;

/** Bound text before BigInt conversion. No coercion, rounding, whitespace or exponential notation. */
export const AmountSchema = z
  .string()
  .max(39)
  .regex(/^[1-9][0-9]*$/)
  .refine(
    (value) => value.length <= 39 && /^[1-9][0-9]*$/.test(value) && BigInt(value) < 1n << 128n,
  )
  .brand<'PassportPositiveU128'>();
export type Amount = z.infer<typeof AmountSchema>;

// Existing API tolerates extra public fields. Parse copies only the accepted fields.
export const UnshieldedWithdrawalSchema = z.object({
  color: AssetIdSchema,
  amount: AmountSchema,
  recipient: RecipientSchema,
});

export const AccountContextSchema = z
  .object({
    account: AccountAddressSchema,
    networkId: NetworkIdSchema,
    bindingId: BindingIdSchema,
  })
  .readonly();
export type AccountContext = z.infer<typeof AccountContextSchema>;
