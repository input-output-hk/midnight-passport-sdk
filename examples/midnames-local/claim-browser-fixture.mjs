import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { admitNativeClaim } from '../../apps/passport-dapp/src/midnames/claim-native-admission.ts';
import { isolatedProcesses } from '../../scripts/qualification/native-isolation-control.mjs';
import { saveIsolationReceipt } from '../../scripts/qualification/native-isolation-files.mjs';
import { createClaimSponsorHandler } from './claim-sponsor-http.mts';

const fixtureDustCeiling = 100_000_000_000_000_000n;
const fixtureNightCeiling = 1n;
const appRoot = fileURLToPath(new URL('../../apps/passport-dapp/', import.meta.url));

async function runBrowser(output, port) {
  // The browser driver shares the worker's process group, so the outer
  // isolation runner can also terminate it after a hard worker failure.
  const owner = isolatedProcesses((group, signal) => process.kill(-group, signal));
  const interrupted = new AbortController();
  const interrupt = () => interrupted.abort(new Error('Native browser driver interrupted.'));
  const waitSignal = AbortSignal.any([interrupted.signal, AbortSignal.timeout(270_000)]);
  process.once('SIGINT', interrupt);
  process.once('SIGTERM', interrupt);
  try {
    const child = spawn(
      process.execPath,
      ['--import', 'tsx', 'e2e/midnames-recovery.e2e.ts', output],
      {
        cwd: appRoot,
        env: { ...process.env, PASSPORT_MIDNAMES_SPONSOR_PORT: String(port) },
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
export async function qualifyBrowserClaim({ output, quote, receipt, ledger, submit, readLive }) {
  saveIsolationReceipt(join(output, 'original-claim.json'), receipt);
  const evidence = {
    dispatches: 0,
    dustCeiling: String(fixtureDustCeiling),
    nightCeiling: String(fixtureNightCeiling),
  };
  const save = () => saveIsolationReceipt(join(output, 'native-claim-dispatch.json'), evidence);
  const handler = createClaimSponsorHandler('http://127.0.0.1:15189', output, {
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
      evidence.dispatches += 1;
      save();
      const tx = ledger.Transaction.deserialize('signature', 'proof', 'binding', bytes);
      evidence.originalSubmittedId = String(await submit({ version: 'v9', tx }));
      save();
    },
  });
  const server = createServer((request, response) => {
    void handler(request, response).then(
      (handled) => {
        if (!handled) response.writeHead(404).end();
      },
      () => response.destroy(),
    );
  });
  try {
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    await runBrowser(output, server.address().port);
    assert.equal(evidence.dispatches, 1);
    assert.ok(evidence.originalSubmittedId);
    const browser = JSON.parse(readFileSync(join(output, 'browser-claim-recovery.json'), 'utf8'));
    assert.equal(browser.originalDigest, receipt.transaction.sha256);
    assert.equal(browser.browserSubmissionRequests, 1);
    assert.ok(
      browser.recoveredAfterBrowserRestart &&
        browser.lostResponse &&
        browser.alternateCredentialRefused,
    );
    return { ...evidence, browser, ownerProvedInSeparateProcess: true };
  } finally {
    if (server.listening) {
      server.close();
      server.closeAllConnections();
      await once(server, 'close');
    }
  }
}
