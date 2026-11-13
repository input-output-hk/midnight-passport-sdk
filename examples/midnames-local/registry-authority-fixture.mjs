import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { resolvePassportName } from '../../packages/account/dist/names.js';
import { createHostTransactionFinality } from '../../packages/service/dist/finality.js';

const name = 'alice.night';
const ownerTag = Buffer.alloc(32);
ownerTag.write('midnight.domains');
const commitment = (secret) => createHash('sha256').update(ownerTag).update(secret).digest();

export async function qualifyRegistryAuthority({
  contracts,
  providers,
  compiled,
  registry,
  registryAddress,
  privateStateId,
  ledger,
  profile,
  names,
  reads,
  rootId,
  nameKey,
  rootSecret,
  owner,
  original,
  replacement,
  transactions,
}) {
  const successor = randomBytes(32);
  const outsider = randomBytes(32);
  const initialCommitment = commitment(rootSecret).toString('hex');
  const nextCommitment = commitment(successor).toString('hex');
  const first = transactions.length;
  const priorResolution = await resolvePassportName(names, { name, networkId: profile.networkId });
  const finality = createHostTransactionFinality({
    ledger,
    networkId: profile.networkId,
    nodeUrl: process.env.MN_NODE_URL,
    indexerUrl: process.env.MN_INDEXER_URL,
    versionOfRecord: (record) => (record.protocolVersion === 2001000 ? 'v9' : ''),
  });
  const state = await providers.publicDataProvider.queryContractState(registryAddress);
  const domainId = registry
    .ledger(state.data)
    .name_to_id.lookup({ domain: nameKey, parent_id: rootId });
  const request = (secret, circuitId, args) => ({
    compiledContract: compiled(secret),
    contractAddress: registryAddress,
    circuitId,
    privateStateId,
    args,
  });
  const update = (target) => [
    domainId,
    new Uint8Array(Buffer.from(target, 'hex')),
    registry.AddressType.ContractAddr,
  ];
  const transfer = [nameKey, rootId, new Uint8Array(commitment(successor)), owner];
  const observe = async (ownerCommitment, address) => {
    assert.deepEqual(await reads.readClaim(name, profile), {
      ownerCommitment,
      target: { kind: 'contract', address },
    });
    assert.equal(
      (await resolvePassportName(names, { name, networkId: profile.networkId }))?.accountAddress,
      address,
    );
  };
  const refuse = async (secret, circuit, args, currentOwner, currentTarget) => {
    const before = transactions.length;
    await assert.rejects(
      contracts.createUnprovenCallTx(providers, request(secret, circuit, args)),
      /Not the owner/,
    );
    assert.equal(transactions.length, before);
    await observe(currentOwner, currentTarget);
  };
  const effects = [];
  const submit = async (secret, circuit, args, currentOwner, currentTarget) => {
    const before = transactions.length;
    await contracts.submitCallTx(providers, request(secret, circuit, args));
    assert.equal(transactions.length, before + 1);
    const submitted = transactions.at(-1);
    const identity = {
      txHash: submitted.txHash,
      bytesSha256: submitted.sha256,
      identifiers: submitted.identifiers,
    };
    let original;
    const deadline = performance.now() + 120_000;
    while (!original && performance.now() < deadline) {
      original = await finality.readFinalized(identity);
      if (!original) await delay(1000);
    }
    assert.ok(original);
    assert.equal(original.txHash, submitted.txHash);
    assert.equal(original.bytesSha256, submitted.sha256);
    await observe(currentOwner, currentTarget);
    effects.push({ circuit, ...original, ownerCommitment: currentOwner, target: currentTarget });
  };
  try {
    assert.equal(priorResolution?.accountAddress, original.address);
    await refuse(
      outsider,
      'update_target',
      update(replacement.address),
      initialCommitment,
      original.address,
    );
    await refuse(outsider, 'transfer_domain', transfer, initialCommitment, original.address);
    await submit(
      rootSecret,
      'update_target',
      update(replacement.address),
      initialCommitment,
      replacement.address,
    );
    assert.equal(priorResolution.accountAddress, original.address);
    const repointedOpen = await replacement.qualify(names);
    await submit(rootSecret, 'transfer_domain', transfer, nextCommitment, replacement.address);
    await refuse(
      rootSecret,
      'update_target',
      update(original.address),
      nextCommitment,
      replacement.address,
    );
    await submit(
      successor,
      'update_target',
      update(original.address),
      nextCommitment,
      original.address,
    );
    const restoredTargetOpen = await original.qualify(names);
    assert.equal(transactions.length, first + 3);
    return { effects, repointedOpen, restoredTargetOpen, refusedCalls: 3, mutationSubmissions: 3 };
  } finally {
    successor.fill(0);
    outsider.fill(0);
  }
}
