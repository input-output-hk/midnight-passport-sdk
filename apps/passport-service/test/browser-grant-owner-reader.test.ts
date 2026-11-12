import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as Ledger from '@midnightntwrk/ledger-v9';
import { ContractState } from '@midnight-ntwrk/compact-runtime';
import type { ServiceWire } from '@input-output-hk/mn-passport-protocol';
import { AccSimulator, simulationDevice } from '../../../scripts/qualification/acc-simulator.mjs';
import { createBrowserGrantOwnerReader } from '../src/browser-grant-owner-reader.ts';

test('browser grant owner reader checks the directory hint against serialized live device entries', async () => {
  const owner = simulationDevice('p256');
  assert.equal(owner.arm, 'p256');
  if (owner.arm !== 'p256') throw new Error('Expected a P-256 fixture.');
  const sim = await AccSimulator.create({ owner });
  const account = sim.address;
  const credentialId = 'a4'.repeat(20);
  const primary: ServiceWire.AccountHintBody = {
    address: account,
    credentialId,
    scheme: 'p256-webauthn',
    status: 'active',
    publicKey: { x: owner.pk.x.toString(16), y: owner.pk.y.toString(16) },
    policy: {
      origin: Buffer.from(owner.policy.origin).toString('hex'),
      rp_id_hash: Buffer.from(owner.policy.rp_id_hash).toString('hex'),
    },
  };
  let hint = primary;
  const unused = (): never => {
    throw new Error('Unexpected write or wallet use.');
  };
  const read = createBrowserGrantOwnerReader(
    {
      async read(network, key) {
        assert.equal(network, 'undeployed');
        assert.equal(key, credentialId);
        return hint;
      },
      compareAndSet: unused,
    },
    {
      allowedAccount: (address) => address === account,
      providers: {
        publicDataProvider: {
          async queryContractState(address) {
            assert.equal(address, account);
            const state = new ContractState();
            state.data = sim.state;
            const wire = Ledger.ContractState.deserialize(state.serialize()).serialize();
            return { serialize: () => wire };
          },
        },
        walletProvider: {
          balanceTx: unused,
          getCoinPublicKey: unused,
          getEncryptionPublicKey: unused,
        },
        midnightProvider: { submitTx: unused },
        zkConfigProvider: { getVerifierKey: unused },
      },
    },
  );
  const request = { account, credentialId };
  assert.deepEqual((await read(request))?.publicKey, { ...owner.pk, identity: false });
  hint = { ...primary, status: 'deployed' };
  assert.equal(await read(request), undefined);
  hint = { ...primary, address: 'd7'.repeat(32) };
  assert.equal(await read(request), undefined);
  hint = primary;
  const survivor = simulationDevice('jubjub');
  await sim.authorised('add_device', [sim.entry(survivor)], owner, 0n);
  assert.equal((await read(request))?.deviceEpoch, 0n);
  await sim.authorised('remove_device', [sim.entry(owner, 1n)], survivor, 0n);
  assert.equal(await read(request), undefined);
});
