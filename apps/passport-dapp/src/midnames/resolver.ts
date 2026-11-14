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
}

const label = '[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?';
const canonicalName = new RegExp(`^(?:${label}\\.)+night$`);
const isContractAddress = (address: string): boolean =>
  address.length === 64 && /^[a-f0-9]{64}$/.test(address);

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
      if (
        networkId !== profile.networkId ||
        name.length > 256 ||
        !canonicalName.test(name) ||
        !name.endsWith(`.${profile.namespace}`)
      )
        throw new PassportNameError('InvalidQuery');
      const target = await reads.readTarget(name, profile);
      if (target === undefined) return undefined;
      if (target.kind !== 'contract' || !target.address || !isContractAddress(target.address))
        throw new PassportNameError('InvalidRecord');
      const accountAddress = target.address;
      if (!(await reads.isSupportedAccount(accountAddress, networkId)))
        throw new PassportNameError('InvalidRecord');
      return Object.freeze({ name, networkId, accountAddress, namespace: profile.namespace });
    },
  });
}

/** An operator-supplied public observation pins every lookup to a known ACC. */
export function requireKnownMidnamesMapping(
  service: PassportNameService,
  networkId: string,
  name: string,
  accountAddress: string,
): PassportNameService {
  if (
    service.provider.mode !== 'external' ||
    !canonicalName.test(name) ||
    !name.endsWith(`.${service.provider.namespace}`) ||
    !isContractAddress(accountAddress) ||
    !/^[a-z0-9][a-z0-9-]{0,63}$/.test(networkId)
  )
    throw new PassportNameError('InvalidQuery');
  const known = Object.freeze({ name, networkId });
  return Object.freeze({
    provider: service.provider,
    async resolve(query: Parameters<PassportNameService['resolve']>[0]) {
      if (query.networkId !== networkId) throw new PassportNameError('InvalidQuery');
      // Do not cache: a missing, transferred, or unavailable observation must
      // stop later lookups, including those for a different name.
      const observed = await resolvePassportName(service, known);
      if (!observed || observed.accountAddress !== accountAddress)
        throw new PassportNameError('InvalidRecord');
      return query.name === name ? observed : service.resolve(query);
    },
  });
}
