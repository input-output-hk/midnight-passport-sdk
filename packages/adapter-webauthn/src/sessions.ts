import { PassportConnectorError } from '@input-output-hk/mn-passport-account/errors';
import type { PrfKeySource } from '@input-output-hk/mn-passport-account/ports';
import { deriveSymmetricSecret, seedFromRoot } from '@input-output-hk/mn-passport-keys';
import type { PasskeyPrfOutputs } from './prf.js';

/** Private, operation-local PRF ownership; no timers, persistence or authenticated-owner lease. */
export function createPasskeySessions(load: () => Promise<PasskeyPrfOutputs>) {
  let outputs: PasskeyPrfOutputs | undefined;
  let pending: Promise<PasskeyPrfOutputs> | undefined;
  let users = 0;
  let login: { phase: 'ready' | 'pending' | 'selected' | 'failed' } | undefined;
  const zero = (value: PasskeyPrfOutputs) => {
    value.authoriser.fill(0);
    value.root.fill(0);
  };
  const release = () => {
    users--;
    if (users === 0 && outputs) {
      zero(outputs);
      outputs = undefined;
    }
  };
  const prf: PrfKeySource = {
    async withSession<T>(work: () => Promise<T>): Promise<T> {
      users++;
      try {
        if (!outputs) {
          if (login)
            throw new PassportConnectorError(
              'NotAuthorised',
              'Identify the passkey before using this login’s reader keys.',
            );
          pending ??= load().finally(() => {
            pending = undefined;
          });
          outputs = await pending;
        }
        return await work();
      } finally {
        release();
      }
    },
    async deviceSecret() {
      if (!outputs) return prf.withSession(() => prf.deviceSecret());
      return outputs.authoriser.slice();
    },
    async deriveSecret({ domain, context, length }) {
      if (!outputs)
        return prf.withSession(() =>
          prf.deriveSecret({ domain, context, ...(length === undefined ? {} : { length }) }),
        );
      const seed = seedFromRoot(outputs.root);
      try {
        return deriveSymmetricSecret(seed, {
          domain,
          context,
          ...(length === undefined ? {} : { length }),
        });
      } finally {
        seed.fill(0);
      }
    },
  };
  return {
    prf,
    active: () => login !== undefined,
    async withLoginSession<T>(work: () => Promise<T>): Promise<T> {
      if (login || users !== 0 || pending)
        throw new PassportConnectorError('NotAuthorised', 'Another credential session is active.');
      login = { phase: 'ready' };
      users++;
      try {
        return await work();
      } finally {
        // A host must await its work, but an abandoned child must not extend login custody.
        if (outputs) {
          zero(outputs);
          outputs = undefined;
        }
        login = undefined;
        release();
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
          zero(result.outputs);
          throw new PassportConnectorError('NotAuthorised', 'The login session has ended.');
        }
        outputs = result.outputs;
        attempt.phase = 'selected';
        return result.identity;
      } catch (error) {
        attempt.phase = 'failed';
        throw error;
      }
    },
  };
}
