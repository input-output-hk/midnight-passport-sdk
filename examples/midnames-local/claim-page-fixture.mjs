import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { admitNativeClaim } from '../../apps/passport-dapp/src/midnames/claim-native-admission.ts';
import { readClaimFinality } from '../../apps/passport-dapp/src/midnames/claim-finality.ts';
import { claimDestination, claimQuote } from '../../apps/passport-dapp/src/midnames/claim-quote.ts';
import { saveIsolationReceipt } from '../../scripts/qualification/native-isolation-files.mjs';
import { runBrowser } from './claim-browser-fixture.mjs';
import { startDemoOwnerBundle } from './claim-owner-browser-host.mjs';
import { createClaimSponsorHandler } from './claim-sponsor-http.mts';
import { openClaimDispatch } from './claim-dispatch.mts';
import { verifyIndexedClaimFailure } from './claim-indexed-failure.mjs';

/** Fresh isolated claim: the Passport page requests the quote, proves with its
 * virtual PRF credential, prepares through the sponsor and sends once. The
 * native runner supplies an already activated ACC and a funded sponsor. */
export async function qualifyPageOwnedClaim({
  output,
  ref,
  assets,
  modulePath,
  registryAddress,
  accountAddress,
  name,
  failedOriginal,
  sponsorJournalDir = output,
  parentDomain,
  sponsorPaymentAddress,
  walletProvider,
  submit,
  ledger,
  readLive,
  reads,
  profile,
  step,
}) {
  mkdirSync(output, { recursive: true, mode: 0o700 });
  saveIsolationReceipt(join(output, 'page-claim-input.json'), {
    registryAddress,
    accountAddress,
    name,
    ...(failedOriginal ? { failedOriginal } : {}),
  });
  const hex = (value) => (typeof value === 'string' ? value : Buffer.from(value).toString('hex'));
  const walletKeys = {
    coin: hex(await walletProvider.getCoinPublicKey()),
    encryption: hex(await walletProvider.getEncryptionPublicKey()),
  };
  const owner = await startDemoOwnerBundle(
    { assets, modulePath, ref },
    {
      networkId: 'undeployed',
      registryAddress,
      sponsorAddress: sponsorPaymentAddress,
      indexerUrl: process.env.MN_INDEXER_URL,
      indexerWsUrl: process.env.MN_INDEXER_WS_URL,
      walletKeys,
    },
  );
  let server;
  let submission;
  let dispatches = 0;
  let issued;
  let admitted;
  try {
    const handler = createClaimSponsorHandler(
      'http://localhost:5173',
      sponsorJournalDir,
      {
        async authorize(bytes, receipt) {
          assert.ok(issued);
          assert.equal(receipt.name, name);
          assert.equal(receipt.accountAddress, accountAddress);
          await readLive({
            ...receipt,
            night: BigInt(issued.night),
            registryPayee: issued.registryPayee,
          });
          admitted = admitNativeClaim(
            bytes,
            receipt,
            { ...receipt, ...issued, night: BigInt(issued.night) },
            100_000_000_000_000_000n,
          );
        },
        async submit(bytes) {
          assert.equal(dispatches++, 0, 'Only one page-owned dispatch is permitted.');
          const tx = ledger.Transaction.deserialize('signature', 'proof', 'binding', bytes);
          submission = Promise.resolve()
            .then(() => submit({ version: 'v9', tx }))
            .then(
              (value) => ({ outcome: 'reported', id: String(value) }),
              () => ({ outcome: 'unknown' }),
            );
        },
      },
      {
        async issue(destination) {
          assert.equal(issued, undefined, 'The browser must request one fresh quote.');
          assert.deepEqual(destination, {
            networkId: 'undeployed',
            registryAddress,
            accountAddress,
            name,
          });
          const live = {
            ...destination,
            night: parentDomain.payment_config.cost_long,
            registryPayee: Buffer.from(parentDomain.owner_address.bytes).toString('hex'),
          };
          await readLive(live);
          issued = claimQuote({
            ...destination,
            id: randomBytes(32).toString('hex'),
            sponsorAddress: sponsorPaymentAddress,
            sponsorPaymentAddress,
            registryPayee: live.registryPayee,
            night: String(live.night),
            maximumDust: '100000000000000000',
            expiresAt: Date.now() + 240_000,
          });
          return issued;
        },
        async authorizeQuote(candidate) {
          assert.deepEqual(candidate, issued);
          assert.deepEqual(claimDestination(candidate), {
            networkId: 'undeployed',
            registryAddress,
            accountAddress,
            name,
          });
          await readLive({
            ...candidate,
            night: BigInt(candidate.night),
          });
        },
        async balance(bytes, ttl) {
          const tx = ledger.Transaction.deserialize('signature', 'proof', 'pre-binding', bytes);
          const result = await walletProvider.balanceTx({ version: 'v9', tx }, ttl);
          assert.equal(result.version, 'v9');
          return result.tx.serialize();
        },
        async retireIndexedFailure(original) {
          assert.ok(failedOriginal);
          assert.deepEqual(original, failedOriginal);
          return verifyIndexedClaimFailure({
            receipt: original,
            nodeUrl: process.env.MN_NODE_URL,
            indexerUrl: process.env.MN_INDEXER_URL,
            protocolVersion: 2001100,
            reader: reads,
            profile,
          });
        },
      },
      (error) =>
        console.error('Page claim sponsor:', error instanceof Error ? error.message : error),
    );
    server = createServer((request, response) => {
      void handler(request, response).then(
        (handled) => {
          if (!handled) response.writeHead(404).end();
        },
        () => response.destroy(),
      );
    });
    server.listen(0, 'localhost');
    await once(server, 'listening');
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    step('page-owned-quote-proof-prepare-send-and-recover');
    await runBrowser(output, address.port, 450_000, 'e2e/midnames-native-page.e2e.ts', {
      PASSPORT_MIDNAMES_OWNER_PORT: new URL(owner.origin).port,
    });
    const page = JSON.parse(readFileSync(join(output, 'page-owned-claim.json'), 'utf8'));
    const receipt = openClaimDispatch(sponsorJournalDir).preparedReceipt();
    assert.deepEqual(page.original, receipt);
    assert.equal(dispatches, 1);
    assert.ok(admitted);
    const deadline = Date.now() + 120_000;
    while (Date.now() < deadline) {
      const finality = await readClaimFinality(process.env.MN_INDEXER_URL, receipt, fetch, 2001100);
      if (finality === true) break;
      assert.ok(finality === false || finality === undefined, `Page claim status: ${finality}`);
      await delay(1500);
    }
    assert.equal(
      await readClaimFinality(process.env.MN_INDEXER_URL, receipt, fetch, 2001100),
      true,
    );
    assert.deepEqual(await reads.readClaim(name, profile), {
      ownerCommitment: receipt.ownerCommitment,
      target: { kind: 'contract', address: accountAddress },
    });
    return { receipt, quote: issued, page, admitted, dispatches };
  } finally {
    if (server?.listening) {
      server.close();
      server.closeAllConnections();
      await once(server, 'close');
    }
    if (submission) {
      const result = await Promise.race([submission, delay(30_000).then(() => undefined)]);
      if (result) saveIsolationReceipt(join(output, 'page-submit-result.json'), result);
    }
    await owner.close();
  }
}
