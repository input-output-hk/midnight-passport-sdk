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
} from '../examples/application-acc/native-funding.mjs';
const owner = '11'.repeat(32),
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

test('retained transfer selects an immutable exact original output identity', () => {
  assert.deepEqual(input, { hash, intentHash, outputNo: 0, owner, color, amount: 12n });
  assert.equal(Object.isFrozen(input), true);
  assert.equal(
    hasOriginalFundingInput(
      { isSynced: true, unshielded: { availableCoins: [{ utxo: coin }] } },
      input,
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
        { isSynced: true, unshielded: { availableCoins: [{ utxo: { ...coin, ...changed } }] } },
        input,
      ),
      false,
    );
  });
}

test('missing, unsynchronised and duplicate observations never select a replacement', () => {
  assert.equal(
    hasOriginalFundingInput({ isSynced: true, unshielded: { availableCoins: [] } }, input),
    false,
  );
  assert.equal(
    hasOriginalFundingInput(
      { isSynced: false, unshielded: { availableCoins: [{ utxo: coin }] } },
      input,
    ),
    false,
  );
  assert.throws(
    () =>
      hasOriginalFundingInput(
        { isSynced: true, unshielded: { availableCoins: [{ utxo: coin }, { utxo: coin }] } },
        input,
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

test('worker rejects a changed funding helper before evaluating it or creating a native output', () => {
  const root = mkdtempSync(join(tmpdir(), 'passport-funding-guard-'));
  try {
    writeFileSync(
      join(root, 'worker.mjs'),
      readFileSync(resolve('examples/application-acc/qualify-native.mjs')),
    );
    writeFileSync(
      join(root, 'native-funding.mjs'),
      `import {writeFileSync} from 'node:fs';writeFileSync(${JSON.stringify(join(root, 'unexpected-helper-evaluation'))},'bad');throw Error('tampered helper evaluated');`,
    );
    const config = JSON.stringify({
      output: 'native-run-fixture',
      files: { 'native-funding.mjs': '00'.repeat(32) },
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
    assert.match(child.stderr, /Changed input: native-funding.mjs/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
