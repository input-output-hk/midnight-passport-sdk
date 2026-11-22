import {
  getContractLedger,
  getTargetFromDomainData,
  queryContractState,
  resolveDomainIdInLedger,
} from '@midnames/sdk/core';
import { createDefaultProvider } from '@midnames/sdk/provider';
import { requireMidnamesV4IndexerPair } from './indexer-endpoints.js';
import { ContractState } from '@midnight-ntwrk/compact-runtime';
import { PassportNameError } from '@input-output-hk/mn-passport-account/names';
import {
  ACC_REGISTRY,
  detectDeployedVersionByCircuit,
  resolveBinding,
  type AccRegistry,
} from '@input-output-hk/mn-passport-contract';
import { ledger } from '#acc';
import type { MidnamesProfile, MidnamesReads } from './resolver.js';
import {
  MIDNAMES_REGISTRY_VERIFIERS,
  STANDALONE_REGISTRY_VERIFIERS,
  registryProfile,
  type MidnamesRegistryProfile,
} from './registry-pins.js';

type RegistryProvider = Parameters<typeof getContractLedger>[0];
type DomainRecord = Parameters<typeof getTargetFromDomainData>[0];
type DomainTarget = NonNullable<Awaited<ReturnType<MidnamesReads['readTarget']>>>;

function readDomainTarget(domain: DomainRecord): DomainTarget {
  try {
    const resolved = getTargetFromDomainData(domain);
    return resolved.type === 'contract'
      ? { kind: 'contract', address: resolved.address }
      : { kind: 'other' };
  } catch {
    throw new PassportNameError('InvalidRecord');
  }
}

const hex = (value: Uint8Array): string =>
  Array.from(value, (byte) => byte.toString(16).padStart(2, '0')).join('');
const ADDRESS = /^[a-f0-9]{64}$/;

async function sha256(value: Uint8Array): Promise<string> {
  return hex(new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(value))));
}

interface VerifierState {
  operations(): readonly unknown[];
  operation(name: string): { readonly verifierKey: Uint8Array } | undefined;
}

async function matchesVerifiers(
  state: VerifierState,
  entries: ReadonlyMap<string, string>,
): Promise<boolean> {
  if (!entries.size || state.operations().length !== entries.size) return false;
  for (const [name, expected] of entries) {
    const verifier = state.operation(name)?.verifierKey;
    if (!verifier || (await sha256(verifier)) !== expected) return false;
  }
  return true;
}

/** Identify a deployed ACC from its complete circuit-to-verifier assignment. */
export async function detectAccBindingFromState(
  state: VerifierState,
  registry: AccRegistry = ACC_REGISTRY,
): Promise<string | null> {
  const observed: Record<string, string> = Object.create(null);
  const rawNames = state.operations();
  if (!rawNames.length) return null;
  for (const raw of rawNames) {
    let name: string;
    try {
      name =
        typeof raw === 'string'
          ? raw
          : raw instanceof Uint8Array
            ? new TextDecoder('utf-8', { fatal: true }).decode(raw)
            : '';
    } catch {
      return null;
    }
    if (!/^[a-z][a-z0-9_]*$/.test(name) || Object.hasOwn(observed, name)) return null;
    const verifier = state.operation(name)?.verifierKey;
    if (!verifier) return null;
    observed[name] = await sha256(verifier);
  }
  return detectDeployedVersionByCircuit(observed, registry);
}

