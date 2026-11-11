import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { PassportAccount } from '@input-output-hk/mn-passport-protocol';
import { demoClaimPreparation } from '../src/midnames/claim-demo-owner.js';
import { claimQuote } from '../src/midnames/claim-quote.js';

const account = {
  address: '21'.repeat(32),
  networkId: 'undeployed',
  credentialId: Uint8Array.of(2, 3, 5),
} as PassportAccount;

test('the opt-in owner prover receives the reviewed quote and only the open passkey', async (t) => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'location');
  Object.defineProperty(globalThis, 'location', {
    configurable: true,
    value: { origin: 'http://localhost:5173' },
  });
  t.after(() => {
    if (original) Object.defineProperty(globalThis, 'location', original);
    else Reflect.deleteProperty(globalThis, 'location');
  });
  const quote = claimQuote({
    networkId: 'undeployed',
    registryAddress: '22'.repeat(32),
    accountAddress: account.address,
    name: 'alice.night',
    id: '23'.repeat(32),
    sponsorAddress: '24'.repeat(32),
    registryPayee: '25'.repeat(32),
    night: '1',
    maximumDust: '1000',
    expiresAt: Date.now() + 30_000,
  });
  let current: PassportAccount | undefined = account;
  const result = { ownerCommitment: '26'.repeat(32), bytes: Uint8Array.of(1) };
  assert.equal(
    demoClaimPreparation(undefined, () => current),
    undefined,
  );
  const preparation = demoClaimPreparation(
    '1',
    () => current,
    async () => ({
      async proveReviewedClaim(selected, id, check) {
        assert.equal(selected, quote);
        assert.deepEqual(id, account.credentialId);
        assert.notEqual(id, account.credentialId);
        check();
        return result;
      },
    }),
  );
  assert.ok(preparation);
  assert.equal(await preparation.prove(quote, account), result);
  await assert.rejects(
    preparation.prove({ ...quote, accountAddress: '28'.repeat(32) }, account),
    /no longer current/,
  );
  const stale = demoClaimPreparation(
    '1',
    () => current,
    async () => {
      current = undefined;
      return {
        async proveReviewedClaim() {
          assert.fail('A stale account must not invoke WebAuthn.');
        },
      };
    },
  );
  assert.ok(stale);
  await assert.rejects(stale.prove(quote, account), /no longer current/);
});
