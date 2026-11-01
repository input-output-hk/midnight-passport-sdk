import type {
  GrantBookkeeping,
  AccountViewingKey,
} from '@input-output-hk/mn-passport-account/ports';
import type { GrantScopeInput } from '@input-output-hk/mn-passport-account';

/** A validated host scope may name more grantee schemes than this SDK implements. */
export type HostGrantScope = Omit<GrantScopeInput, 'grantee'> & {
  readonly grantee: { readonly scheme: string; readonly publicKey: string };
};

/** Preserve the authorised scope and refuse unsupported cryptography. A secp256k1
 * public key must never be relabelled as JubJub to satisfy a TypeScript assignment.
 * This maps already-validated host data; it does not parse an untrusted JSON request.
 */
export function toJubjubGrantScope(scope: HostGrantScope): GrantScopeInput {
  if (scope.grantee.scheme !== 'jubjub-schnorr')
    throw new Error('this SDK grant flow requires a JubJub grantee');
  return {
    ...scope,
    grantee: { scheme: 'jubjub-schnorr', publicKey: scope.grantee.publicKey },
  };
}

/** Legacy host records omitted the scheme and denote JubJub. New records may
 * explicitly name a different grantee scheme, even when structural assignment
 * to the older SDK record type would compile.
 */
export type HostGrantBookkeeping = GrantBookkeeping & { readonly granteeScheme?: string };

export function toJubjubGrantBookkeeping(grant: HostGrantBookkeeping): GrantBookkeeping {
  if (grant.granteeScheme !== undefined && grant.granteeScheme !== 'jubjub-schnorr')
    throw new Error('this SDK grant bookkeeping requires a JubJub grantee');
  const { granteeScheme: _scheme, ...bookkeeping } = grant;
  return bookkeeping;
}

/** Wrap the decoded inbox used by SDK grant recovery. Structural compatibility of
 * a host reader does not remove an extra grantee scheme from a returned record.
 */
export function jubjubGrantInbox(
  source: Pick<AccountViewingKey, 'openInbox'>,
): Pick<AccountViewingKey, 'openInbox'> {
  return {
    openInbox: async (...args) => {
      const entries = await source.openInbox(...args);
      for (const entry of entries) {
        if (entry?.kind === 'grant' && (!entry.record || typeof entry.record !== 'object'))
          throw new Error('malformed host grant record');
        if (
          entry?.kind === 'grant' &&
          entry.record.part === 'grant' &&
          'granteeScheme' in entry.record &&
          entry.record.granteeScheme !== undefined &&
          entry.record.granteeScheme !== 'jubjub-schnorr'
        )
          throw new Error('this SDK grant inbox requires a JubJub grantee');
      }
      return entries;
    },
  };
}
