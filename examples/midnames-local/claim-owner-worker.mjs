import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { loadOrCreateOwnerSecret } from './owner-secret.mjs';
import { withoutDeletionCredit } from './deletion-credit.mjs';

let phase = 'initialize';

async function proveClaim(input) {
  const {
    ref,
    modulePath,
    assets,
    registryManifestHash,
    registryAddress,
    accountAddress,
    indexerUrl,
    indexerWsUrl,
    proverUrl,
    walletKeys,
    childOwnerAddress,
    rootId,
    label,
    price,
    childPrice = price,
    ownerSecretFile,
    ownerSecretMustExist = false,
    operation = 'create_domain',
    newOwnerCommitment,
    nameId,
    newTargetAddress,
    newTargetType,
  } = input;
  assert.ok(
    operation === 'create_domain' ||
      operation === 'transfer_domain' ||
      operation === 'update_target',
  );
  if (operation === 'transfer_domain') assert.match(newOwnerCommitment ?? '', /^[0-9a-f]{64}$/);
  if (operation === 'update_target') {
    assert.ok(ownerSecretFile && ownerSecretMustExist, 'Target control needs the existing owner.');
    assert.match(nameId ?? '', /^[1-9][0-9]*$/);
    assert.match(newTargetAddress ?? '', /^[0-9a-f]{64}$/);
    assert.ok(newTargetType === 'contract' || newTargetType === 'unshielded');
  }
  const get = (name) =>
    import(import.meta.resolve(name, pathToFileURL(ref + '/package.json').href));
  const [
    { CompiledContract },
    { createUnprovenCallTx },
    { AddressType, Contract },
    { NodeZkConfigProvider, nodeZkConfigRegistry },
    { httpClientProofProvider },
    { indexerPublicDataProvider },
    { setNetworkId },
    ledger,
    types,
  ] = await Promise.all([
    get('@midnight-ntwrk/compact-js'),
    get('@midnight-ntwrk/midnight-js-contracts'),
    import(pathToFileURL(modulePath).href),
    get('@midnight-ntwrk/midnight-js-node-zk-config-provider'),
    get('@midnight-ntwrk/midnight-js-http-client-proof-provider'),
    get('@midnight-ntwrk/midnight-js-indexer-public-data-provider'),
    get('@midnight-ntwrk/midnight-js-network-id'),
    get('@midnight-ntwrk/midnight-js-protocol/ledger'),
    get('@midnight-ntwrk/midnight-js-types'),
  ]);
  setNetworkId('undeployed');
  const providers = {
    publicDataProvider: indexerPublicDataProvider(indexerUrl, indexerWsUrl),
    walletProvider: {
      getCoinPublicKey: () => walletKeys.coin,
      getEncryptionPublicKey: () => walletKeys.encryption,
    },
    zkConfigProvider: new NodeZkConfigProvider(assets, {
      expectedManifestHash: registryManifestHash,
    }),
  };
  const proofProvider = httpClientProofProvider(proverUrl, await nodeZkConfigRegistry(assets));
  const witness = ownerSecretFile
    ? loadOrCreateOwnerSecret(ownerSecretFile, { create: !ownerSecretMustExist }).secret
    : new Uint8Array(randomBytes(32));
  try {
    const tag = Buffer.alloc(32);
    tag.write('midnight.domains');
    const ownerCommitment = createHash('sha256').update(tag).update(witness).digest('hex');
    const compiledContract = CompiledContract.make('registry', Contract).pipe(
      CompiledContract.withWitnesses({ domainSecretKey: () => [{}, witness] }),
      CompiledContract.withCompiledFileAssets(assets),
    );
    const nameKey = new Uint8Array(32).fill(255);
    nameKey.set(new TextEncoder().encode(label));
    phase = 'prepare';
    const args =
      operation === 'transfer_domain'
        ? [
            nameKey,
            rootId,
            new Uint8Array(Buffer.from(newOwnerCommitment, 'hex')),
            { bytes: childOwnerAddress },
          ]
        : operation === 'update_target'
          ? [
              BigInt(nameId),
              new Uint8Array(Buffer.from(newTargetAddress, 'hex')),
              newTargetType === 'contract' ? AddressType.ContractAddr : AddressType.UnshieldedAddr,
            ]
          : [
              { bytes: childOwnerAddress },
              nameKey,
              BigInt(label.length),
              rootId,
              new Uint8Array(Buffer.from(accountAddress, 'hex')),
              AddressType.ContractAddr,
              { is_some: false, value: '' },
              childPrice,
              Array.from({ length: 10 }, () => ({ is_some: false, value: ['', ''] })),
            ];
    const result = await createUnprovenCallTx(providers, {
      compiledContract,
      contractAddress: registryAddress,
      circuitId: operation,
      args,
    });
    const state = await providers.publicDataProvider.queryContractState(registryAddress);
    assert.ok(state, 'The pinned registry is absent.');
    const unprovenTx = withoutDeletionCredit(
      result,
      state,
      'undeployed',
      ledger,
      types,
      registryAddress,
    );
    phase = 'prove';
    const proven = await proofProvider.proveTx({ version: 'v9', tx: unprovenTx });
    assert.equal(proven.version, 'v9');
    const bytes = proven.tx.serialize();
    assert.ok(bytes.length && bytes.length <= 1024 * 1024);
    return { ownerCommitment, bytes };
  } finally {
    witness.fill(0);
  }
}

assert.ok(process.send);
process.once('message', (input) => {
  void proveClaim(input)
    .catch(() => {
      process.exitCode = 1;
      return { failedAt: phase };
    })
    .then(
      (result) =>
        new Promise((resolve, reject) => {
          process.send(result, (error) => (error ? reject(error) : resolve()));
        }),
    )
    .catch(() => {
      process.exitCode = 1;
    })
    .finally(() => process.disconnect?.());
});
