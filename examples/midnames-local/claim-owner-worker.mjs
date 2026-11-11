import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { pathToFileURL } from 'node:url';

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
  } = input;
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
  ] = await Promise.all([
    get('@midnight-ntwrk/compact-js'),
    get('@midnight-ntwrk/midnight-js-contracts'),
    import(pathToFileURL(modulePath).href),
    get('@midnight-ntwrk/midnight-js-node-zk-config-provider'),
    get('@midnight-ntwrk/midnight-js-http-client-proof-provider'),
    get('@midnight-ntwrk/midnight-js-indexer-public-data-provider'),
    get('@midnight-ntwrk/midnight-js-network-id'),
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
  const witness = new Uint8Array(randomBytes(32));
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
    const {
      private: { unprovenTx },
    } = await createUnprovenCallTx(providers, {
      compiledContract,
      contractAddress: registryAddress,
      circuitId: 'create_domain',
      args: [
        { bytes: childOwnerAddress },
        nameKey,
        BigInt(label.length),
        rootId,
        new Uint8Array(Buffer.from(accountAddress, 'hex')),
        AddressType.ContractAddr,
        { is_some: false, value: '' },
        price,
        Array.from({ length: 10 }, () => ({ is_some: false, value: ['', ''] })),
      ],
    });
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
