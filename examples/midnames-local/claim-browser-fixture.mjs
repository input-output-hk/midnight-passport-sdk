import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { admitNativeClaim } from '../../apps/passport-dapp/src/midnames/claim-native-admission.ts';
import { saveIsolationReceipt } from '../../scripts/qualification/native-isolation-files.mjs';
import { createClaimSponsorHandler } from './claim-sponsor-http.mts';

const fixtureCeiling = 100_000_000_000_000_000n;
const appRoot = fileURLToPath(new URL('../../apps/passport-dapp/', import.meta.url));

/** Serve the one prepared original to the demo while it exercises recovery. */
export async function qualifyBrowserClaim({ output, quote, receipt, ledger, submit, readLive }) {
  saveIsolationReceipt(join(output, 'original-claim.json'), receipt);
  const evidence = { dispatches: 0, feeCeiling: String(fixtureCeiling) };
  const save = () => saveIsolationReceipt(join(output, 'native-claim-dispatch.json'), evidence);
  const handler = createClaimSponsorHandler('http://127.0.0.1:15189', output, {
    async authorize(bytes, acknowledged) {
      await readLive(quote);
      evidence.admission = admitNativeClaim(bytes, acknowledged, quote, fixtureCeiling);
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
    const child = spawn(
      process.execPath,
      ['--import', 'tsx', 'e2e/midnames-recovery.e2e.ts', output],
      {
        cwd: appRoot,
        env: { ...process.env, PASSPORT_MIDNAMES_SPONSOR_PORT: String(server.address().port) },
        stdio: 'inherit',
      },
    );
    const [code, signal] = await once(child, 'exit');
    assert.equal(signal, null);
    assert.equal(code, 0);
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