export function createMidnamesLedgerReads(
  provider: RegistryProvider,
  networkId: string,
  bindingId: string,
  profileId: MidnamesRegistryProfile = 'midnames-2.1.0',
): MidnamesReads & {
  readSupportedTarget(
    name: string,
    profile: Readonly<MidnamesProfile>,
  ): Promise<DomainTarget | undefined>;
  hasDomain(name: string, profile: Readonly<MidnamesProfile>): Promise<boolean>;
  readSupportedNightBalance(address: string, requestedNetwork: string): Promise<bigint | undefined>;
  readClaim(
    name: string,
    profile: Readonly<MidnamesProfile>,
  ): Promise<{ readonly ownerCommitment: string; readonly target: DomainTarget } | undefined>;
} {
  const pinnedProfile = registryProfile(profileId, networkId);
  const registryVerifiers = new Map(
    Object.entries(
      pinnedProfile === 'standalone-0.35'
        ? STANDALONE_REGISTRY_VERIFIERS
        : MIDNAMES_REGISTRY_VERIFIERS,
    ),
  );
  resolveBinding(bindingId);
  const readDomain = async (
    name: string,
    profile: Readonly<MidnamesProfile>,
    source: RegistryProvider = provider,
  ) => {
    if (profile.networkId !== networkId) throw new PassportNameError('InvalidQuery');
    // Check the registry fingerprint and resolve from the same observed state.
    const observed = await source.queryContractState(profile.registryAddress);
    if (!observed) throw new PassportNameError('Unavailable');
    const snapshot: RegistryProvider = {
      ...source,
      async queryContractState(address) {
        if (address !== profile.registryAddress) throw new PassportNameError('InvalidQuery');
        return observed;
      },
    };
    const state = await queryContractState(snapshot, profile.registryAddress);
    if (!state.success) throw new PassportNameError('Unavailable');
    if (!(await matchesVerifiers(state.data, registryVerifiers)))
      throw new PassportNameError('InvalidRecord');

    const registry = await getContractLedger(snapshot, profile.registryAddress);
    if (!registry.success || registry.data.TLD !== 'night')
      throw new PassportNameError('InvalidRecord');
    const id = resolveDomainIdInLedger(registry.data, name);
    if (id === null) return undefined;
    if (!registry.data.id_to_data.member(id)) throw new PassportNameError('InvalidRecord');
    return registry.data.id_to_data.lookup(id);
  };
  const readClaim = async (name: string, profile: Readonly<MidnamesProfile>) => {
    const domain = await readDomain(name, profile);
    if (domain === undefined) return undefined;
    if (domain.owner_public_key.length !== 32) throw new PassportNameError('InvalidRecord');
    return { ownerCommitment: hex(domain.owner_public_key), target: readDomainTarget(domain) };
  };
  const supportedAccount = async (
    address: string,
    requestedNetwork: string,
    source: RegistryProvider = provider,
  ) => {
    if (requestedNetwork !== networkId) return undefined;
    const observed = await source.queryContractState(address);
    if (!observed) return undefined;
    try {
      const account = observed.contractState.deserialize({ v9: ContractState });
      const detectedBinding = await detectAccBindingFromState(account);
      if (!detectedBinding) return undefined;
      const decoded = ledger(account.data);
      return decoded.booted && decoded.spec_version === 3n
        ? { bindingId: detectedBinding, ledger: decoded }
        : undefined;
    } catch {
      return undefined;
    }
  };
  return {
    async readTarget(name, profile) {
      return (await readClaim(name, profile))?.target;
    },
    async readSupportedTarget(name, profile) {
      if (profile.networkId !== networkId) throw new PassportNameError('InvalidQuery');
      const block = await provider.queryBlock();
      if (
        !block ||
        !ADDRESS.test(block.hash) ||
        !Number.isSafeInteger(block.height) ||
        block.height < 0
      )
        throw new PassportNameError('Unavailable');
      const source: RegistryProvider = {
        ...provider,
        queryContractState: (address) =>
          provider.queryContractState(address, { type: 'blockHash', blockHash: block.hash }),
      };
      const domain = await readDomain(name, profile, source);
      if (domain === undefined) return undefined;
      const target = readDomainTarget(domain);
      if (target.kind === 'contract') {
        if (!target.address || !ADDRESS.test(target.address))
          throw new PassportNameError('InvalidRecord');
        if (!(await supportedAccount(target.address, networkId, source)))
          throw new PassportNameError('InvalidRecord');
      }
      return target;
    },
    readClaim,
    async hasDomain(name, profile) {
      return (await readDomain(name, profile)) !== undefined;
    },
    async isSupportedAccount(address, requestedNetwork) {
      return (await supportedAccount(address, requestedNetwork)) !== undefined;
    },
    async readSupportedNightBalance(address, requestedNetwork) {
      const account = await supportedAccount(address, requestedNetwork);
      if (!account) return undefined;
      const night = new Uint8Array(32);
      if (account.bindingId !== bindingId) return undefined;
      return account.ledger.unshielded_balances.member(night)
        ? account.ledger.unshielded_balances.lookup(night)
        : 0n;
    },
  };
}

export function createMidnamesIndexer(
  networkId: string,
  indexerUrl: string,
  indexerWsUrl: string,
): RegistryProvider {
  requireMidnamesV4IndexerPair(indexerUrl, indexerWsUrl);
  return createDefaultProvider({ networkId, indexerUrl, indexerWsUrl });
}
