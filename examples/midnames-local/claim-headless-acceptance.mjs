// Headless local demo acceptance through owner proof and sponsor preparation.
// This deliberately never dispatches the prepared transaction.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';

const appRequire = createRequire(new URL('../../apps/passport-dapp/package.json', import.meta.url));
const { chromium } = appRequire('playwright-core');
const [registryAddress, accountAddress] = process.argv.slice(2);
assert.match(registryAddress ?? '', /^[0-9a-f]{64}$/);
assert.match(accountAddress ?? '', /^[0-9a-f]{64}$/);
assert.ok(process.env.IN_NIX_SHELL && process.env.COMPACT_DIRECTORY, 'Use the pinned Nix shell.');

const appOrigin = 'http://localhost:5173';
const name = `headless${randomBytes(5).toString('hex')}.night`;
let phase = 'quote';
async function sponsor(path, body) {
  const response = await fetch(`${appOrigin}/v1/midnames/claim/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: appOrigin },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(90_000),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  return { status: response.status, value: text ? JSON.parse(text) : undefined };
}

let browser;
let quote;
let ownerCommitment;
let preparedReceipt;
try {
  quote = (
    await sponsor('quote', {
      networkId: 'undeployed',
      registryAddress,
      accountAddress,
      name,
    })
  ).value;
  console.log(JSON.stringify({ phase, status: 'pass', name, quoteId: quote.id }));

  phase = 'virtual-passkey';
  browser = await chromium.launch({
    executablePath:
      process.env.CHROME_BIN ??
      process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ??
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: true,
  });
  const context = await browser.newContext();
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      hasPrf: true,
    },
  });
  await page.goto(`${appOrigin}/owner-claim/context`);
  const credentialId = await page.evaluate(async () => {
    const random = () => crypto.getRandomValues(new Uint8Array(32));
    const credential = await navigator.credentials.create({
      publicKey: {
        challenge: random(),
        rp: { name: 'Headless Midnames owner' },
        user: { id: random(), name: 'headless-owner', displayName: 'Headless owner' },
        pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
        authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
        extensions: { prf: {} },
      },
    });
    if (!credential) throw new Error('Virtual credential was not created.');
    return Array.from(new Uint8Array(credential.rawId));
  });
  console.log(JSON.stringify({ phase, status: 'pass' }));

  phase = 'owner-proof';
  const original = await page.evaluate(
    async ({ reviewed, credentialId: id }) => {
      const { proveReviewedClaim } = await import('/owner-claim/entry.js');
      const proved = await proveReviewedClaim(reviewed, new Uint8Array(id), () => {
        if (reviewed.expiresAt <= Date.now()) throw new Error('Reviewed quote expired.');
      });
      return {
        ownerCommitment: proved.ownerCommitment,
        proof: Array.from(proved.bytes, (byte) => byte.toString(16).padStart(2, '0')).join(''),
      };
    },
    { reviewed: quote, credentialId },
  );
  ownerCommitment = original.ownerCommitment;
  console.log(JSON.stringify({ phase, status: 'pass', proofBytes: original.proof.length / 2 }));

  phase = 'sponsor-prepare';
  preparedReceipt = (await sponsor('prepare', { quote, ...original })).value;
  assert.equal(preparedReceipt.name, name);
  assert.equal(preparedReceipt.ownerCommitment, ownerCommitment);
  console.log(JSON.stringify({ phase, status: 'pass', quoteId: quote.id, prepared: true }));
} catch (error) {
  console.error(
    JSON.stringify({
      phase,
      status: 'fail',
      name,
      quoteId: quote?.id,
      hasOwnerCommitment: !!ownerCommitment,
      error: error instanceof Error ? error.message : String(error),
    }),
  );
  process.exitCode = 1;
} finally {
  await browser?.close();
  if (quote && ownerCommitment) {
    try {
      phase = 'reconcile-original';
      const found = await sponsor('prepared', { quote, ownerCommitment });
      if (found.status === 200) preparedReceipt = found.value;
      else assert.equal(found.status, 202, 'The original preparation has an unexpected status.');
      console.log(
        JSON.stringify({ phase, status: 'pass', prepared: !!preparedReceipt, quoteId: quote.id }),
      );
      // The sponsor keeps the exact original until its reviewed TTL has expired.
      phase = 'retire-original';
      // A prepared transaction needs its own TTL plus the admission margin.
      const remaining = quote.expiresAt + (preparedReceipt ? 30_000 : 0) - Date.now();
      if (remaining > 0) await new Promise((done) => setTimeout(done, remaining + 1000));
      const retired = await sponsor(
        preparedReceipt ? 'retire-expired-unsent' : 'retire-expired-unprepared',
        preparedReceipt ?? { quote, ownerCommitment },
      );
      assert.equal(retired.value?.status, 'retired');
      console.log(
        JSON.stringify({ phase, status: 'pass', quoteId: quote.id, sponsorRestartRequired: true }),
      );
    } catch (error) {
      console.error(
        JSON.stringify({
          phase,
          status: 'fail',
          quoteId: quote.id,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
      process.exitCode = 1;
    }
  }
}
