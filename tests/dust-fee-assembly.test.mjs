import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { assembleDustFee } from '../packages/adapter-browser/dist/dust-fee-assembly.js';

const require = createRequire(new URL('../packages/adapter-browser/package.json', import.meta.url));
const ledger =
  /** @type {typeof import('../packages/adapter-browser/node_modules/@midnightntwrk/ledger-v9/ledger-v9.d.ts')} */ (
    await import(pathToFileURL(require.resolve('@midnightntwrk/ledger-v9')).href)
  );
const networkId = 'undeployed';
const address = 'ab'.repeat(32);
const circuit = 'append_inbox_with_jubjub';
const bindingId = 'acc-s3r1.1';
const now = Math.floor(Date.now() / 1000) * 1000;
const feeExpiresByMs = now + 120_000;
const ownerExpiry = new Date(now + 180_000);
const { files } = JSON.parse(
  gunzipSync(
    await readFile(
      new URL('../packages/contract/resources/acc-s3r1.1.zkir.json.gz', import.meta.url),
    ),
  ).toString(),
);
const proving = {
  check: async () => [],
  // Serialization fixture. Proof validity is covered by the isolated-chain run.
  prove: async () => new ledger.Proof('0100').serialize(),
  lookupKey: async () => ({
    proverKey: new Uint8Array(),
    verifierKey: Buffer.from(files[`keys/${circuit}.verifier`], 'base64'),
    ir: Buffer.from(files[`zkir/${circuit}.bzkir`], 'base64'),
  }),
};
const model = ledger.CostModel.initialCostModel();
const sha = (/** @type {Uint8Array} */ value) => createHash('sha256').update(value).digest('hex');

/** @param {{network?: string, withOffer?: boolean, ttl?: Date}} [options] */
async function account({ network = networkId, withOffer = false, ttl = ownerExpiry } = {}) {
  const empty = { value: [], alignment: [] };
  const intent = ledger.Intent.new(ttl).addCall(
    new ledger.ContractCallPrototype(
      address,
      circuit,
      new ledger.ContractOperation(),
      undefined,
      undefined,
      [],
      empty,
      empty,
      ledger.communicationCommitmentRandomness(),
      'fixture',
    ),
  );
  if (withOffer)
    intent.guaranteedUnshieldedOffer = ledger.UnshieldedOffer.new(
      [],
      [{ value: 5n, owner: '11'.repeat(32), type: '22'.repeat(32) }],
      [],
    );
  return ledger.Transaction.fromParts(network, undefined, undefined, intent).prove(proving, model);
}

/** @param {{network?: string, registration?: boolean, ttl?: Date, segment?: number}} [options] */
async function fee({
  network = networkId,
  registration = false,
  ttl = new Date(feeExpiresByMs),
  segment = 2,
} = {}) {
  const secret = ledger.DustSecretKey.fromBigint(11n);
  try {
    const owner = secret.publicKey;
    const backingNight = '22'.repeat(32);
    const coin = {
      initialValue: 1_000_000_000n,
      owner,
      nonce: 1n,
      seq: 0,
      ctime: new Date(now - 60_000),
      backingNight,
      mtIndex: 0n,
    };
    const wallet = new ledger.DustLocalState(ledger.LedgerParameters.initialParameters().dust)
      .insertGenerationInfo(
        0n,
        { value: 10_000_000_000n, owner, nonce: backingNight, dtime: undefined },
        backingNight,
      )
      .insertCommitment(0n, coin, true)
      .addUtxo(ledger.dustNullifier(coin, secret), coin);
    const [, spend] = wallet.spend(secret, coin, 100n, new Date(now));
    const intent = ledger.Intent.new(ttl);
    intent.dustActions = new ledger.DustActions(
      'signature',
      'pre-proof',
      new Date(now),
      [spend],
      registration
        ? [
            new ledger.DustRegistration(
              'signature',
              ledger.signatureVerifyingKey(ledger.sampleSigningKey()),
              owner,
              0n,
            ),
          ]
        : [],
    );
    return ledger.Transaction.fromParts(network)
      .addIntent({ tag: 'specific', value: segment }, intent)
      .prove(proving, model);
  } finally {
    secret.clear();
  }
}

