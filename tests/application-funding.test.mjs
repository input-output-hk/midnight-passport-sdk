import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  originalFundingInput,
  hasOriginalFundingInput,
  confirmOriginalFunding,
  assertOriginalFundingSpend,
} from '../examples/application-acc/native-funding.mjs';
// Public deterministic localnet address vector, not a credential or private key.
const walletOwnerBech32 =
  'mn_addr_undeployed1h3ssm5ru2t6eqy4g3she78zlxn96e36ms6pq996aduvmateh9p9sk96u7s';
const owner = 'bc610dd07c52f59012a88c2f9f1c5f34cbacc75b868202975d6f19beaf37284b',
  hash = '22'.repeat(32),
  intentHash = '33'.repeat(32),
  block = '44'.repeat(32),
  finalized = '55'.repeat(32),
  color = '00'.repeat(32);
function transfer() {
  const intent = {
    intentHash: () => intentHash,
    guaranteedUnshieldedOffer: undefined,
    fallibleUnshieldedOffer: {
      outputs: [
        { value: 12n, owner, type: color },
        { value: 1000n, owner, type: color },
      ],
    },
  };
  return { transactionHash: () => hash, intents: new Map([[1, intent]]) };
}
const input = originalFundingInput(transfer(), owner);
const coin = { value: 12n, owner, type: color, intentHash, outputNo: 0 };
const walletCoin = { ...coin, owner: walletOwnerBech32 };

test('retained transfer selects an immutable exact original output identity', () => {
  assert.deepEqual(input, { hash, intentHash, outputNo: 0, owner, color, amount: 12n });
  assert.equal(Object.isFrozen(input), true);
  assert.equal(
    hasOriginalFundingInput(
      { isSynced: true, unshielded: { availableCoins: [{ utxo: walletCoin }] } },
      input,
      walletOwnerBech32,
    ),
    true,
  );
});

for (const changed of [
  { value: 13n },
  { owner: '66'.repeat(32) },
  { type: '77'.repeat(32) },
  { intentHash: '88'.repeat(32) },
  { outputNo: 1 },
]) {
  test(`another coin cannot stand in for the original funding input: ${Object.keys(changed)[0]}`, () => {
    assert.equal(
      hasOriginalFundingInput(
        {
          isSynced: true,
          unshielded: { availableCoins: [{ utxo: { ...walletCoin, ...changed } }] },
        },
        input,
        walletOwnerBech32,
      ),
      false,
    );
  });
}

test('missing, unsynchronised and duplicate observations never select a replacement', () => {
  assert.equal(
    hasOriginalFundingInput(
      { isSynced: true, unshielded: { availableCoins: [] } },
      input,
      walletOwnerBech32,
    ),
    false,
  );
  assert.equal(
    hasOriginalFundingInput(
      { isSynced: false, unshielded: { availableCoins: [{ utxo: walletCoin }] } },
      input,
      walletOwnerBech32,
    ),
    false,
  );
  assert.throws(
    () =>
      hasOriginalFundingInput(
        {
          isSynced: true,
          unshielded: { availableCoins: [{ utxo: walletCoin }, { utxo: walletCoin }] },
        },
        input,
        walletOwnerBech32,
      ),
    /Ambiguous/,
  );
});

test('missing exact output, ambiguous offers and duplicate exact amounts refuse', () => {
  const t = transfer(),
    i = t.intents.get(1);
  assert.ok(i);
  i.fallibleUnshieldedOffer.outputs[0] = { value: 13n, owner, type: color };
  assert.throws(() => originalFundingInput(t, owner), /do not resplit/);
  i.fallibleUnshieldedOffer.outputs[0] = { value: 12n, owner, type: color };
  i.fallibleUnshieldedOffer.outputs.push({ value: 12n, owner, type: color });
  assert.throws(() => originalFundingInput(t, owner), /do not resplit/);
  const many = transfer();
  many.intents.set(2, { ...i });
  assert.throws(() => originalFundingInput(many, owner), /unambiguous/);
});

/** @param {string} [mode] */
function evidence(mode = 'normal') {
  /** @type {Array<{url:string,body:any}>} */ const calls = [];
  const post = async (/** @type {string} */ url, /** @type {any} */ body) => {
    calls.push({ url, body });
    if (mode === 'transport') throw Error('private transport diagnostics');
    if (url.endsWith('/graphql')) {
      const row = {
        hash: mode === 'other-hash' ? '66'.repeat(32) : hash,
        block: { hash: block, height: mode === 'bad-height' ? -1 : 12 },
        transactionResult: {
          status: mode === 'failed' ? 'FAILURE' : 'SUCCESS',
          segments: [{ id: 1, success: mode !== 'failed-segment' }],
        },
      };
      return {
        ...(mode === 'index-error' ? { errors: ['private indexer error'] } : {}),
        data: { transactions: mode === 'missing' ? [] : mode === 'duplicate' ? [row, row] : [row] },
      };
    }
    if (body.method === 'chain_getFinalizedHead')
      return mode === 'rpc-error' ? { error: {} } : { result: '0x' + finalized };
    if (body.method === 'chain_getHeader')
      return {
        result: {
          number: mode === 'not-finalized' ? '0xb' : mode === 'bad-finalized-height' ? '12' : '0xc',
        },
      };
    assert.equal(body.method, 'chain_getBlockHash');
    assert.deepEqual(body.params, [12]);
    return { result: '0x' + (mode === 'fork' ? '99'.repeat(32) : block) };
  };
  return { calls, post };
}

