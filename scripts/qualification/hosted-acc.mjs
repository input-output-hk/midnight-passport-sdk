import { createHash } from 'node:crypto';
import { ContractState } from '@midnight-ntwrk/compact-runtime';
import { ledger } from '../../packages/contract/generated/acc-s3r1.1/index.js';
import { resolveBinding } from '../../packages/contract/dist/registry.js';
import { fetchJsonBounded } from '../../packages/service/dist/finality.js';

const bindingId = 'acc-s3r1.1';
const hash = /^[0-9a-f]{64}$/;
// Contract state includes verifier keys and grows with use. Bound the
// untrusted response before decoding its hex or passing bytes to WASM.
const maximumSnapshotBytes = 4 * 1024 * 1024;

/** @param {NodeJS.ProcessEnv} env */
export function hostedAccProfile(env) {
  const {
    MN_EXPECTED_ACC_ADDRESS: address,
    MN_EXPECTED_ACC_BINDING_ID: requestedBinding,
    MN_EXPECTED_ACC_MANIFEST_SHA256: manifestSha256,
  } = env;
  if ([address, requestedBinding, manifestSha256].every((value) => value === undefined))
    return undefined;
  if (!address || !hash.test(address) || requestedBinding !== bindingId) return null;
  const binding = resolveBinding(bindingId);
  if (manifestSha256 !== binding.manifestSha256) return null;
  const verifiers = Object.entries(binding.circuits).flatMap(
    /** @returns {[string, string][]} */ ([name, circuit]) =>
      circuit.proof && circuit.hashes ? [[name, circuit.hashes.verifierKey]] : [],
  );
  return { address, bindingId, manifestSha256, verifiers };
}

/** @param {unknown} value @returns {value is Record<string, unknown>} */
function record(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/**
 * @param {NonNullable<ReturnType<typeof hostedAccProfile>>} profile
 * @param {{hash: string, height: number}} finalized
 * @param {typeof fetch} fetcher
 * @param {string} url
 * @param {AbortSignal} signal
 */
export async function observeHostedAcc(profile, finalized, fetcher, url, signal) {
  const snapshot = await readSnapshot(profile.address, finalized, fetcher, url, signal);
  if (!snapshot) return { ready: false, reason: 'acc-snapshot-unavailable' };
  const { verifiers, ...pins } = profile;
  try {
    const account = ContractState.deserialize(Buffer.from(snapshot.state, 'hex'));
    if (!matchesVerifiers(account, verifiers))
      return { ready: false, reason: 'acc-binding-mismatch' };
    const decoded = ledger(account.data);
    if (decoded.spec_version !== 3n) return { ready: false, reason: 'acc-binding-mismatch' };
    if (!decoded.booted) return { ready: false, reason: 'acc-not-active' };
    const { threshold, committee } = account.maintenanceAuthority;
    return {
      ready: true,
      account: {
        ...pins,
        verifierCount: verifiers.length,
        specVersion: Number(decoded.spec_version),
        protocolVersion: snapshot.protocolVersion,
        maintenanceCanUpdate: threshold <= committee.length,
      },
    };
  } catch {
    return { ready: false, reason: 'acc-binding-mismatch' };
  }
}

/** @param {ContractState} account @param {readonly [string, string][]} verifiers */
function matchesVerifiers(account, verifiers) {
  if (!verifiers.length || account.operations().length !== verifiers.length) return false;
  return verifiers.every(([name, expected]) => {
    const verifier = account.operation(name)?.verifierKey;
    return verifier && createHash('sha256').update(verifier).digest('hex') === expected;
  });
}

/**
 * @param {string} address
 * @param {{hash: string, height: number}} finalized
 * @param {typeof fetch} fetcher
 * @param {string} url
 * @param {AbortSignal} signal
 */
async function readSnapshot(address, finalized, fetcher, url, signal) {
  const response = await fetchJsonBounded(
    fetcher,
    url,
    {
      method: 'POST',
      redirect: 'error',
      signal,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        query: `query QualificationAcc($address: HexEncoded!, $offset: BlockOffset!) {
          block(offset: $offset) { hash height protocolVersion }
          contract(address: $address, offset: $offset) { address state }
        }`,
        variables: { address, offset: { hash: finalized.hash } },
      }),
    },
    maximumSnapshotBytes,
  );
  const value = response.value;
  if (!response.ok || !record(value) || value.errors !== undefined || !record(value.data))
    return undefined;
  const { block, contract } = value.data;
  if (!record(block) || block.hash !== finalized.hash || block.height !== finalized.height)
    return undefined;
  const { protocolVersion } = block;
  // Midnight JS 5 maps node protocol major 2 to ledger v9, the pinned
  // Compact runtime's contract-state format.
  if (
    typeof protocolVersion !== 'number' ||
    !Number.isInteger(protocolVersion) ||
    protocolVersion < 2_000_000 ||
    protocolVersion >= 3_000_000
  )
    return undefined;
  if (!record(contract) || contract.address !== address || typeof contract.state !== 'string')
    return undefined;
  if (contract.state.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(contract.state)) return undefined;
  return { state: contract.state, protocolVersion };
}
