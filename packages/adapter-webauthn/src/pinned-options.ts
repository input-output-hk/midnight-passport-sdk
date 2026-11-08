import type { PasskeyCeremonyOptions } from './ceremony.js';

type Options = PasskeyCeremonyOptions & {
  rpId: string;
  origin: string;
  credentials?: CredentialsContainer;
};

/** Capture methods with their native receiver before async host ceremony approval. */
export function pinnedPasskeyOptions(options: Options, checkpoint: () => () => void): Options {
  const { rpId, origin, beforeCeremony, credentials } = options;
  let held:
    | {
        receiver: CredentialsContainer;
        get: CredentialsContainer['get'];
        create: CredentialsContainer['create'];
      }
    | undefined;
  const pin = () => {
    if (!held) {
      const receiver = credentials ?? navigator.credentials;
      held = { receiver, get: receiver.get.bind(receiver), create: receiver.create.bind(receiver) };
    }
    return held;
  };
  return {
    rpId,
    origin,
    credentials: {
      get: (request) => pin().get(request),
      create: (request) => pin().create(request),
      store: (credential) => pin().receiver.store(credential),
      preventSilentAccess: () => pin().receiver.preventSilentAccess(),
    },
    async beforeCeremony(ceremony) {
      pin();
      const check = checkpoint();
      await beforeCeremony?.(ceremony);
      check();
    },
  };
}
