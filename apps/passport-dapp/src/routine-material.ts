import { seedFromRoot } from '@input-output-hk/mn-passport-keys';
import type { RoutineAccount } from './routine-keys.js';

export interface RoutineMaterial {
  seed: Uint8Array;
  ownerSecret?: Uint8Array;
}
export async function unlockRoutineMaterial(
  get: () => Promise<{ root: Uint8Array; authoriser: Uint8Array }>,
  fullOwner: boolean,
): Promise<RoutineMaterial> {
  const output = await get();
  try {
    return {
      seed: seedFromRoot(output.root),
      ...(fullOwner && { ownerSecret: Uint8Array.from(output.authoriser) }),
    };
  } finally {
    output.root.fill(0);
    output.authoriser.fill(0);
  }
}
/** One-use approval consumes and clears the supplied seed, even on a stale or failed adoption. */
export function prepareRoutineLogin(ports: {
  lock(): void;
  revision(): number;
  activate(
    account: RoutineAccount,
    minutes: number,
    rpId: string,
    origin: string,
    load: () => Promise<RoutineMaterial>,
  ): Promise<void>;
}) {
  ports.lock();
  const version = ports.revision();
  let consumed = false;
  return async (
    account: RoutineAccount,
    walletSeed: Uint8Array,
    minutes: number,
    rpId: string,
    origin: string,
  ) => {
    const admitted = Uint8Array.from(walletSeed);
    try {
      if (consumed || ports.revision() !== version)
        throw new Error('Login key adoption was cancelled or superseded.');
      consumed = true;
      await ports.activate(account, minutes, rpId, origin, async () => ({
        seed: Uint8Array.from(admitted),
      }));
    } finally {
      admitted.fill(0);
      walletSeed.fill(0);
    }
  };
}

export function checkedRoutineSeed(seed: Uint8Array): Uint8Array {
  if (!(seed instanceof Uint8Array) || seed.length !== 64) {
    if (seed instanceof Uint8Array) seed.fill(0);
    throw new Error('Invalid routine wallet seed.');
  }
  return seed;
}
