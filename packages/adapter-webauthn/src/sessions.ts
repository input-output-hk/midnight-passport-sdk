import { PassportConnectorError } from '@input-output-hk/mn-passport-account/errors';
import type { PrfKeySource } from '@input-output-hk/mn-passport-account/ports';
import { deriveSymmetricSecret, seedFromRoot } from '@input-output-hk/mn-passport-keys';
import { createPrfOwnership } from './prf-ownership.js';
import type { PasskeyPrfOutputs } from './prf.js';

/** Scoped wallet derivation only: no owner PRF output, raw root or signing capability. */
export interface PasskeyLoginKeys {
  /** Fresh owned copy of the exact Lace root-output wallet seed. Caller zeroes it after use. */
  deriveWalletSeed(): Uint8Array;
}

/** Private, operation-local PRF ownership; no timers, persistence or authenticated-owner lease. */
export function createPasskeySessions(
  load: () => Promise<PasskeyPrfOutputs>,
  checkAccess: () => void = () => {},
) {
  let login: { phase: 'ready' | 'pending' | 'selected' | 'failed' } | undefined;
  const checkLogin = () => {
    if (login && login.phase !== 'selected')
      throw new PassportConnectorError(
        'NotAuthorised',
        'Identify the passkey before using this login’s reader keys.',
      );
  };
  const ownership = createPrfOwnership(load, checkAccess, checkLogin);
  const withScope = async <T>(work: () => Promise<T>): Promise<T> => {
    checkLogin();
    return ownership.withScope(work);
  };
  const prf: PrfKeySource = {
    withSession: (work) =>
      withScope(async () => {
        await ownership.acquire();
        return work();
      }),
    deviceSecret: () => prf.withSession(async () => (await ownership.acquire()).authoriser.slice()),
    deriveSecret: (params) =>
      prf.withSession(async () => {
        const seed = seedFromRoot((await ownership.acquire()).root);
        try {
          return deriveSymmetricSecret(seed, params);
        } finally {
          seed.fill(0);
        }
      }),
  };
  return {
    prf,
    withScope,
    active: () => login !== undefined,
    busy: () => ownership.count() !== 0,
    checkpoint: ownership.checkpoint,
    canBind: () =>
      ownership.count() === 0 || (login?.phase === 'selected' && ownership.count() === 1),
    loginEpoch: () => login,
    checkLoginEpoch(attempt: typeof login) {
      if (attempt && (login !== attempt || attempt.phase !== 'selected'))
        throw new PassportConnectorError('NotAuthorised', 'The login session has ended.');
    },
    readLoginKeys(checkCredential: () => void): PasskeyLoginKeys {
      const attempt = login;
      if (!attempt || attempt.phase !== 'selected' || !ownership.current())
        throw new PassportConnectorError('NotAuthorised', 'No unlocked login keys are available.');
      checkCredential();
      return Object.freeze({
        deriveWalletSeed() {
          const outputs = ownership.current();
          if (login !== attempt || attempt.phase !== 'selected' || !outputs)
            throw new PassportConnectorError('NotAuthorised', 'The login session has ended.');
          checkCredential();
          return seedFromRoot(outputs.root);
        },
      });
    },
    async withLoginSession<T>(work: () => Promise<T>): Promise<T> {
      if (login || ownership.count() !== 0)
        throw new PassportConnectorError('NotAuthorised', 'Another credential session is active.');
      login = { phase: 'ready' };
      try {
        return await ownership.withScope(work);
      } finally {
        ownership.clear();
        login = undefined;
      }
    },
    async identify<T>(get: () => Promise<{ identity: T; outputs: PasskeyPrfOutputs }>): Promise<T> {
      const attempt = login;
      if (!attempt || attempt.phase !== 'ready')
        throw new PassportConnectorError('NotAuthorised', 'This login already selected a passkey.');
      attempt.phase = 'pending';
      try {
        const result = await get();
        if (login !== attempt) {
          result.outputs.authoriser.fill(0);
          result.outputs.root.fill(0);
          throw new PassportConnectorError('NotAuthorised', 'The login session has ended.');
        }
        ownership.install(result.outputs);
        attempt.phase = 'selected';
        return result.identity;
      } catch (error) {
        attempt.phase = 'failed';
        throw error;
      }
    },
  };
}
