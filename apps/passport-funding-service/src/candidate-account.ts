import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { detectDeployedVersionByCircuit } from '@input-output-hk/mn-passport-contract';
import type { MidnightBinding } from '@input-output-hk/mn-passport-adapter-midnight-js';
import type { FundingConfig } from './config.ts';

interface CandidateLedger {
  readonly spec_version: bigint;
  readonly booted: boolean;
  readonly unshielded_balances: {
    member(color: Uint8Array): boolean;
    lookup(color: Uint8Array): bigint;
  };
}

const ADDRESS = /^[0-9a-f]{64}$/;

/** The candidate's full verifier roster is checked before any funding reservation. */
export async function candidateFundingAccount(
  config: Pick<FundingConfig, 'bindingId' | 'contractDir' | 'indexerUri' | 'indexerWsUri'>,
  binding: MidnightBinding,
) {
  if (config.bindingId !== 'acc-s3r1.1-zkir036')
    throw new Error('Candidate funding requires the pinned candidate binding.');
  const provider = indexerPublicDataProvider({
    queryURL: config.indexerUri,
    subscriptionURL: config.indexerWsUri,
  });
  // The candidate module resolves Compact through the frozen reference tree.
  // Deserialize indexer bytes with that tree's Compact runtime before decoding
  // its state, because two WASM class instances cannot share a ChargedState.
  const requireFromTree = createRequire(join(config.contractDir, 'package.json'));
  const referenceRuntime = (await import(
    pathToFileURL(requireFromTree.resolve('@midnight-ntwrk/compact-runtime')).href
  )) as {
    ContractState: {
      deserialize(bytes: Uint8Array): {
        data: unknown;
        operations(): string[];
        operation(name: string): { verifierKey: Uint8Array } | undefined;
      };
    };
  };
  return async (address: string) => {
    if (!ADDRESS.test(address)) throw new Error('Invalid candidate ACC address.');
    const indexed = await provider.queryContractState(address);
    if (!indexed) throw new Error('Candidate ACC is absent.');
    const state = referenceRuntime.ContractState.deserialize(indexed.serialize());
    const observed: Record<string, string> = Object.create(null);
    const names = state.operations();
    for (const name of names) {
      if (!/^[a-z][a-z0-9_]*$/.test(name) || Object.hasOwn(observed, name))
        throw new Error('Candidate ACC verifier roster is invalid.');
      const verifier = state.operation(name)?.verifierKey;
      if (!(verifier instanceof Uint8Array) || verifier.length === 0)
        throw new Error('Candidate ACC verifier roster is incomplete.');
      observed[name] = createHash('sha256').update(verifier).digest('hex');
    }
    if (detectDeployedVersionByCircuit(observed) !== config.bindingId)
      throw new Error('Candidate ACC verifier roster differs from the package pin.');
    const ledger = binding.ledger(state.data) as CandidateLedger;
    if (
      !ledger.booted ||
      ledger.spec_version !== 3n ||
      !ledger.unshielded_balances ||
      typeof ledger.unshielded_balances.member !== 'function' ||
      typeof ledger.unshielded_balances.lookup !== 'function'
    )
      throw new Error('Candidate ACC is not active under the pinned binding.');
    return ledger;
  };
}
