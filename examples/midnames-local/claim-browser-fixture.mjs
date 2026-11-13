import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { admitNativeClaim } from '../../apps/passport-dapp/src/midnames/claim-native-admission.ts';
import { isolatedProcesses } from '../../scripts/qualification/native-isolation-control.mjs';
import { saveIsolationReceipt } from '../../scripts/qualification/native-isolation-files.mjs';
import { createClaimSponsorHandler } from './claim-sponsor-http.mts';
import { createOnce } from './create-once.mts';
import { claimQuoteDigest } from '../../apps/passport-dapp/src/midnames/claim-quote.ts';

const fixtureDustCeiling = 100_000_000_000_000_000n;
const fixtureNightCeiling = 1n;
const appRoot = fileURLToPath(new URL('../../apps/passport-dapp/', import.meta.url));

export async function runBrowser(output, port, timeoutMs = 270_000) {
  // Playwright's SIGINT handler closes the Chrome process it launched
  // in its own group and exits the driver before the owner escalates.
  const owner = isolatedProcesses((group, signal) =>
    process.kill(group, signal === 'SIGTERM' ? 'SIGINT' : signal),
  );
  const interrupted = new AbortController();
  const interrupt = () => interrupted.abort(new Error('Native browser driver interrupted.'));
  const waitSignal = AbortSignal.any([interrupted.signal, AbortSignal.timeout(timeoutMs)]);
  process.once('SIGINT', interrupt);
  process.once('SIGTERM', interrupt);
  try {
    const child = spawn(
      process.execPath,
      ['--import', 'tsx', 'e2e/midnames-recovery.e2e.ts', output],
      {
        cwd: appRoot,
        env: { ...process.env, PASSPORT_MIDNAMES_SPONSOR_PORT: String(port) },
        detached: true,
        stdio: 'inherit',
      },
    );
    owner.register(child);
    const [code, signal] = await once(child, 'close', { signal: waitSignal });
    assert.equal(signal, null);
    assert.equal(code, 0);
  } finally {
    process.off('SIGINT', interrupt);
    process.off('SIGTERM', interrupt);
    assert.equal((await owner.stop(6500)).incomplete, false, 'Browser driver cleanup incomplete');
  }
}

/** Serve the one prepared original to the demo while it exercises recovery. */
export async function qualifyBrowserClaim({
  output,
  quote,
  receipt,
  reviewedQuote,
  ownerProofSha256,
  ledger,
  submit,
  readLive,
}) {
  const digest = await claimQuoteDigest(reviewedQuote);
  assert.equal(receipt.quoteSha256, digest);
  createOnce(join(output, 'quote-' + reviewedQuote.id + '.json'), JSON.stringify(reviewedQuote));
  createOnce(
    join(output, 'claim-prepare-intent.json'),
    JSON.stringify({
      quoteId: reviewedQuote.id,
      digest,
      ownerCommitment: receipt.ownerCommitment,
      proofSha256: ownerProofSha256,
    }),
  );
  saveIsolationReceipt(join(output, 'original-claim.json'), receipt);
  saveIsolationReceipt(join(output, 'original-quote.json'), reviewedQuote);
  const evidence = {
    dispatches: 0,
    dustCeiling: String(fixtureDustCeiling),
    nightCeiling: String(fixtureNightCeiling),
  };
  const save = () => saveIsolationReceipt(join(output, 'native-claim-dispatch.json'), evidence);
  let submission;
  const handler = createClaimSponsorHandler(
    'http://127.0.0.1:15189',
    output,
    {
      async authorize(bytes, acknowledged) {
        assert.ok(quote.night > 0n && quote.night <= fixtureNightCeiling);
        await readLive(quote);
        evidence.admission = admitNativeClaim(bytes, acknowledged, quote, fixtureDustCeiling);
        assert.throws(
          () =>
            admitNativeClaim(
              bytes,
              acknowledged,
              quote,
              BigInt(evidence.admission.maximumDustCharged) - 1n,
            ),
          /outside the sponsor budget/,
        );
        evidence.lowerFeeCeilingRefused = true;
        save();
      },
      async submit(bytes) {
        const tx = ledger.Transaction.deserialize('signature', 'proof', 'binding', bytes);
        evidence.dispatches += 1;
        evidence.submitOutcome = 'pending';
        save();
        // The journal has fenced the original. Let HTTP acknowledge that
        // pending state while the wallet observes the isolated node.
        submission = Promise.resolve()
          .then(() => submit({ version: 'v9', tx }))
          .then(
            (id) => ({ submitOutcome: 'reported', originalSubmittedId: String(id) }),
            () => ({ submitOutcome: 'unknown' }),
          );
      },
    },
    {
      async issue() {
        return reviewedQuote;
      },
      async authorizeQuote(candidate) {
        assert.deepEqual(candidate, reviewedQuote);
        await readLive(quote);
      },
      async balance() {
        assert.fail('The native original is already prepared.');
      },
    },
  );
  const server = createServer((request, response) => {
    void handler(request, response).then(
      (handled) => {
        if (!handled) response.writeHead(404).end();
      },
      () => response.destroy(),
    );
  });
  let browser;
  try {
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    await runBrowser(output, server.address().port);
    assert.equal(evidence.dispatches, 1);
    browser = JSON.parse(readFileSync(join(output, 'browser-claim-recovery.json'), 'utf8'));
    assert.equal(browser.originalDigest, receipt.transaction.sha256);
    assert.equal(browser.browserSubmissionRequests, 1);
    assert.ok(
      browser.recoveredAfterBrowserRestart &&
        browser.lostResponse &&
        browser.alternateCredentialRefused,
    );
  } finally {
    if (server.listening) {
      server.close();
      server.closeAllConnections();
      await once(server, 'close');
    }
    if (submission) {
      const finished = new AbortController();
      try {
        const observed = await Promise.race([
          submission,
          delay(30_000, undefined, { signal: finished.signal }),
        ]);
        if (observed) {
          Object.assign(evidence, observed);
          save();
        }
      } finally {
        finished.abort();
      }
    }
  }
  return { ...evidence, browser, ownerProvedInSeparateProcess: true };
}
