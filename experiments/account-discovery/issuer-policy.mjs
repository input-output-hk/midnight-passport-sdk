import { createHash } from 'node:crypto';
import { fetchJsonBounded, hostChainRpc } from '../../packages/service/dist/finality.js';
import { discoveryNamespace } from './locator.mjs';

const maxSnapshotBytes = 4 * 1024 * 1024;
const hex32 = (value) =>
  typeof value === 'string' && value.length === 64 && !/[^0-9a-f]/.test(value);
const hash = (value) => createHash('sha256').update(value).digest('hex');
const entryName = (value) =>
  typeof value === 'string' && value.length > 0 && value.length <= 64 && !/[^a-z0-9_]/.test(value);

/** Commit to every complete ledger operation serialization, ordered by entry-point name. */
export function createRosterPin(ledger, compiledVerifiers) {
  const names = Object.keys(compiledVerifiers).sort();
  if (!names.length || names.length > 256 || !names.every(entryName)) {
    throw new Error('Invalid discovery verifier roster');
  }
  const entries = names.map((name) => {
    const verifier = compiledVerifiers[name];
    if (!(verifier instanceof Uint8Array) || !verifier.length) {
      throw new Error('Invalid discovery verifier key');
    }
    const operation = new ledger.ContractOperation();
    operation.verifierKey = verifier;
    // A verifierKey getter alone can hide retained older keys.
    return Object.freeze([name, hash(operation.serialize())]);
  });
  const commitment = hash(JSON.stringify(['passport:discovery:roster:v1', entries]));
  return Object.freeze({ entries: Object.freeze(entries), commitment });
}

function admitState(ledger, stateHex, roster) {
  if (
    typeof stateHex !== 'string' ||
    !stateHex.length ||
    stateHex.length > maxSnapshotBytes ||
    stateHex.length % 2 !== 0 ||
    /[^0-9a-f]/.test(stateHex)
  ) {
    throw new Error('Invalid finalized deployment state');
  }
  const state = ledger.ContractState.deserialize(Buffer.from(stateHex, 'hex'));
  const authority = state.maintenanceAuthority;
  if (authority.committee.length !== 0 || authority.threshold !== 1) {
    throw new Error('Deployment maintenance authority is active or noncanonical');
  }
  const operations = state.operations();
  if (
    operations.length !== roster.entries.length ||
    operations.some((name) => !entryName(name)) ||
    roster.entries.some(([name, expected]) => {
      const operation = state.operation(name);
      return !operation || hash(operation.serialize()) !== expected;
    })
  ) {
    throw new Error('Finalized deployment verifier roster mismatch');
  }
  return state;
}

/**
 * Create an issuer with fixed deployment policy and explicitly trusted node and indexer endpoints.
 * The signer receives only the checked scope, never caller-provided digest bytes.
 */
export function createDiscoveryIssuer({
  ledger,
  compiledVerifiers,
  registryVerifiers,
  matchesRegistryPolicy,
  network,
  genesisHash,
  registry,
  nodeUrl,
  indexerUrl,
  fetcher = fetch,
  sign,
}) {
  discoveryNamespace(network);
  if (!hex32(genesisHash) || !hex32(registry)) throw new Error('Invalid discovery issuer pins');
  const roster = createRosterPin(ledger, compiledVerifiers);
  const registryRoster = createRosterPin(ledger, registryVerifiers);
  return Object.freeze({
    manifest: roster.commitment,
    async issue(account) {
      if (!hex32(account)) throw new Error('Invalid discovery account address');
      const signal = AbortSignal.timeout(8000);
      const rpc = hostChainRpc({ nodeUrl, fetch: fetcher }, signal);
      if ((await rpc('chain_getBlockHash', [0])) !== '0x' + genesisHash) {
        throw new Error('Discovery issuer genesis mismatch');
      }
      const finalized = await rpc('chain_getFinalizedHead', []);
      if (
        typeof finalized !== 'string' ||
        !finalized.startsWith('0x') ||
        !hex32(finalized.slice(2))
      ) {
        throw new Error('Invalid finalized block');
      }
      const header = await rpc('chain_getHeader', [finalized]);
      if (typeof header?.number !== 'string' || !/^0x[0-9a-f]{1,13}$/.test(header.number)) {
        throw new Error('Invalid finalized block height');
      }
      const height = Number(header.number);
      if (height < 1 || (await rpc('chain_getBlockHash', [height])) !== finalized) {
        throw new Error('Noncanonical finalized block');
      }
      const blockHash = finalized.slice(2);
      const response = await fetchJsonBounded(
        fetcher,
        indexerUrl,
        {
          method: 'POST',
          redirect: 'error',
          signal,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            query: `query DiscoveryAdmission($address: HexEncoded!, $registry: HexEncoded!, $offset: BlockOffset!) {
              block(offset: $offset) { hash height protocolVersion }
              contract(address: $address, offset: $offset) { address state }
              registry: contract(address: $registry, offset: $offset) { address state }
            }`,
            variables: { address: account, registry, offset: { hash: blockHash } },
          }),
        },
        maxSnapshotBytes,
      );
      const { block, contract, registry: registrySnapshot } = response.value?.data ?? {};
      if (
        !response.ok ||
        response.value?.errors !== undefined ||
        block?.hash !== blockHash ||
        block.height !== height ||
        !Number.isInteger(block.protocolVersion) ||
        block.protocolVersion < 2_000_000 ||
        block.protocolVersion >= 3_000_000 ||
        contract?.address !== account ||
        registrySnapshot?.address !== registry
      ) {
        throw new Error('Finalized deployment snapshot mismatch');
      }
      admitState(ledger, contract.state, roster);
      const registryState = admitState(ledger, registrySnapshot.state, registryRoster);
      const scope = Object.freeze({ network, registry, account, manifest: roster.commitment });
      if (matchesRegistryPolicy(registryState, scope) !== true) {
        throw new Error('Finalized registry policy mismatch');
      }
      return sign(scope);
    },
  });
}