test('successful original transfer is independently tied to canonical finalized node data', async () => {
  const e = evidence();
  assert.deepEqual(await confirmOriginalFunding(hash, e), {
    txHash: hash,
    blockHash: block,
    blockHeight: 12,
    finalizedHeight: '12',
    finalizedHash: finalized,
  });
  assert.equal(e.calls.length, 4);
  assert.equal(e.calls[0]?.body.variables.offset.hash, hash);
  assert.deepEqual(
    e.calls.slice(1).map((c) => c.body.method),
    ['chain_getFinalizedHead', 'chain_getHeader', 'chain_getBlockHash'],
  );
});

for (const mode of [
  'missing',
  'other-hash',
  'duplicate',
  'index-error',
  'failed',
  'failed-segment',
  'bad-height',
  'rpc-error',
  'not-finalized',
  'bad-finalized-height',
  'fork',
  'transport',
]) {
  test(`unavailable or inconsistent original funding evidence refuses: ${mode}`, async () => {
    const e = evidence(mode);
    await assert.rejects(confirmOriginalFunding(hash, e));
    assert.ok(
      e.calls.every((c) =>
        c.url.endsWith('/graphql')
          ? !c.body.query.includes('mutation')
          : c.body.method.startsWith('chain_get'),
      ),
    );
  });
}

test('invalid original hash refuses before any network call', async () => {
  const e = evidence();
  await assert.rejects(confirmOriginalFunding('private invalid input', e));
  assert.equal(e.calls.length, 0);
});

for (const helper of ['native-funding.mjs', 'native-observation.mjs'])
  test(`worker rejects changed ${helper} before evaluation or native output creation`, () => {
    const root = mkdtempSync(join(tmpdir(), 'passport-funding-guard-'));
    try {
      writeFileSync(
        join(root, 'worker.mjs'),
        readFileSync(resolve('examples/application-acc/qualify-native.mjs')),
      );
      writeFileSync(
        join(root, helper),
        `import {writeFileSync} from 'node:fs';writeFileSync(${JSON.stringify(join(root, 'unexpected-helper-evaluation'))},'bad');throw Error('tampered helper evaluated');`,
      );
      const config = JSON.stringify({
        output: 'native-run-fixture',
        files: { [helper]: '00'.repeat(32) },
      });
      writeFileSync(join(root, 'native-config.private.json'), config);
      const env = {
        ...process.env,
        PASSPORT_MERCHANT_NATIVE: '1',
        MN_NETWORK_ID: 'undeployed',
        PASSPORT_MERCHANT_CONFIG_SHA256: createHash('sha256').update(config).digest('hex'),
      };
      for (const key of [
        'NODE_OPTIONS',
        'NODE_PATH',
        'PASSPORT_SPONSOR_SEED',
        'PASSPORT_SPONSOR_SEED_FILE',
        'WALLET_SEED',
      ])
        delete (/** @type {Record<string,string|undefined>} */ (env)[key]);
      const child = spawnSync(process.execPath, [join(root, 'worker.mjs')], {
        env,
        cwd: root,
        encoding: 'utf8',
        timeout: 10000,
      });
      assert.equal(child.error, undefined);
      assert.equal(child.status, 1);
      assert.equal(existsSync(join(root, 'unexpected-helper-evaluation')), false);
      assert.equal(existsSync(join(root, 'native-run-fixture')), false);
      assert.ok(child.stderr.includes(`Changed input: ${helper}`));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

function spendingTransaction() {
  return {
    intents: new Map([
      [1, { fallibleUnshieldedOffer: { inputs: [{ ...coin, owner: 'public-signing-key' }] } }],
    ]),
  };
}
const addressFromKey = (/** @type {unknown} */ key) => {
  assert.equal(key, 'public-signing-key');
  return owner;
};

test('finalized spend binds original identity independently of wallet availability', () => {
  assert.doesNotThrow(() =>
    assertOriginalFundingSpend(spendingTransaction(), input, addressFromKey),
  );
});
for (const changed of [
  { value: 13n },
  { type: '66'.repeat(32) },
  { intentHash: '77'.repeat(32) },
  { outputNo: 1 },
  { owner: 'different-signing-key' },
]) {
  test(`pre-submit guard refuses a substituted finalized input: ${Object.keys(changed)[0]}`, () => {
    const tx = spendingTransaction(),
      entry = tx.intents.get(1);
    assert.ok(entry);
    entry.fallibleUnshieldedOffer.inputs[0] = { ...coin, owner: 'public-signing-key', ...changed };
    let sends = 0;
    assert.throws(() => {
      assertOriginalFundingSpend(tx, input, addressFromKey);
      sends++;
    });
    assert.equal(sends, 0);
  });
}

test('missing or additional NIGHT inputs refuse before a send', () => {
  const tx = spendingTransaction(),
    entry = tx.intents.get(1);
  assert.ok(entry);
  entry.fallibleUnshieldedOffer.inputs.push({ ...coin, owner: 'public-signing-key', outputNo: 1 });
  assert.throws(() => assertOriginalFundingSpend(tx, input, addressFromKey), /only the original/);
  entry.fallibleUnshieldedOffer.inputs = [];
  assert.throws(() => assertOriginalFundingSpend(tx, input, addressFromKey), /only the original/);
});

test('wallet Bech32 ownership and ledger hex ownership are kept distinct', () => {
  const state = { isSynced: true, unshielded: { availableCoins: [{ utxo: walletCoin }] } };
  assert.equal(hasOriginalFundingInput(state, input, walletOwnerBech32), true);
  assert.equal(hasOriginalFundingInput(state, input, owner), false);
});

test('a wallet owner address from another network cannot match this fixture', () => {
  const state = {
    isSynced: true,
    unshielded: {
      availableCoins: [
        { utxo: { ...walletCoin, owner: walletOwnerBech32.replace('undeployed', 'preprod') } },
      ],
    },
  };
  assert.equal(hasOriginalFundingInput(state, input, walletOwnerBech32), false);
});
