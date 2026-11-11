import {
  getContractLedger,
  getTargetFromDomainData,
  queryContractState,
  resolveDomainIdInLedger,
} from '@midnames/sdk/core';
import { createDefaultProvider } from '@midnames/sdk/provider';
import { ContractState } from '@midnight-ntwrk/compact-runtime';
import { PassportNameError } from '@input-output-hk/mn-passport-account/names';
import { resolveBinding } from '@input-output-hk/mn-passport-contract';
import { ledger } from '#acc';
import type { MidnamesReads } from './resolver.js';
import {
  MIDNAMES_REGISTRY_VERIFIERS,
  STANDALONE_REGISTRY_VERIFIERS,
  registryProfile,
  type MidnamesRegistryProfile,
} from './registry-pins.js';

type RegistryProvider = Parameters<typeof getContractLedger>[0];

const hex = (value: Uint8Array): string =>
  Array.from(value, (byte) => byte.toString(16).padStart(2, '0')).join('');

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

function compatibleVerifiers(bindingId: string): ReadonlyMap<string, string> {
  return new Map(
    Object.entries(resolveBinding(bindingId).circuits).flatMap(([name, circuit]) =>
      circuit.proof && circuit.hashes ? [[name, circuit.hashes.verifierKey]] : [],
    ),
  );
}

export function createMidnamesLedgerReads(
  provider: RegistryProvider,
  networkId: string,
  bindingId: string,
  profileId: MidnamesRegistryProfile = 'midnames-2.1.0',
): MidnamesReads {
  const pinnedProfile = registryProfile(profileId, networkId);
  const registryVerifiers = new Map(
    Object.entries(
      pinnedProfile === 'standalone-0.35'
        ? STANDALONE_REGISTRY_VERIFIERS
        : MIDNAMES_REGISTRY_VERIFIERS,
    ),
  );
  const accVerifiers = compatibleVerifiers(bindingId);
  return {
    async readTarget(name, profile) {
      if (profile.networkId !== networkId) throw new PassportNameError('InvalidQuery');
      // Check the registry fingerprint and resolve from the same observed state.
      const observed = await provider.queryContractState(profile.registryAddress);
      if (!observed) throw new PassportNameError('Unavailable');
      const snapshot: RegistryProvider = {
        ...provider,
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
      const target = registry.data.id_to_data.lookup(id);
      try {
        const resolved = getTargetFromDomainData(target);
        return resolved.type === 'contract'
          ? { kind: 'contract', address: resolved.address }
          : { kind: 'other' };
      } catch {
        throw new PassportNameError('InvalidRecord');
      }
    },
    async isSupportedAccount(address, requestedNetwork) {
      if (requestedNetwork !== networkId) return false;
      const observed = await provider.queryContractState(address);
      if (!observed) return false;
      // Midnight JS 5 carries tagged bytes. Decode with the ACC's own runtime.
      try {
        const account = observed.contractState.deserialize({ v9: ContractState });
        if (!(await matchesVerifiers(account, accVerifiers))) return false;
        const decoded = ledger(account.data);
        return decoded.booted && decoded.spec_version === 3n;
      } catch {
        return false;
      }
    },
  };
}

export function createMidnamesIndexer(
  networkId: string,
  indexerUrl: string,
  indexerWsUrl: string,
): RegistryProvider {
  return createDefaultProvider({ networkId, indexerUrl, indexerWsUrl });
}
