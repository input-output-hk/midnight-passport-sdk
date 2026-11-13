import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import * as ledger from '../../apps/passport-service/node_modules/@midnightntwrk/ledger-v9/midnight_ledger_wasm_v9_fs.js';
import { signJubjubChallenge } from '../../packages/keys/dist/jubjub-signing.js';
import { createDiscoveryIssuer, createRosterPin } from './issuer-policy.mjs';
import { discoveryNamespace } from './locator.mjs';

const [currentRoot, legacyRoot] = process.argv.slice(2);
if (!currentRoot || !legacyRoot) throw new Error('Supply current and legacy artifact directories');
const registryModule = resolve(currentRoot, 'AdmissionRegistry/contract/index.js');
const requireFromRegistry = createRequire(registryModule);
const runtime = await import(
  pathToFileURL(requireFromRegistry.resolve('@midnight-ntwrk/compact-runtime')).href
);
const Registry = await import(pathToFileURL(registryModule).href);
const name = 'authorize_registration';
const key = (root, fixture = 'AdmittedAccount') =>
  readFile(resolve(root, fixture, 'keys', name + '.verifier'));
const [current, legacy, counterfeit, registerVerifier] = await Promise.all([
  key(currentRoot),
  key(legacyRoot),
  key(currentRoot, 'CounterfeitAccount'),
  readFile(resolve(currentRoot, 'AdmissionRegistry/keys/register.verifier')),
]);

const network = 'undeployed';
const registry = '11'.repeat(32);
const genesisHash = '22'.repeat(32);
const blockHash = '33'.repeat(32);
const height = 7;
const nodeUrl = 'https://node.invalid';
const indexerUrl = 'https://indexer.invalid';
const compiledVerifiers = { [name]: current };
const maintenanceSigner = ledger.sampleSigningKey();
const active = new ledger.ContractMaintenanceAuthority(
  [ledger.signatureVerifyingKey(maintenanceSigner)],
  1,
);
const retired = new ledger.ContractMaintenanceAuthority([], 1, 1n);

function operation(verifier) {
  const result = new ledger.ContractOperation();
  result.verifierKey = verifier;
  return result;
}

function accountState(authority, verifier = current) {
  const result = new ledger.ContractState();
  result.maintenanceAuthority = authority;
  result.setOperation(name, operation(verifier));
  return result;
}

function applyFixtureIntent(state, change) {
  const now = new Date();
  const time = BigInt(Math.floor(now.getTime() / 1000));
  const intent = change(ledger.Intent.new(new Date(now.getTime() + 60_000)));
  const strictness = new ledger.WellFormedStrictness();
  strictness.enforceBalancing = false;
  strictness.verifyNativeProofs = false;
  strictness.verifyContractProofs = false;
  const tx = ledger.Transaction.fromParts(network, undefined, undefined, intent).bind();
  const verified = tx.wellFormed(state, strictness, now);
  const context = new ledger.TransactionContext(state, {
    secondsSinceEpoch: time,
    secondsSinceEpochErr: 0,
    parentBlockHash: blockHash,
    lastBlockTime: time - 1n,
  });
  const [next, result] = state.apply(verified, context);
  assert.equal(result.type, 'success', result.error);
  return next;
}

const deploy = new ledger.ContractDeploy(accountState(active));
const account = deploy.address;
const deployed = applyFixtureIntent(ledger.LedgerState.blank(network), (intent) =>
  intent.addDeploy(deploy),
);
function maintenance(counter, changes) {
  const bare = new ledger.MaintenanceUpdate(account, changes, counter);
  return bare.addSignature(0n, ledger.signData(maintenanceSigner, bare.dataToSign));
}

const retire = new ledger.ReplaceAuthority(retired);
const clean = applyFixtureIntent(deployed, (intent) =>
  intent.addMaintenanceUpdate(maintenance(0n, [retire])),
);
const insertLegacy = new ledger.VerifierKeyInsert(
  name,
  new ledger.ContractOperationVersionedVerifierKey('v3', legacy),
);
const dual = applyFixtureIntent(deployed, (intent) =>
  intent.addMaintenanceUpdate(maintenance(0n, [insertLegacy, retire])),
).index(account);
assert.throws(
  () =>
    applyFixtureIntent(clean, (intent) =>
      intent.addMaintenanceUpdate(maintenance(1n, [insertLegacy])),
    ),
  /does not correspond to a committee member/,
);
assert.deepEqual(dual.operation(name).verifierKey, new Uint8Array(current));
assert.notDeepEqual(dual.operation(name).serialize(), operation(current).serialize());
assert.equal(dual.maintenanceAuthority.committee.length, 0);

const extra = accountState(retired);
extra.setOperation('unexpected', operation(current));
const expected = clean.index(account);
const issuerSecret = 7n;
const issuerPoint = runtime.ecMulGenerator(issuerSecret);
const encodeAddress = (address) => ({ bytes: runtime.encodeContractAddress(address) });
const challengeFor = (scope, r, grind) =>
  Registry.pureCircuits.admission_challenge(
    discoveryNamespace(scope.network),
    encodeAddress(scope.registry),
    encodeAddress(scope.account),
    Buffer.from(scope.manifest, 'hex'),
    issuerPoint,
    r,
    grind,
  );
