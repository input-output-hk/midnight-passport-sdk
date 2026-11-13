import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { signJubjubChallenge } from '../../packages/keys/dist/jubjub-signing.js';
import { discoveryLocator, discoveryNamespace } from './locator.mjs';

const output = process.argv[2];
if (!output) throw new Error('Supply the compiled artifact directory');
const artifact = (name) => resolve(output, name, 'contract/index.js');
const requireFromArtifact = createRequire(artifact('AdmissionRegistry'));
const runtime = await import(
  pathToFileURL(requireFromArtifact.resolve('@midnight-ntwrk/compact-runtime')).href
);
const load = (name) => import(pathToFileURL(artifact(name)).href);
const [Registry, Account, Counterfeit] = await Promise.all(
  ['AdmissionRegistry', 'AdmittedAccount', 'CounterfeitAccount'].map(load),
);
const bytes = (address) => ({ bytes: runtime.encodeContractAddress(address) });
const fixtureAddress = (byte) => byte.repeat(32);
const registry = fixtureAddress('11');
const account = fixtureAddress('22');
const counterfeit = fixtureAddress('33');
const otherRegistry = fixtureAddress('44');
const otherAccount = fixtureAddress('55');
const network = 'undeployed';
const manifest = new Uint8Array(32).fill(5);
const secret = new Uint8Array(32).fill(6);
const issuerScalar = 7n;
const ownerScalar = 11n;
const publicPoint = { compute_public_point_with_jubjub: runtime.ecMulGenerator };
const issuer = runtime.ecMulGenerator(issuerScalar);
const owner = runtime.ecMulGenerator(ownerScalar);
const coinKey = '00'.repeat(32);
const entry = 'authorize_registration';
const locatorFor = (networkId, address, witness) =>
  discoveryLocator({ network: networkId, registry: address, secret: witness });

const registryContract = (witness) =>
  new Registry.Contract({ lookup_secret: ({ privateState }) => [privateState, witness] });
const accountContract = new Account.Contract({});
const init = runtime.createConstructorContext(undefined, coinKey);

async function installOperation(name, contract, args = []) {
  const { currentContractState: state } = await contract.initialState(init, ...args);
  const operation = state.operation(entry);
  operation.verifierKey = await readFile(resolve(output, name, 'keys', entry + '.verifier'));
  state.setOperation(entry, operation);
  return state;
}

const accountState = await installOperation('AdmittedAccount', accountContract, [owner]);
const counterfeitState = await installOperation('CounterfeitAccount', new Counterfeit.Contract({}));
const deployments = new Map([
  [account, { state: accountState, module: Account }],
  [otherAccount, { state: accountState, module: Account }],
  [counterfeit, { state: counterfeitState, module: Counterfeit }],
]);
const rootContext = (circuitId, contractAddress, contractState) =>
  runtime.createCircuitContext({
    circuitId,
    contractAddress,
    coinPublicKeyOrZswapState: coinKey,
    contractState,
    privateState: undefined,
    parentBlockHash: 'de'.repeat(32),
    crossContract: {
      stateProvider: {
        async getContractState(_hash, address) {
          return deployments.get(address)?.state;
        },
      },
      moduleProvider: {
        resolve(address) {
          const deployment = deployments.get(address);
          return deployment ? async () => deployment.module : undefined;
        },
      },
    },
  });

const pureRegistry = Registry.pureCircuits;
const ownerSignature = ({
  target,
  registryAddress,
  locator,
  nonce = 0n,
  signer = ownerScalar,
  randomness = 13n,
}) =>
  signJubjubChallenge(
    publicPoint,
    signer,
    (r, grind) =>
      Account.pureCircuits.owner_challenge(
        bytes(registryAddress),
        bytes(target),
        locator,
        nonce,
        owner,
        r,
        grind,
      ),
    nonce,
    randomness,
  );
const attestation = ({
  target,
  registryAddress,
  networkId,
  manifestHash = manifest,
  signer = issuerScalar,
  randomness = 17n,
}) =>
  signJubjubChallenge(
    publicPoint,
    signer,
    (r, grind) =>
      pureRegistry.admission_challenge(
        discoveryNamespace(networkId),
        bytes(registryAddress),
        bytes(target),
        manifestHash,
        runtime.ecMulGenerator(signer),
        r,
        grind,
      ),
    0n,
    randomness,
  );

async function scenario({
  registryAddress = registry,
  networkId = network,
  manifestHash = manifest,
  issuerKey = issuer,
  witness = secret,
} = {}) {
  const contract = registryContract(witness);
  const { currentContractState } = await contract.initialState(
    init,
    discoveryNamespace(networkId),
    manifestHash,
    issuerKey,
  );
  const context = rootContext('register', registryAddress, currentContractState);
  return {
    register({ target, declared = target, locator, certificate, signature }, input = context) {
      return contract.circuits.register(
        input,
        bytes(target),
        bytes(declared),
        locator,
        certificate.sigR,
        certificate.sigS,
        certificate.grindNonce,
        signature.useCounter,
        signature.sigR,
        signature.sigS,
        signature.grindNonce,
      );
    },
  };
}

