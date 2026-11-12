/** Public purpose only: no credential ID, challenge, PRF output or signature is exposed. */
export interface PasskeyCeremony {
  readonly purpose:
    | 'create'
    | 'verify-created'
    | 'identify'
    | 'identify-and-unlock'
    | 'sign'
    | 'authenticate-grant-relay'
    | 'request-browser-grant'
    | 'derive-keys';
  readonly rpId: string;
  /** One-based assertion attempt; a known browser-profile retry is a new ceremony. */
  readonly attempt: number;
}

/** The host explains the purpose before browser access. Throwing refuses that access. */
export type BeforePasskeyCeremony = (ceremony: Readonly<PasskeyCeremony>) => void | Promise<void>;

export interface PasskeyCeremonyOptions {
  readonly beforeCeremony?: BeforePasskeyCeremony | undefined;
}

export async function beforePasskeyCeremony(
  options: PasskeyCeremonyOptions & { readonly rpId: string },
  purpose: PasskeyCeremony['purpose'],
  attempt = 1,
): Promise<void> {
  await options.beforeCeremony?.(Object.freeze({ purpose, rpId: options.rpId, attempt }));
}
