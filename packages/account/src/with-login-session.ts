import type { PassportConnectorAPI } from '@input-output-hk/mn-passport-protocol';
import type { CredentialPort } from './ports/index.js';

/** A browser may combine discovery and PRF without making the neutral core retain secrets. */
export function withLoginSession(
  credentials: CredentialPort,
  api: PassportConnectorAPI,
): PassportConnectorAPI {
  const withSession = credentials.withLoginSession?.bind(credentials);
  if (!withSession) return api;
  const openAt = api.openAccountAt?.bind(api);
  return {
    ...api,
    openAccount: (options) => withSession(() => api.openAccount(options)),
    ...(openAt && {
      openAccountAt: (address, options) => withSession(() => openAt(address, options)),
    }),
  };
}
