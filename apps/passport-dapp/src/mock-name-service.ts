import type {
  PassportNameQuery,
  PassportNameService,
} from '@input-output-hk/mn-passport-account/ports';

/** Synthetic records only: neither fixture denotes an account deployed by this demo. */
export function createMockNameService(networkId: string): PassportNameService {
  const addresses = new Map([
    ['alice.passport.test', '11'.repeat(32)],
    ['bob.passport.test', '22'.repeat(32)],
  ]);
  return Object.freeze({
    provider: Object.freeze({
      id: 'demo-memory',
      namespace: 'passport-demo',
      mode: 'mock' as const,
    }),
    async resolve(query: PassportNameQuery) {
      const accountAddress = addresses.get(query.name);
      return query.networkId === networkId && accountAddress
        ? Object.freeze({ ...query, namespace: 'passport-demo', accountAddress })
        : undefined;
    },
  });
}
