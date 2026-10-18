import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prepareLocalnetNight, type NightWallet } from '../src/night-preparation.ts';

test('NIGHT preparation creates an exact-value self transfer before deposit', async () => {
  const calls: string[] = [];
  const wallet: NightWallet = {
    async transferTransaction(outputs) {
      calls.push('transfer');
      assert.equal(outputs[0].outputs[0].type, '00'.repeat(32));
      assert.equal(outputs[0].outputs[0].amount, 10n);
      assert.equal(outputs[0].outputs[0].receiverAddress.hexString.length, 64);
      return 'recipe';
    },
    async signRecipe(recipe, sign) {
      calls.push('sign');
      assert.equal(recipe, 'recipe');
      await sign(new Uint8Array([1]));
      return 'signed';
    },
    async finalizeRecipe(recipe) {
      calls.push('finalize');
      assert.equal(recipe, 'signed');
      return 'finalized';
    },
    async submitTransaction(tx) {
      calls.push('submit');
      assert.equal(tx, 'finalized');
      return 'tx-id';
    },
  };
  const sign = async (payload: Uint8Array): Promise<unknown> => {
    assert.deepEqual([...payload], [1]);
    return 'signature';
  };
  assert.equal(
    await prepareLocalnetNight(wallet, new Uint8Array(32), sign, new Uint8Array(32), 10n),
    'tx-id',
  );
  assert.deepEqual(calls, ['transfer', 'sign', 'finalize', 'submit']);
  calls.length = 0;
  assert.equal(
    await prepareLocalnetNight(wallet, new Uint8Array(32), sign, new Uint8Array(32).fill(1), 10n),
    undefined,
  );
  assert.deepEqual(calls, []);
});
