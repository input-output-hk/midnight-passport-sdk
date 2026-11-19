import {
  PassportNameError,
  resolvePassportName,
  type PassportNameService,
} from '@input-output-hk/mn-passport-account/names';

export interface MidnamesProfile {
  readonly networkId: string;
  readonly namespace: string;
  readonly registryAddress: string;
}

/** The provider must read the specified network and registry on every call. */
export interface MidnamesReads {
  readTarget(
    name: string,
    profile: Readonly<MidnamesProfile>,
  ): Promise<{ readonly kind: 'contract' | 'other'; readonly address?: string } | undefined>;
  isSupportedAccount(address: string, networkId: string): Promise<boolean>;
  /** Optional atomic read: target and ACC binding are checked at one provider block. */
  readSupportedTarget?(
    name: string,
    profile: Readonly<MidnamesProfile>,
  ): Promise<{ readonly kind: 'contract' | 'other'; readonly address?: string } | undefined>;
}

const label = '[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?';
const canonicalName = new RegExp(`^(?:${label}\\.)+night$`);
const isContractAddress = (address: string): boolean =>
  address.length === 64 && /^[a-f0-9]{64}$/.test(address);
const canonicalQuery = (
  name: unknown,
  requestedNetwork: unknown,
  networkId: string,
  namespace: string,
): name is string =>
  requestedNetwork === networkId &&
  typeof name === 'string' &&
  name.length <= 256 &&
  canonicalName.test(name) &&
  name.endsWith(`.${namespace}`);

export function createMidnamesNameService(
  input: MidnamesProfile,
  reads: MidnamesReads,
): PassportNameService {
  const profile = Object.freeze({ ...input });
  if (
    !isContractAddress(profile.registryAddress) ||
    !/^[a-z0-9][a-z0-9-]{0,63}$/.test(profile.networkId) ||
    (profile.namespace !== 'night' &&
      (!canonicalName.test(profile.namespace) || !profile.namespace.endsWith('.night'))) ||
    profile.namespace.length > 128
  )
    throw new PassportNameError('InvalidQuery');

  const provider = Object.freeze({
    id: `midnames:${profile.registryAddress}`,
    namespace: profile.namespace,
    mode: 'external' as const,
  });
  return Object.freeze({
    provider,
    async resolve(query: Parameters<PassportNameService['resolve']>[0]) {
      const { name, networkId } = query;
      if (!canonicalQuery(name, networkId, profile.networkId, profile.namespace))
        throw new PassportNameError('InvalidQuery');
      const atomic = reads.readSupportedTarget;
      const target = atomic
        ? await atomic.call(reads, name, profile)
        : await reads.readTarget(name, profile);
      if (target === undefined) return undefined;
      if (target.kind !== 'contract' || !target.address || !isContractAddress(target.address))
        throw new PassportNameError('InvalidRecord');
      const accountAddress = target.address;
      if (!atomic && !(await reads.isSupportedAccount(accountAddress, networkId)))
        throw new PassportNameError('InvalidRecord');
      return Object.freeze({ name, networkId, accountAddress, namespace: profile.namespace });
    },
  });
}

/** Refuse a stale or divergent read instead of choosing one indexer's destination. */
export function requireAgreeingMidnamesResolvers(
  primary: PassportNameService,
  witness: PassportNameService,
): PassportNameService {
  if (
    primary.provider.mode !== 'external' ||
    witness.provider.mode !== 'external' ||
    primary.provider.id !== witness.provider.id ||
    primary.provider.namespace !== witness.provider.namespace
  )
    throw new PassportNameError('InvalidQuery');
  const provider = Object.freeze({ ...primary.provider });
  const sameProvider = () =>
    [primary.provider, witness.provider].every(
      (current) =>
        current.mode === provider.mode &&
        current.id === provider.id &&
        current.namespace === provider.namespace,
    );
  return Object.freeze({
    provider,
    async resolve(query: Parameters<PassportNameService['resolve']>[0]) {
      if (!sameProvider()) throw new PassportNameError('Unavailable');
      const exact = Object.freeze({ name: query.name, networkId: query.networkId });
      const [first, second] = await Promise.all([
        resolvePassportName(primary, exact),
        resolvePassportName(witness, exact),
      ]);
      if (!sameProvider()) throw new PassportNameError('Unavailable');
      if (first === undefined && second === undefined) return undefined;
      if (
        first === undefined ||
        second === undefined ||
        first.providerId !== provider.id ||
        second.providerId !== provider.id ||
        first.accountAddress !== second.accountAddress ||
        first.expiresAt !== second.expiresAt
      )
        throw new PassportNameError('Unavailable');
      return Object.freeze({
        name: first.name,
        networkId: first.networkId,
        namespace: first.namespace,
        accountAddress: first.accountAddress,
        ...(first.expiresAt !== undefined && { expiresAt: first.expiresAt }),
      });
    },
  });
}

/** An operator-supplied public mapping gates every lookup before resolving its requested name. */
export function requireKnownMidnamesMapping(
  service: PassportNameService,
  networkId: string,
  name: string,
  accountAddress: string,
): PassportNameService {
  if (
    service.provider.mode !== 'external' ||
    !canonicalQuery(name, networkId, networkId, service.provider.namespace) ||
    !isContractAddress(accountAddress) ||
    !/^[a-z0-9][a-z0-9-]{0,63}$/.test(networkId)
  )
    throw new PassportNameError('InvalidQuery');
  const known = Object.freeze({ name, networkId });
  return Object.freeze({
    provider: service.provider,
    async resolve(query: Parameters<PassportNameService['resolve']>[0]) {
      if (!canonicalQuery(query.name, query.networkId, networkId, service.provider.namespace))
        throw new PassportNameError('InvalidQuery');
      // Do not cache: a missing, transferred, or unavailable observation must
      // stop later lookups, including those for a different name.
      const observed = await resolvePassportName(service, known);
      if (!observed || observed.accountAddress !== accountAddress)
        throw new PassportNameError('InvalidRecord');
      return query.name === name ? observed : service.resolve(query);
    },
  });
}
