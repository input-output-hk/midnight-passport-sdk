import type {
  Authoriser,
  CurvePoint,
  PrfKeySource,
} from '@input-output-hk/mn-passport-account/ports';
import { jubjub } from '@noble/curves/misc.js';
import {
  JUBJUB_ORDER,
  littleEndianScalar,
  signJubjubChallenge,
  type JubjubPointCircuit,
} from './jubjub-signing.js';

/** The two pure circuits needed to identify an enrolled JubJub device. */
export interface JubjubDeviceCircuits extends JubjubPointCircuit {
  derive_device_entry_with_jubjub(
    account: { bytes: Uint8Array },
    pk: CurvePoint,
    epoch: bigint,
    counter: bigint,
  ): Uint8Array;
}

const accountBytes = (account: string): Uint8Array => {
  if (!/^[0-9a-f]{64}$/.test(account)) throw new Error('ACC address must be 32-byte lowercase hex');
  return Uint8Array.from(account.match(/.{2}/g)!, (pair) => Number.parseInt(pair, 16));
};

/**
 * Lace's PRF-output-#1 JubJub authoriser over an injected key source and pinned ACC pure circuits.
 * The PRF copy is cleared after each operation. A host can wrap a whole flow in `withKeySession`
 * so its key source prompts once; the signing scalar is never returned through this port.
 */
export function recipeJubjubAuthoriser(
  source: PrfKeySource,
  pure: JubjubDeviceCircuits,
): Authoriser &
  Required<Pick<Authoriser, 'deviceCommitments' | 'devicePublicKeyHex' | 'withKeySession'>> {
  const withDevice = <T>(work: (sk: bigint, pk: CurvePoint) => T): Promise<T> =>
    source.withSession(async () => {
      const bytes = await source.deviceSecret();
      try {
        if (bytes.length !== 32) throw new Error('the JubJub PRF output must be 32 bytes');
        const sk = littleEndianScalar(bytes) % JUBJUB_ORDER;
        if (sk === 0n) throw new Error('the JubJub PRF output reduced to zero');
        return work(sk, pure.compute_public_point_with_jubjub(sk));
      } finally {
        bytes.fill(0);
      }
    });
  return {
    scheme: 'jubjub-schnorr',
    devicePublicKey: () => withDevice((_sk, pk) => pk),
    devicePublicKeyHex: () =>
      withDevice((_sk, pk) =>
        Array.from(jubjub.Point.fromAffine(pk).toBytes(), (byte) =>
          byte.toString(16).padStart(2, '0'),
        ).join(''),
      ),
    deviceCommitments: (account, epoch, counters) =>
      withDevice((_sk, pk) => {
        const self = { bytes: accountBytes(account) };
        return counters.map((counter) =>
          Array.from(pure.derive_device_entry_with_jubjub(self, pk, epoch, counter), (byte) =>
            byte.toString(16).padStart(2, '0'),
          ).join(''),
        );
      }),
    authorise: (request) =>
      withDevice((sk) => {
        if (!/(?:_with_jubjub|_jubjub)$/.test(request.circuit))
          throw new Error('the requested circuit does not use the JubJub arm');
        if (typeof request.challenge !== 'function')
          throw new Error('JubJub authorisation requires a binding-built challenge');
        return signJubjubChallenge(pure, sk, request.challenge, request.useCounter);
      }),
    withKeySession: (operation) => source.withSession(operation),
  };
}
