import { createReferenceHostDriver } from './host-driver.ts';
import { randomBytes } from 'node:crypto';
import type { ChainBackend } from './backend.ts';
import type { ServiceConfig } from './config.ts';
import { directoryFile, sponsoredAddresses } from './deployments.ts';
import { createFileDirectoryStore } from '@input-output-hk/mn-passport-service';
import { createBrowserGrantOwnerReader } from './browser-grant-owner-reader.ts';
import { guardedBalance } from './sponsor-policy.ts';
import type { V9Tx, ReferenceProviders as Providers } from './reference-runtime.ts';
import { loadReferenceModules } from './reference-modules.ts';
/** The wallet's transaction seams read only `serialize()`, so raw bytes cross them in this wrapper. */
const tag = (bytes: Uint8Array): V9Tx => ({ version: 'v9', tx: { serialize: () => bytes } });

export async function loadReferenceBackend(config: ServiceConfig): Promise<
  ChainBackend & {
    readBrowserGrantOwner: ReturnType<typeof createBrowserGrantOwnerReader>;
  }
> {
  const {
    providers,
    proving,
    setup,
    waves,
    signer,
    witnesses,
    ledger,
    contracts,
    protocol,
    hostLedger,
    deployments,
  } = await loadReferenceModules(config);
  const allowedAccount = (address: string) => sponsoredAddresses(config, deployments).has(address);
  return {
    readBrowserGrantOwner: createBrowserGrantOwnerReader(
      createFileDirectoryStore(directoryFile(config.registryFile)),
      { ledger: hostLedger, providers, allowedAccount },
    ),
    hostMutations: createReferenceHostDriver({
      ...(config.hostGrantIssue && { allowGrantIssue: true }),
      providers,
      proving,
      setup,
      waves,
      signer,
      witnesses,
      ledger: hostLedger,
      versionOfRecord: protocol.versionOfRecord,
      contracts,
      networkId: config.networkId,
      indexerUrl: config.indexerUri,
      allowedAccount,
      deploymentCompleted: (address) => deployments.add(address),
    }),
    check: (preimage, keyLocation) => proving.check(preimage, keyLocation),
    prove: (preimage, keyLocation, overwriteBindingInput) =>
      proving.prove(preimage, keyLocation, overwriteBindingInput),
    proveTx: async (bytes) => {
      const tx = ledger.Transaction.deserialize('signature', 'pre-proof', 'pre-binding', bytes);
      const proven = await tx.prove(proving, ledger.CostModel.initialCostModel());
      return proven.serialize();
    },
    // The policy guards this endpoint, not the wallet provider: the reference wave deploy calls
    // `walletProvider.balanceTx` itself for its deployment and maintenance transactions.
    balance: guardedBalance({
      // The markers are the ones the wallet facade deserialises an unbound transaction with.
      deserialize: (bytes) =>
        ledger.Transaction.deserialize('signature', 'proof', 'pre-binding', bytes),
      classes: ledger,
      allowed: () => sponsoredAddresses(config, deployments),
      balance: async (tx) => (await providers.walletProvider.balanceTx(tag(tx))).tx.serialize(),
    }),
    submit: (tx) => providers.midnightProvider.submitTx(tag(tx)),
    // The route runs deployments through the same queue as proofs, so they never overlap.
    deploy: async (boot, encKey, retireAuthority, firstArm) => {
      // Records what each wave's `submitTx` returns; the reference returns the address only.
      // These are submission ids (midnight-js's txId), not the hashes of the transactions as
      // included: the wire keeps the name `txHashes` for the prototype (Final review M4).
      const txHashes: string[] = [];
      const recording: Providers = {
        ...providers,
        midnightProvider: {
          ...providers.midnightProvider,
          submitTx: async (tx) => {
            const id = await providers.midnightProvider.submitTx(tx);
            txHashes.push(String(id));
            return id;
          },
        },
      };
      // Recovery at birth, as the reference does with no artefacts supplied: a fresh JubJub key
      // whose secret is discarded here, a zero wrap, and a 3-day veto window.
      const birth = signer.JubjubDevice.generate();
      const address = await waves.deployAccountInWaves(recording, setup.compiledAccountContract(), {
        firstArm,
        args: [boot, encKey, birth.pk, new Uint8Array(64), 3n * 24n * 3600n],
        privateStateId: `passport-${randomBytes(8).toString('hex')}`,
        initialPrivateState: witnesses.emptyCoinStore(),
        // The caller's choice (D-11). Kept, the authority's key stays with this service's wallet.
        retireAuthority,
      });
      // Only now may the sponsor fund calls to it (Ruling R15), once it is also registered.
      deployments.add(address);
      return { address, txHashes };
    },
    sponsorKeys: () => ({
      coinPublicKey: providers.walletProvider.getCoinPublicKey(),
      encryptionPublicKey: providers.walletProvider.getEncryptionPublicKey(),
    }),
  };
}
