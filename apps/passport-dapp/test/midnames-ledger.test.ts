import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';
import {
  ContractOperation,
  ContractState,
  createConstructorContext,
} from '@midnight-ntwrk/compact-runtime';
import { LedgerParameters } from '@midnightntwrk/ledger-v9';
import { createMidnamesIndexer, createMidnamesLedgerReads } from '../src/midnames/ledger-reader.js';
import { MIDNAMES_REGISTRY_VERIFIERS } from '../src/midnames/registry-pins.js';

const profile = { networkId: 'undeployed', namespace: 'night', registryAddress: '11'.repeat(32) };
const target = '33'.repeat(32);
const coin = '00'.repeat(32);
const payment = {
  cost_short: 0n,
  cost_med: 0n,
  cost_long: 0n,
  coin_color: new Uint8Array(32),
  buy_enabled: false,
};
const owner = { bytes: new Uint8Array(32).fill(4) };

function fields(values: [string, string][] = []) {
  return Array.from({ length: 10 }, (_, index) => {
    const value = values[index];
    return value
      ? { is_some: true, value }
      : { is_some: false, value: ['', ''] as [string, string] };
  });
}

async function registryFixture() {
  // Fixture construction needs the actual reader's generated state. The
  // package's root export also loads an older write artifact, so avoid it.
  const reader = new URL('./reader/contract/index.js', import.meta.resolve('@midnames/sdk/core'));
  const { AddressType, Contract, ledger }: typeof import('@midnames/sdk') = await import(
    reader.href
  );
  const secret = new Uint8Array(32).fill(3);
  const contract = new Contract({ domainSecretKey: () => [{}, secret] });
  const bytes = new Uint8Array(32).fill(0x33);
  const start = await contract.initialState(
    createConstructorContext({}, coin),
    'night',
    bytes,
    AddressType.ContractAddr,
    { is_some: false, value: '' },
    payment,
    owner,
    fields([]),
    { is_some: false, value: 0n },
    true,
  );
  const root = ledger(start.currentContractState.data).ROOT_ZONE_ID;
  const key = new Uint8Array(32).fill(255);
  key.set(new TextEncoder().encode('alice'));
  const runtimePath = createRequire(reader).resolve('@midnight-ntwrk/compact-runtime');
  const {
    createCircuitContext,
  }: {
    createCircuitContext(options: {
      circuitId: 'create_domain';
      contractAddress: string;
      coinPublicKeyOrZswapState: string;
      contractState: typeof start.currentContractState.data;
      privateState: object;
      time: number;
    }): Parameters<typeof contract.circuits.create_domain>[0];
  } = await import(pathToFileURL(runtimePath).href);
  const context = createCircuitContext({
    circuitId: 'create_domain',
    contractAddress: profile.registryAddress,
    coinPublicKeyOrZswapState: coin,
    contractState: start.currentContractState.data,
    privateState: {},
    time: 0,
  });
  const created = await contract.circuits.create_domain(
    context,
    owner,
    key,
    5n,
    root,
    bytes,
    AddressType.ContractAddr,
    { is_some: true, value: 'profile' },
    payment,
    fields([['profile', 'different-target']]),
  );
  const state = ContractState.deserialize(start.currentContractState.serialize());
  // Transfer the simulated ledger data through the runtime boundary as serialized state.
  const createdState = start.currentContractState;
  createdState.data = created.context.callContext.currentQueryContext.state;
  const result = ContractState.deserialize(createdState.serialize());
  for (const name of Object.keys(MIDNAMES_REGISTRY_VERIFIERS)) {
    const verifier = new URL(
      `./managed/keys/${name}.verifier`,
      import.meta.resolve('@midnames/sdk'),
    );
    const operation = new ContractOperation();
    operation.verifierKey = readFileSync(verifier);
    result.setOperation(name, operation);
  }
  return { result, state };
}

test('installed Midnames v2.1 reads its generated registry over the Ledger 9 indexer wire format', async (t) => {
  const { result, state } = await registryFixture();
  let registryState = Buffer.from(result.serialize()).toString('hex');
  const ledgerParameters = Buffer.from(LedgerParameters.initialParameters().serialize()).toString(
    'hex',
  );
  let queryCount = 0;
  const server = createServer((request, response) => {
    let body = '';
    request.setEncoding('utf8');
    request.on('data', (chunk: string) => {
      body += chunk;
    });
    request.on('end', () => {
      queryCount++;
      const { variables } = JSON.parse(body);
      response.setHeader('Content-Type', 'application/json');
      response.end(
        JSON.stringify({
          data: {
            block: { protocolVersion: 2001000, ledgerParameters },
            contract:
              variables.address === profile.registryAddress ? { state: registryState } : null,
          },
        }),
      );
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(
    () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  );
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const indexer = createMidnamesIndexer(
    'undeployed',
    `http://127.0.0.1:${address.port}`,
    `ws://127.0.0.1:${address.port}`,
  );
  const reads = createMidnamesLedgerReads(indexer, 'undeployed', 'acc-s3r1.1');
  const standalone = createMidnamesLedgerReads(
    indexer,
    'undeployed',
    'acc-s3r1.1',
    'standalone-0.35',
  );
  assert.deepEqual(await reads.readTarget('alice.night', profile), {
    kind: 'contract',
    address: target,
  });
  assert.equal(queryCount, 1);
  await assert.rejects(standalone.readTarget('alice.night', profile), { code: 'InvalidRecord' });
  assert.equal(await reads.readTarget('missing.night', profile), undefined);
  assert.equal(await reads.isSupportedAccount(target, 'undeployed'), false);
  registryState = Buffer.from(state.serialize()).toString('hex');
  await assert.rejects(reads.readTarget('alice.night', profile), { code: 'InvalidRecord' });
});
