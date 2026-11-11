import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  Intent,
  Transaction,
  type Effects,
  type UnshieldedTokenType,
} from '@midnightntwrk/ledger-v9';
import {
  matchesRegistryCharge,
  prepareSponsoredClaim,
  type PaidClaimQuote,
} from '../src/midnames/claim-sponsorship.js';

const quote: PaidClaimQuote = {
  networkId: 'undeployed',
  registryAddress: '12'.repeat(32),
  accountAddress: '34'.repeat(32),
  name: 'alice.night',
  ownerCommitment: '56'.repeat(32),
  registryPayee: '78'.repeat(32),
  night: 7n,
};
const night: UnshieldedTokenType = { tag: 'unshielded', raw: '00'.repeat(32) };
const charge = (amount: bigint, payee: string): Effects => ({
  claimedNullifiers: [],
  claimedShieldedReceives: [],
  claimedShieldedSpends: [],
  claimedContractCalls: [],
  shieldedMints: new Map(),
  unshieldedMints: new Map(),
  unshieldedInputs: new Map([[night, amount]]),
  unshieldedOutputs: new Map([[night, amount]]),
  claimedUnshieldedSpends: new Map([[[night, { tag: 'user', address: payee }], amount]]),
});

test('a standalone sponsor quote pins the registry recipient and exact NIGHT charge', () => {
  const expected = charge(quote.night, quote.registryPayee);
  assert.equal(matchesRegistryCharge(expected, quote), true);
  for (const changed of [
    charge(quote.night + 1n, quote.registryPayee),
    charge(quote.night, quote.accountAddress),
    { ...expected, unshieldedInputs: new Map([[{ ...night, raw: '42'.repeat(32) }, quote.night]]) },
    { ...expected, unshieldedOutputs: new Map([[night, quote.night + 1n]]) },
    { ...expected, claimedUnshieldedSpends: new Map() },
    { ...expected, claimedShieldedReceives: ['ab'.repeat(32)] },
    { ...expected, unshieldedMints: new Map([[night.raw, 1n]]) },
  ]) {
    assert.equal(matchesRegistryCharge(changed, quote), false);
  }
});

test('rejects unproved or malformed bytes before calling the sponsor wallet', async () => {
  const unproved = Transaction.fromParts(
    'undeployed',
    undefined,
    undefined,
    Intent.new(new Date(Date.now() + 60_000)),
  ).serialize();
  const balance = async () => {
    assert.fail('The sponsor must not be called for invalid owner bytes');
  };
  for (const invalid of [new Uint8Array(), new Uint8Array(1024 * 1024 + 1)]) {
    await assert.rejects(prepareSponsoredClaim(quote, invalid, balance), /transaction size/);
  }
  await assert.rejects(prepareSponsoredClaim({ ...quote, night: 0n }, unproved, balance), /quote/);
  await assert.rejects(prepareSponsoredClaim(quote, unproved, balance), (error) => {
    assert.ok(!(error instanceof assert.AssertionError));
    return true;
  });
});
