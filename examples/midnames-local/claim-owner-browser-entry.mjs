import { CompiledContract } from '@midnight-ntwrk/compact-js';
import { createUnprovenCallTx } from '@midnight-ntwrk/midnight-js-contracts';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import {
  CostModel,
  createCheckPayload,
  createProvingPayload,
  parseCheckResult,
} from '@midnight-ntwrk/midnight-js-protocol/ledger';
import {
  ZKConfigProvider,
  ZKConfigRegistry,
  createProverKey,
  createVerifierKey,
  createZKIR,
  zkConfigToProvingKeyMaterial,
} from '@midnight-ntwrk/midnight-js-types';
import { AddressType, Contract } from './registry.mjs';
import manifest from './registry-manifest.json';

const utf8 = (value) => new TextEncoder().encode(value);
const random = () => crypto.getRandomValues(new Uint8Array(32));
const sha = async (bytes) => new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
const hex = (bytes) => Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
const fromHex = (value) => Uint8Array.from(value.match(/../g), (byte) => parseInt(byte, 16));

async function binary(path, body) {
  const response = await fetch(path, {
    ...(body && { method: 'POST', body, headers: { 'Content-Type': 'application/octet-stream' } }),
    mode: 'same-origin',
    credentials: 'omit',
    redirect: 'error',
    signal: AbortSignal.timeout(90_000),
  });
  if (!response.ok) throw new Error('The trusted local proving endpoint refused the request.');
  return new Uint8Array(await response.arrayBuffer());
}

async function artifact(circuit, kind) {
  if (circuit !== 'create_domain') throw new Error('Unexpected Midnames proof circuit.');
  const bytes = await binary('/owner-artifact/' + kind);
  if (hex(await sha(bytes)) !== manifest.circuits[circuit][kind])
    throw new Error('Midnames artifact differs from the pinned bytes.');
  return bytes;
}

class ClaimArtifacts extends ZKConfigProvider {
  getArtifactRuntimeVersion() {
    return Promise.resolve(manifest.runtime);
  }
  async getZKIR(circuit) {
    return createZKIR(await artifact(circuit, 'bzkir'));
  }
  async getVerifierKey(circuit) {
    return createVerifierKey(await artifact(circuit, 'verifier'));
  }
  async getProverKey(circuit) {
    return createProverKey(await artifact(circuit, 'prover'));
  }
}

function localProver(artifacts) {
  const registry = new ZKConfigRegistry([artifacts]);
  const lookupKey = async (location) => {
    const config = await registry.resolveKeyLocation(location);
    return config && zkConfigToProvingKeyMaterial(config);
  };
  return {
    lookupKey,
    async check(preimage, location) {
      const key = await lookupKey(location);
      return parseCheckResult(
        await binary('/owner-proof/check', createCheckPayload(preimage, key?.ir)),
      );
    },
    async prove(preimage, location, binding) {
      const key = await lookupKey(location);
      return binary('/owner-proof/prove', createProvingPayload(preimage, binding, key));
    },
  };
}

async function enroll() {
  const credential = await navigator.credentials.create({
    publicKey: {
      challenge: random(),
      rp: { name: 'Standalone Midnames owner' },
      user: { id: random(), name: 'midnames-owner', displayName: 'Midnames owner' },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
      authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
      extensions: { prf: {} },
    },
  });
  if (!credential) throw new Error('The owner credential was not created.');
  return hex(new Uint8Array(credential.rawId));
}

async function withNamingWitness(input, id, work) {
  const salt = await sha(
    utf8(
      JSON.stringify([
        'midnight-passport:midnames-owner:v1',
        'undeployed',
        input.registryAddress,
        input.label + '.night',
      ]),
    ),
  );
  const assertion = await navigator.credentials.get({
    publicKey: {
      challenge: random(),
      allowCredentials: [{ type: 'public-key', id: fromHex(id) }],
      userVerification: 'required',
      extensions: { prf: { eval: { first: salt } } },
    },
  });
  const result = assertion?.getClientExtensionResults().prf?.results?.first;
  // View the authenticator's original storage even if a host returns a typed view.
  const witness =
    result &&
    (ArrayBuffer.isView(result)
      ? new Uint8Array(result.buffer, result.byteOffset, result.byteLength)
      : new Uint8Array(result));
  try {
    if (hex(new Uint8Array(assertion?.rawId ?? [])) !== id || witness?.length !== 32)
      throw new Error('The original naming credential did not provide a PRF witness.');
    const commitment = new Uint8Array(64);
    commitment.set(utf8('midnight.domains'));
    commitment.set(witness, 32);
    const owner = await sha(commitment).finally(() => commitment.fill(0));
    return await work(witness, hex(owner));
  } finally {
    witness?.fill(0);
  }
}

async function prove(input, id) {
  setNetworkId('undeployed');
  const zkConfigProvider = new ClaimArtifacts();
  return withNamingWitness(input, id, async (witness, ownerCommitment) => {
    const compiledContract = CompiledContract.make('registry', Contract).pipe(
      CompiledContract.withWitnesses({ domainSecretKey: () => [{}, witness] }),
      CompiledContract.withCompiledFileAssets('.'),
    );
    const nameKey = new Uint8Array(32).fill(255);
    nameKey.set(utf8(input.label));
    const {
      private: { unprovenTx },
    } = await createUnprovenCallTx(
      {
        publicDataProvider: indexerPublicDataProvider(input.indexerUrl, input.indexerWsUrl),
        walletProvider: {
          getCoinPublicKey: () => input.walletKeys.coin,
          getEncryptionPublicKey: () => input.walletKeys.encryption,
        },
        zkConfigProvider,
      },
      {
        compiledContract,
        contractAddress: input.registryAddress,
        circuitId: 'create_domain',
        args: [
          { bytes: input.childOwnerAddress },
          nameKey,
          BigInt(input.label.length),
          input.rootId,
          fromHex(input.accountAddress),
          AddressType.ContractAddr,
          { is_some: false, value: '' },
          input.price,
          Array.from({ length: 10 }, () => ({ is_some: false, value: ['', ''] })),
        ],
      },
    );
    const tx = await unprovenTx.prove(localProver(zkConfigProvider), CostModel.initialCostModel());
    return { ownerCommitment, bytes: Array.from(tx.serialize()) };
  });
}

globalThis.midnamesOwner = {
  enroll,
  prove,
  commitment: (input, id) => withNamingWitness(input, id, async (_witness, owner) => owner),
};