const proved = await account();
const provedFee = await fee();
const accountBytes = proved.serialize();
const feeBytes = provedFee.serialize();
const scope = {
  networkId,
  bindingId,
  address,
  circuit,
  accountSha256: sha(accountBytes),
  maxDust: 100n,
  feeExpiresByMs,
};
const input = { ...scope, provedAccount: accountBytes, provedFee: feeBytes };

/** @param {Uint8Array} assembled */
function assertApprovedIntents(assembled) {
  const tx = ledger.Transaction.deserialize('signature', 'proof', 'binding', assembled);
  const intents = [...(tx.intents?.values() ?? [])];
  assert.equal(intents.length, 2);
  const [call] = intents.flatMap((intent) => intent.actions);
  const original = [...(proved.intents?.values() ?? [])][0]?.actions[0];
  assert.ok(call instanceof ledger.ContractCall && original instanceof ledger.ContractCall);
  assert.ok(call.proof instanceof ledger.Proof && original.proof instanceof ledger.Proof);
  assert.equal(call.address, address);
  assert.equal(call.communicationCommitment, original.communicationCommitment);
  assert.deepEqual(call.proof.serialize(), original.proof.serialize());
  assert.deepEqual(
    intents.find((intent) => intent.dustActions)?.dustActions?.serialize(),
    [...(provedFee.intents?.values() ?? [])][0]?.dustActions?.serialize(),
  );
  assert.deepEqual(intents.map((intent) => intent.ttl.getTime()).sort(), [
    feeExpiresByMs,
    ownerExpiry.getTime(),
  ]);
}

test('assembles the approved ACC and DUST intents into a finalized Ledger transaction', async () => {
  assertApprovedIntents(await assembleDustFee(input));
});

test('snapshots both input arrays before hashing', async () => {
  const accountCopy = Buffer.from(accountBytes);
  const feeCopy = Buffer.from(feeBytes);
  const result = assembleDustFee({ ...input, provedAccount: accountCopy, provedFee: feeCopy });
  accountCopy.fill(0);
  feeCopy.fill(0);
  assertApprovedIntents(await result);
});

test('refuses different calls, asset offers, wrong networks, and unapproved DUST terms', async () => {
  for (const change of [
    { address: 'cd'.repeat(32) },
    { circuit: 'withdraw_unshielded_with_p256' },
    { bindingId: 'unregistered' },
    { accountSha256: '12'.repeat(32) },
    { maxDust: 99n },
    { feeExpiresByMs: feeExpiresByMs - 1000 },
    { provedFee: accountBytes },
    { provedFee: (await fee({ network: 'preview' })).serialize() },
    { provedFee: (await fee({ registration: true })).serialize() },
    { provedFee: (await fee({ ttl: new Date(now - 1000) })).serialize() },
  ]) {
    await assert.rejects(assembleDustFee({ ...input, ...change }), { code: 'SponsorRejected' });
  }
  for (const tx of [
    await account({ withOffer: true }),
    await account({ network: 'preview' }),
    await account({ ttl: new Date(now - 1000) }),
  ]) {
    const candidate = tx.serialize();
    await assert.rejects(
      assembleDustFee({ ...input, provedAccount: candidate, accountSha256: sha(candidate) }),
      { code: 'SponsorRejected' },
    );
  }
});

test('public subpath resolves and malformed or oversized bytes fail before Ledger', async () => {
  const entry = await import(
    pathToFileURL(require.resolve('@input-output-hk/mn-passport-adapter-browser/dust-fee-assembly'))
      .href
  );
  assert.equal(entry.assembleDustFee, assembleDustFee);
  for (const value of [new Uint8Array(), new Uint8Array(8 * 1024 * 1024 + 1)]) {
    await assert.rejects(assembleDustFee({ ...input, provedAccount: value }), {
      code: 'InternalError',
    });
  }
  await assert.rejects(assembleDustFee({ ...input, provedFee: Uint8Array.of(0) }), {
    code: 'SponsorRejected',
  });
});
