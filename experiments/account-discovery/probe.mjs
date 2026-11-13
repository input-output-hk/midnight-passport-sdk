import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import * as runtime from '@midnight-ntwrk/compact-runtime';
import { discoveryLocator, discoveryNamespace, locatorPrfSalt } from './locator.mjs';

const generatedModule = process.argv[2];
if (!generatedModule) throw new Error('Supply the generated contract/index.js path');
const { Contract, ledger } = await import(pathToFileURL(resolve(generatedModule)).href);

const network = 'undeployed';
const registry = 'ab'.repeat(32);
const account = { bytes: runtime.encodeContractAddress('cd'.repeat(32)) };
const secret = new Uint8Array(32).fill(2);
const scope = { network, registry, secret };
const locator = discoveryLocator(scope);
const secondRegistry = 'ac'.repeat(32);
const secondNetwork = 'preview';

assert.equal(
  locatorPrfSalt().toString('hex'),
  '78d2d52ee4733e47538a1fd5c2a15998ab3fb5c6a0f27dd3b8bc87d3233bcb33',
);
assert.equal(
  locator.toString('hex'),
  '71333fc728a2167a22ca5b3a59a3e73550c370f3b08bd98393e48b2bc85b82bf',
);
assert.deepEqual(locator, discoveryLocator({ ...scope, secret: secret.slice() }));
for (const invalid of ['', 'Upper', 'preview\n', 'a'.repeat(33), 'a--b', 'a\0', 'ä']) {
  assert.throws(() => discoveryLocator({ ...scope, network: invalid }), TypeError);
}
for (const invalid of [registry.toUpperCase(), registry + '\n', 'a'.repeat(63), 'g'.repeat(64)]) {
  assert.throws(() => discoveryLocator({ ...scope, registry: invalid }), TypeError);
}
for (const invalid of [undefined, new Uint8Array(31), new Uint8Array(33), Array(32).fill(2)]) {
  assert.throws(() => discoveryLocator({ ...scope, secret: invalid }), TypeError);
}

const coinKey = '00'.repeat(32);
async function makeProbe(networkId, registryAddress, witnessBytes) {
  const contract = new Contract({
    lookup_secret: ({ privateState }) => [privateState, witnessBytes],
  });
  const initial = await contract.initialState(
    runtime.createConstructorContext(undefined, coinKey),
    discoveryNamespace(networkId),
  );
  const context = runtime.createCircuitContext({
    circuitId: 'register',
    contractAddress: registryAddress,
    coinPublicKeyOrZswapState: coinKey,
    contractState: initial.currentContractState,
    privateState: undefined,
  });
  return {
    async register(candidate, input = context) {
      return (await contract.circuits.register(input, candidate, account)).context;
    },
    records(input) {
      return ledger(input.queryContexts[registryAddress].state).records;
    },
  };
}

const baseline = await makeProbe(network, registry, secret);
const accepted = await baseline.register(locator);
const [[recordedLocator, recordedAccount]] = [...baseline.records(accepted)];
assert.deepEqual(Buffer.from(recordedLocator), locator);
assert.deepEqual(recordedAccount.bytes, account.bytes);
await assert.rejects(baseline.register(locator, accepted), /locator already registered/);
assert.equal(baseline.records(accepted).size(), 1n);

for (const wrongWitness of [new Uint8Array(32).fill(3), locator]) {
  const probe = await makeProbe(network, registry, wrongWitness);
  await assert.rejects(probe.register(locator), /locator witness mismatch/);
  const wrongLocator = discoveryLocator({ ...scope, secret: wrongWitness });
  assert.equal(probe.records(await probe.register(wrongLocator)).size(), 1n);
}

for (const changedScope of [{ registry: secondRegistry }, { network: secondNetwork }]) {
  const alternate = { ...scope, ...changedScope };
  const probe = await makeProbe(alternate.network, alternate.registry, secret);
  const alternateLocator = discoveryLocator(alternate);
  assert.notDeepEqual(alternateLocator, locator);
  await assert.rejects(probe.register(locator), /locator witness mismatch/);
  const [[key]] = [...probe.records(await probe.register(alternateLocator))];
  assert.deepEqual(Buffer.from(key), alternateLocator);
}

console.log(
  JSON.stringify(
    {
      evidence: 'offline generated Compact runtime',
      knownAnswerMatched: true,
      malformedInputsRejected: true,
      distinctNetworkAndRegistry: true,
      wrongWitnessAndPublicLocatorRejected: true,
      duplicateRejected: true,
    },
    null,
    2,
  ),
);
