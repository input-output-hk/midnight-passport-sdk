import { PassportConnectorError } from '@input-output-hk/mn-passport-account/errors';
import type { PasskeyPrfOutputs } from './prf.js';

const unavailable = () =>
  new PassportConnectorError('NotAuthorised', 'The credential scope has ended.');
const zero = (value: PasskeyPrfOutputs) => {
  value.authoriser.fill(0);
  value.root.fill(0);
};
interface Epoch {
  ended: boolean;
  outputs?: PasskeyPrfOutputs;
  pending?: Promise<void>;
  failure?: { error: unknown };
}

/** Internal shared ownership; entering a scope alone does not acquire PRF material. */
export function createPrfOwnership(
  load: () => Promise<PasskeyPrfOutputs>,
  checkAccess: () => void,
  checkLoad: () => void,
) {
  let users = 0;
  let epoch: Epoch = { ended: false };
  const clear = (held: Epoch) => {
    held.ended = true;
    if (held.outputs) zero(held.outputs);
    delete held.outputs;
  };
  const check = () => {
    checkAccess();
    if (epoch.ended) throw unavailable();
    if (epoch.failure) throw epoch.failure.error;
  };
  const withScope = async <T>(work: () => Promise<T>): Promise<T> => {
    checkAccess();
    if (users === 0) epoch = { ended: false };
    check();
    const held = epoch;
    users++;
    try {
      return await work();
    } finally {
      users--;
      if (users === 0) clear(held);
    }
  };
  const acquire = async (): Promise<PasskeyPrfOutputs> => {
    check();
    const held = epoch;
    if (!held.outputs) {
      checkLoad();
      if (!held.pending) {
        let result: Promise<PasskeyPrfOutputs>;
        try {
          result = load();
        } catch (error) {
          held.failure = { error };
          throw error;
        }
        const pending = result
          .then((value) => {
            if (epoch !== held || held.ended || users === 0) {
              zero(value);
              throw unavailable();
            }
            held.outputs = value;
          })
          .catch((error: unknown) => {
            held.failure = { error };
            throw error;
          })
          .finally(() => {
            if (held.pending === pending) delete held.pending;
          });
        held.pending = pending;
      }
      await held.pending;
    }
    check();
    if (!held.outputs) throw unavailable();
    return held.outputs;
  };
  return {
    withScope,
    acquire,
    count: () => users,
    checkpoint() {
      const held = users === 0 ? undefined : epoch;
      return () => {
        if (!held) return;
        if (epoch !== held || held.ended) throw unavailable();
        if (held.failure) throw held.failure.error;
      };
    },
    current: () => epoch.outputs,
    install(value: PasskeyPrfOutputs) {
      if (epoch.ended || users === 0) {
        zero(value);
        throw unavailable();
      }
      if (epoch.outputs) zero(epoch.outputs);
      epoch.outputs = value;
    },
    clear: () => clear(epoch),
  };
}
