import type { CredentialPort } from './ports/index.js';

type Trace = <T>(
  name: string,
  input: unknown,
  work: () => Promise<T>,
  verify?: boolean,
) => Promise<T>;

/** Preserve credential-session ownership even for prototype methods and receiver-bound hosts. */
export function durableCredentials(source: CredentialPort, trace: Trace): CredentialPort {
  const withLoginSession = source.withLoginSession?.bind(source);
  return {
    ...source,
    ...(withLoginSession && { withLoginSession }),
    create: (user) => trace('credential.create', user, () => source.create(user)),
    identify: async () => {
      const identity = await source.identify();
      await trace(
        'credential.identify',
        {},
        async () => ({ credentialId: identity.credentialId }),
        true,
      );
      return identity;
    },
  };
}
