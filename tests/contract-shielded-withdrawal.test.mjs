import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { x25519 } from '@noble/curves/ed25519.js';
import { openInboxCoin, sealInboxCoin } from '../packages/keys/dist/inbox-coin.js';
import { AccSimulator, simulationDevice } from '../scripts/qualification/acc-simulator.mjs';

const contractRequire = createRequire(
  new URL('../packages/contract/package.json', import.meta.url),
);
/** @type {typeof import('../packages/contract/dist/shielded-withdrawal.js')} */
const { deriveAccS3r1ShieldedWithdrawal } = await import(
  contractRequire.resolve('@input-output-hk/mn-passport-contract/shielded-withdrawal')
);
const adapterRequire = createRequire(
  new URL('../packages/adapter-midnight-js/package.json', import.meta.url),
);
const { ZswapOutput } = await import(adapterRequire.resolve('@midnightntwrk/ledger-v9'));

const sourceCoin = {
  nonce: new Uint8Array(32).fill(11),
  color: new Uint8Array(32).fill(22),
  value: 19n,
};
const hex = (/** @type {Uint8Array} */ bytes) => Buffer.from(bytes).toString('hex');

function commitment(
  /** @type {string} */ account,
  /** @type {import('@midnight-ntwrk/compact-runtime').EncodedShieldedCoinInfo} */ coin,
) {
  return ZswapOutput.newContractOwned(
    { nonce: hex(coin.nonce), type: hex(coin.color), value: coin.value },
    undefined,
    account,
  ).commitment;
}

for (const arm of /** @type {const} */ (['p256', 'jubjub'])) {
  for (const amount of [7n, sourceCoin.value]) {
    test(`pinned ${arm} shielded withdrawal predicts the exact effects for amount ${amount}`, async () => {
      const owner = simulationDevice(arm);
      const viewingKey = x25519.keygen();
      const sim = await AccSimulator.create({ owner, encKey: viewingKey.publicKey });
      const coin = { ...sourceCoin, mt_index: 17n };
      const recipient = { bytes: new Uint8Array(32).fill(31) };
      await sim.call('deposit_shielded', sourceCoin, new Uint8Array(192).fill(1));
      sim.heldCoin = coin;
      const expected = await deriveAccS3r1ShieldedWithdrawal(coin, amount);
      const result = await sim.authorised(
        'withdraw_shielded',
        [recipient, coin.color, amount],
        owner,
        0n,
        [coin],
      );

      const effects = sim.lastZswap;
      assert.ok(effects);
      const claims = sim.lastEffects;
      assert.ok(claims);
      assert.equal(claims.claimedNullifiers.length, 1);
      assert.deepEqual(effects.inputs, [coin]);
      const [sent, change] = effects.outputs;
      assert.ok(sent);
      assert.equal(sent.recipient.is_left, true);
      assert.deepEqual(sent.recipient.left, recipient);
      assert.deepEqual(sent.coinInfo, expected.sent);
      assert.equal(sim.ledger().inbox_count, 1n, 'change has no automatic inbox entry');
      if (expected.change) {
        assert.ok(change);
        assert.equal(effects.outputs.length, 2);
        assert.equal(result.is_some, true);
        assert.deepEqual(result.value, expected.change);
        assert.equal(change.recipient.is_left, false);
        assert.deepEqual(change.recipient.right, sim.self);
        assert.deepEqual(change.coinInfo, expected.change);
        assert.notDeepEqual(expected.sent.nonce, expected.change.nonce);
        const changeCommitment = commitment(sim.address, expected.change);
        assert.deepEqual(claims.claimedShieldedReceives, [changeCommitment]);
        assert.ok(claims.claimedShieldedSpends.includes(changeCommitment));

        const entry = await sealInboxCoin(sim.ledger().enc_key, expected.change);
        await sim.authorised('append_inbox', [entry], owner, 1n);
        const inbox = sim.ledger();
        assert.equal(inbox.inbox_count, 2n);
        assert.deepEqual(
          await openInboxCoin(viewingKey.secretKey, inbox.inbox.lookup(1n)),
          expected.change,
        );
        assert.deepEqual(sim.lastEffects?.claimedShieldedReceives, []);
        assert.deepEqual(sim.lastEffects?.claimedShieldedSpends, []);
        assert.deepEqual(sim.lastEffects?.claimedNullifiers, []);
      } else {
        assert.equal(result.is_some, false);
        assert.equal(effects.outputs.length, 1);
        assert.deepEqual(claims.claimedShieldedReceives, []);
      }
    });
  }
}

test('withdrawal prediction rejects invalid amounts and snapshots the coin bytes before loading', async () => {
  for (const amount of [-1n, 0n, 20n]) {
    await assert.rejects(deriveAccS3r1ShieldedWithdrawal(sourceCoin, amount), RangeError);
  }
  await assert.rejects(
    deriveAccS3r1ShieldedWithdrawal({ ...sourceCoin, value: 1n << 128n }, 1n),
    RangeError,
  );
  await assert.rejects(
    deriveAccS3r1ShieldedWithdrawal({ ...sourceCoin, nonce: new Uint8Array(31) }, 1n),
    RangeError,
  );
  const nonce = Buffer.from(sourceCoin.nonce);
  const color = Buffer.from(sourceCoin.color);
  const pending = deriveAccS3r1ShieldedWithdrawal({ ...sourceCoin, nonce, color }, 1n);
  nonce.fill(0);
  color.fill(0);
  const prediction = await pending;
  assert.deepEqual(prediction, await deriveAccS3r1ShieldedWithdrawal(sourceCoin, 1n));
  assert.ok(prediction.change);
  prediction.sent.color.fill(0);
  assert.deepEqual(prediction.change.color, sourceCoin.color);
});
