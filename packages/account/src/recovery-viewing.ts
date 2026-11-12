import { z } from 'zod';
import { toHex } from './codec.js';
import { PassportConnectorError } from './errors.js';
import { AccountContextSchema } from './validation.js';

const viewingTarget = AccountContextSchema.unwrap()
  .strict()
  .extend({
    attemptId: z.string().regex(/^[0-9a-f]{32}$/),
    successorEntry: z.string().regex(/^[0-9a-f]{64}$/),
    sessionId: z.string().regex(/^[0-9a-f]{64}$/),
    viewingPublicKey: z.string().regex(/^[0-9a-f]{64}$/),
  })
  .readonly();
export type RecoveryViewingTarget = z.input<typeof viewingTarget>;

export interface RecoveryViewingCustody {
  readonly derivePublicKey: (viewingKey: Uint8Array) => Uint8Array;
  /** Store in the successor's private custody and return an owned read-back buffer. */
  stageAndReadBack(
    target: Readonly<RecoveryViewingTarget>,
    viewingKey: Uint8Array,
  ): Promise<Uint8Array>;
}

const invalidKey = () =>
  new PassportConnectorError(
    'EncryptionKeyMismatch',
    'The recovered key differs from the account viewing key.',
  );

/** Verify the recovered key and successor custody before permitting later recovery effects. */
export async function stageRecoveryViewingKey(
  input: RecoveryViewingTarget,
  ownedKey: Uint8Array,
  custody: RecoveryViewingCustody,
  assertCurrent: (target: Readonly<RecoveryViewingTarget>) => Promise<void>,
): Promise<void> {
  let persisted: Uint8Array | undefined;
  try {
    const target = viewingTarget.parse(input);
    if (
      ownedKey.length !== 32 ||
      toHex(custody.derivePublicKey(ownedKey)) !== target.viewingPublicKey
    )
      throw invalidKey();
    await assertCurrent(target);
    persisted = await custody.stageAndReadBack(target, ownedKey);
    if (
      persisted.length !== 32 ||
      toHex(custody.derivePublicKey(persisted)) !== target.viewingPublicKey ||
      !persisted.every((byte, index) => byte === ownedKey[index])
    )
      throw invalidKey();
    await assertCurrent(target);
  } finally {
    ownedKey.fill(0);
    persisted?.fill(0);
  }
}