const expectedManifest = createRosterPin(ledger, compiledVerifiers).commitment;
const registryContract = new Registry.Contract({
  lookup_secret: () => {
    throw new Error('Unexpected witness');
  },
});
async function registryState(manifest) {
  const init = runtime.createConstructorContext(undefined, '00'.repeat(32));
  const generated = await registryContract.initialState(
    init,
    discoveryNamespace(network),
    Buffer.from(manifest, 'hex'),
    issuerPoint,
  );
  const state = ledger.ContractState.deserialize(generated.currentContractState.serialize());
  state.setOperation('register', operation(registerVerifier));
  state.maintenanceAuthority = retired;
  return state;
}
const expectedRegistry = await registryState(expectedManifest);
const wrongRegistry = await registryState('12'.repeat(32));
let caseInput;
let signatures = 0;
const issuer = createDiscoveryIssuer({
  ledger,
  compiledVerifiers,
  registryVerifiers: { register: registerVerifier },
  matchesRegistryPolicy(state, scope) {
    const live = Registry.ledger(runtime.ContractState.deserialize(state.serialize()).data);
    return (
      Buffer.from(live.binding_manifest).toString('hex') === scope.manifest &&
      Buffer.from(live.namespace).equals(discoveryNamespace(scope.network)) &&
      runtime.jubjubPointX(live.issuer) === runtime.jubjubPointX(issuerPoint) &&
      runtime.jubjubPointY(live.issuer) === runtime.jubjubPointY(issuerPoint)
    );
  },
  network,
  genesisHash,
  registry,
  nodeUrl,
  indexerUrl,
  async fetcher(url, options) {
    const input = JSON.parse(options.body);
    if (url === nodeUrl) {
      const method = input.method;
      const result =
        method === 'chain_getBlockHash'
          ? input.params[0] === 0
            ? '0x' + (caseInput.genesis ?? genesisHash)
            : '0x' + (caseInput.canonical ?? blockHash)
          : method === 'chain_getFinalizedHead'
            ? '0x' + blockHash
            : { number: '0x7' };
      return Response.json({ id: 1, result });
    }
    assert.equal(url, indexerUrl);
    assert.deepEqual(input.variables, { address: account, registry, offset: { hash: blockHash } });
    return Response.json({
      data: {
        block: {
          hash: caseInput.block ?? blockHash,
          height,
          protocolVersion: caseInput.protocol ?? 2_000_000,
        },
        registry: {
          address: registry,
          state: Buffer.from((caseInput.registryState ?? expectedRegistry).serialize()).toString(
            'hex',
          ),
        },
        contract: {
          address: caseInput.address ?? account,
          state: caseInput.rawState ?? Buffer.from(caseInput.state.serialize()).toString('hex'),
        },
      },
    });
  },
  sign(scope) {
    signatures++;
    assert.ok(Object.isFrozen(scope));
    return {
      scope,
      signature: signJubjubChallenge(
        { compute_public_point_with_jubjub: runtime.ecMulGenerator },
        issuerSecret,
        (r, grind) => challengeFor(scope, r, grind),
        0n,
        13n,
      ),
    };
  },
});
assert.equal(issuer.manifest, createRosterPin(ledger, compiledVerifiers).commitment);
const reverseRoster = { z: current, a: current };
assert.equal(
  createRosterPin(ledger, reverseRoster).commitment,
  createRosterPin(ledger, { a: current, z: current }).commitment,
);
assert.notEqual(issuer.manifest, createRosterPin(ledger, { [name]: counterfeit }).commitment);

caseInput = { state: expected };
const { scope, signature } = await issuer.issue(account);
assert.deepEqual(scope, {
  network,
  registry,
  account,
  manifest: issuer.manifest,
});
const challenge = challengeFor(scope, signature.sigR, signature.grindNonce);
const scalar = BigInt('0x' + Buffer.from(challenge).reverse().toString('hex'));
assert.deepEqual(
  runtime.ecMulGenerator(signature.sigS),
  runtime.ecAdd(signature.sigR, runtime.ecMul(issuerPoint, scalar)),
);
const refusals = [
  [{ state: dual }, /verifier roster mismatch/],
  [{ state: extra }, /verifier roster mismatch/],
  [{ state: accountState(retired, counterfeit) }, /verifier roster mismatch/],
  [{ state: accountState(active) }, /maintenance authority/],
  [{ state: expected, block: 'ab'.repeat(32) }, /snapshot mismatch/],
  [{ state: expected, address: 'ab'.repeat(32) }, /snapshot mismatch/],
  [{ state: expected, protocol: 3_000_000 }, /snapshot mismatch/],
  [{ state: expected, genesis: 'ab'.repeat(32) }, /genesis mismatch/],
  [{ state: expected, canonical: 'ab'.repeat(32) }, /Noncanonical finalized block/],
  [{ rawState: 'g0' }, /Invalid finalized deployment state/],
  [{ state: expected, registryState: wrongRegistry }, /Finalized registry policy mismatch/],
];
for (const [variant, failure] of refusals) {
  caseInput = variant;
  await assert.rejects(issuer.issue(account), failure);
}
assert.equal(signatures, 1);
console.log(
  JSON.stringify(
    {
      evidence: 'offline ledger WASM and simulated finalized RPC/indexer responses',
      signerInvocations: signatures,
      refusedCases: refusals.length,
      issuedSignatureMatchesRegistryChallenge: true,
      latestVerifierGetterHidLegacyKey: true,
      fullOperationRosterRefusedDualKey: true,
      retiredAuthorityRefusedFormerSignerInLedger: true,
    },
    null,
    2,
  ),
);