const request = {
  target: account,
  locator: locatorFor(network, registry, secret),
  certificate: attestation({ target: account, registryAddress: registry, networkId: network }),
};
const signed = { ...request, signature: ownerSignature({ ...request, registryAddress: registry }) };
const base = await scenario();
const accepted = await base.register(signed);
const registryState = accepted.context.queryContexts[registry].state;
const [[key, target]] = [...Registry.ledger(registryState).records];
assert.deepEqual(Buffer.from(key), signed.locator);
assert.deepEqual(target.bytes, bytes(account).bytes);
assert.equal(Account.ledger(accepted.context.queryContexts[account].state).authorizations, 1n);
assert.equal(accepted.context.callProofDataTrace.length, 2);
assert.ok(accepted.context.callProofDataTrace[0].commCommData);

await assert.rejects(base.register(signed, accepted.context), /locator already registered/);
await assert.rejects(
  base.register({ ...signed, target: counterfeit }),
  /invalid deployment attestation/,
);
await assert.rejects(
  base.register({ ...signed, target: counterfeit, declared: account }),
  /attested address does not match call target/,
);
await assert.rejects(
  (await scenario({ witness: signed.locator })).register(signed),
  /locator witness mismatch/,
);
await assert.rejects(
  base.register({
    ...signed,
    signature: ownerSignature({ ...request, registryAddress: registry, signer: 19n }),
  }),
  /invalid owner signature/,
);

// A changed message may fail the Field/JubJubScalar cast before verification.
const ownerChallengeRefusal = /invalid owner signature|range error at AdmittedAccount\.compact/;
const issuerChallengeRefusal =
  /invalid deployment attestation|range error at AdmissionRegistry\.compact/;

await assert.rejects(
  base.register({
    ...signed,
    target: otherAccount,
    certificate: attestation({
      target: otherAccount,
      registryAddress: registry,
      networkId: network,
      randomness: 37n,
    }),
  }),
  ownerChallengeRefusal,
);

const otherRegistryLocator = locatorFor(network, otherRegistry, secret);
const ownerApprovedDifferentRegistry = ownerSignature({
  ...request,
  locator: otherRegistryLocator,
  registryAddress: registry,
  randomness: 41n,
});
await assert.rejects(
  (await scenario({ registryAddress: otherRegistry })).register({
    ...signed,
    locator: otherRegistryLocator,
    certificate: attestation({
      target: account,
      registryAddress: otherRegistry,
      networkId: network,
      randomness: 43n,
    }),
    signature: ownerApprovedDifferentRegistry,
  }),
  ownerChallengeRefusal,
);

const otherSecret = new Uint8Array(32).fill(9);
const otherLocator = locatorFor(network, registry, otherSecret);
const otherLocatorScenario = await scenario({ witness: otherSecret });
await assert.rejects(
  otherLocatorScenario.register({
    ...signed,
    locator: otherLocator,
  }),
  ownerChallengeRefusal,
);
await assert.rejects(
  otherLocatorScenario.register(
    {
      ...signed,
      locator: otherLocator,
      signature: ownerSignature({
        ...request,
        locator: otherLocator,
        registryAddress: registry,
        randomness: 31n,
      }),
    },
    accepted.context,
  ),
  /stale owner nonce/,
);
await assert.rejects(
  accountContract.circuits[entry](
    rootContext(entry, account, accountState),
    bytes(registry),
    bytes(account),
    signed.locator,
    0n,
    runtime.jubjubPointX(signed.signature.sigR),
    runtime.jubjubPointY(signed.signature.sigR),
    signed.signature.sigS,
    signed.signature.grindNonce,
  ),
  /caller missing|registry caller required/,
);

for (const variant of [
  { registryAddress: otherRegistry },
  { networkId: 'preview' },
  { manifestHash: new Uint8Array(32).fill(10) },
  { issuerKey: runtime.ecMulGenerator(23n) },
]) {
  await assert.rejects((await scenario(variant)).register(signed), issuerChallengeRefusal);
}
const counterfeitCertificate = attestation({
  target: counterfeit,
  registryAddress: registry,
  networkId: network,
  randomness: 29n,
});
const falselyAdmitted = await base.register({
  ...signed,
  target: counterfeit,
  certificate: counterfeitCertificate,
});
assert.equal(
  Counterfeit.ledger(falselyAdmitted.context.queryContexts[counterfeit].state).authorizations,
  2n,
);

console.log(
  JSON.stringify(
    {
      evidence:
        'offline generated Compact runtime with compiled verifier keys and synthetic signers',
      admittedAccountAndOwnerAccepted: true,
      counterfeitWithoutAttestationRefused: true,
      substitutedCallTargetRefused: true,
      wrongWitnessOwnerIntentAndStaleNonceRefused: true,
      ownerIntentForAnotherAccountOrRegistryRefused: true,
      directOwnerCallAndDuplicateRefused: true,
      attestationScopeAndIssuerMismatchRefused: true,
      falselyAttestedCounterfeitAccepted: true,
    },
    null,
    2,
  ),
);
