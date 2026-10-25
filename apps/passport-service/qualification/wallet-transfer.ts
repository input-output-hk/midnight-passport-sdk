// Owned standalone payer only. Prepare once, submit once during actual indexer outage.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { privateFiles, boundedWait, publicEvent as emit } from './private-files.ts';
import { readHostConfirmation } from '../src/host-driver.ts';

const [, root] = process.argv.slice(2);
assert.equal(process.env.PASSPORT_RC_LOCALNET, '1');
assert.equal(process.env.MN_NETWORK_ID, 'undeployed');
assert.equal(process.env.MN_INDEXER_URL, 'http://127.0.0.1:18098/api/v4/graphql');
assert.equal(process.env.MN_INDEXER_WS_URL, 'ws://127.0.0.1:18098/api/v4/graphql/ws');
assert.equal(process.env.MN_NODE_URL, 'http://127.0.0.1:19954');
assert.equal(process.env.PASSPORT_SPONSOR_SEED, undefined);
assert.equal(process.env.PASSPORT_SPONSOR_SEED_FILE, undefined);
const files = privateFiles(root!);
assert.equal(
  files.exists('wallet-transfer.json'),
  false,
  'Preserve uncertain original prepared bytes.',
);
const producerRoot = join(root!, 'producer');
privateFiles(producerRoot);
process.chdir(producerRoot);
const contract = process.env.PASSPORT_CONTRACT_DIR!;
const referenceImport = (p: string) => import(pathToFileURL(join(contract, p)).href);
const require = createRequire(join(contract, 'package.json'));
const dependency = (p: string) => {
  let entry: string;
  try {
    entry = require.resolve(p);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ERR_PACKAGE_PATH_NOT_EXPORTED') throw error;
    const packageRoot = join(contract, 'node_modules', p);
    const manifest = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'));
    const imported = manifest.exports?.['.']?.import;
    assert.ok(
      typeof imported === 'string' && imported.startsWith('./'),
      'Explicit ESM entry required.',
    );
    entry = join(packageRoot, imported);
  }
  return import(pathToFileURL(entry).href);
};
const { setupWallet } = await referenceImport('src/node/setup.ts');
const address = await dependency('@midnightntwrk/wallet-sdk-address-format');
const ledger = await dependency('@midnightntwrk/ledger-v9');
const { versionOfRecord } = await dependency('@midnight-ntwrk/midnight-js-protocol');
const context = await setupWallet('0'.repeat(63) + '1');
try {
  const ready = files.read('wallet-ready.json');
  const recipient = address.MidnightBech32m.parse(ready.unshielded).decode(
    address.UnshieldedAddress,
    'undeployed',
  );
  const wallet = context.walletCtx.wallet;
  const recipe = await wallet.transferTransaction(
    [
      {
        type: 'unshielded',
        outputs: [{ type: '00'.repeat(32), receiverAddress: recipient, amount: 2n }],
      },
    ],
    { ttl: new Date(Date.now() + 60000) },
  );
  const signed = await wallet.signRecipe(recipe, (bytes: Uint8Array) =>
    context.walletCtx.unshieldedKeystore.signDataAsync(bytes),
  );
  const finalized = await wallet.finalizeRecipe(signed);
  const tx = ledger.Transaction.deserialize('signature', 'proof', 'binding', finalized.serialize());
  const prepared = {
    phase: 'ready',
    tx: Buffer.from(tx.serialize()).toString('hex'),
    identifiers: tx.identifiers().map(String),
    bytesSha256: createHash('sha256').update(tx.serialize()).digest('hex'),
  };
  files.save('wallet-transfer.json', prepared);
  emit({
    walletTransferPrepared: true,
    bytesSha256: prepared.bytesSha256,
    identifiers: prepared.identifiers,
  });
  await boundedWait(() => files.exists('wallet-send.json'), 30000);
  assert.equal(files.read('wallet-transfer.json').phase, 'ready');
  assert.equal(
    await fetch(process.env.MN_INDEXER_URL!, { signal: AbortSignal.timeout(2000) }).then(
      () => true,
      () => false,
    ),
    false,
  );
  files.save('wallet-transfer.json', { ...prepared, phase: 'dispatching' });
  emit({ walletSendEntered: true, bytesSha256: prepared.bytesSha256 });
  // submitTransaction waits for node Finalized; it does not depend on indexer confirmation.
  const submissionId = await wallet.submitTransaction(finalized);
  files.save('wallet-transfer.json', { ...prepared, phase: 'submitted', submissionId });
  emit({ walletSubmitted: true, submissionId });
  await boundedWait(() => files.exists('wallet-indexer-up.json'));
  let confirmation: Awaited<ReturnType<typeof readHostConfirmation>>;
  await boundedWait(async () => {
    confirmation = await readHostConfirmation(
      { ...prepared, submissionId, phase: 'submitted' },
      { ledger, versionOfRecord, indexerUrl: process.env.MN_INDEXER_URL! },
    );
    return !!confirmation;
  });
  assert.ok(confirmation!);
  assert.ok(
    confirmation!.blockHeight! <= files.read('wallet-indexer-up.json').beforeRestartHeight,
    'The recipient credit must be finalized while its indexer was down.',
  );
  assert.equal(createHash('sha256').update(tx.serialize()).digest('hex'), prepared.bytesSha256);
  files.save('wallet-transfer.json', {
    ...prepared,
    phase: 'confirmed',
    submissionId,
    confirmation,
  });
  emit({
    completed: 'wallet-transfer',
    bytesSha256: prepared.bytesSha256,
    confirmation,
    sends: 1,
    finalizedDuringIndexerOutage: true,
  });
} finally {
  await context.walletCtx.wallet.stop();
}

process.exit(0);
