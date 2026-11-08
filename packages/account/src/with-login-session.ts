import type { PassportAccount, PassportConnectorAPI } from '@input-output-hk/mn-passport-protocol';
import type { CredentialPort } from './ports/index.js';

/** A browser may combine discovery and PRF without making the neutral core retain secrets. */
export function withLoginSession(
  credentials: CredentialPort,
  api: PassportConnectorAPI,
  onAccountOpened?: (account: PassportAccount) => Promise<void>,
): PassportConnectorAPI {
  const withSession = credentials.withLoginSession?.bind(credentials);
  if (!withSession && !onAccountOpened) return api;
  const opened = async (open: () => Promise<PassportAccount>): Promise<PassportAccount> => {
    const account = await open();
    await onAccountOpened?.(account);
    return account;
  };
  const login = (open: () => Promise<PassportAccount>): Promise<PassportAccount> =>
    withSession ? withSession(() => opened(open)) : opened(open);
  const openAt = api.openAccountAt?.bind(api);
  return {
    ...api,
    openAccount: (options) => login(() => api.openAccount(options)),
    ...(openAt && {
      openAccountAt: (address, options) => login(() => openAt(address, options)),
    }),
  };
}
