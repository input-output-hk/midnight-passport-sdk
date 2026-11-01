import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

// Execute the maintained consumer example. The actual host declaration check separately
// compiles this same file against published package types in the external consumer.
const source = readFileSync(
  new URL('../docs/examples/jubjub-grant-scope.ts', import.meta.url),
  'utf8',
);
const js = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const example = await import('data:text/javascript;base64,' + Buffer.from(js).toString('base64'));

test('host grant adapter preserves the authorised JubJub scope and never mutates the host record', () => {
  const input = {
    grantee: { scheme: 'jubjub-schnorr', publicKey: 'ab'.repeat(32) },
    color: '00'.repeat(32),
    recipient: { kind: 'user-address', value: 'cd'.repeat(32) },
    maxCoinValue: '3',
    operations: ['withdraw-unshielded'],
    perCallCap: '3',
    cap: '9',
    expiresAt: null,
    readPublicKey: 'ef'.repeat(32),
    read: true,
  };
  const saved = structuredClone(input);
  Object.freeze(input.grantee);
  Object.freeze(input);
  const result = example.toJubjubGrantScope(input);
  assert.deepEqual(result, saved);
  assert.deepEqual(input, saved);
  assert.notEqual(result, input);
  assert.notEqual(result.grantee, input.grantee);
});

test('unsupported secp256k1 or unknown grantees cannot be disguised as a JubJub request', () => {
  for (const scheme of ['secp256k1-ecdsa', 'p256-ecdsa', '', 'JUBJUB-SCHNORR']) {
    const input = { grantee: { scheme, publicKey: '02' + 'ab'.repeat(32) }, read: false };
    assert.throws(() => example.toJubjubGrantScope(input), /requires a JubJub/);
    assert.equal(input.grantee.scheme, scheme);
  }
});

test('grant bookkeeping refuses an explicit unsupported scheme despite structural compatibility', () => {
  const grant = {
    grantId: 'ab'.repeat(32),
    slot: 0,
    scopeSalt: 'cd'.repeat(32),
    granteeScheme: 'secp256k1-ecdsa',
    granteePublicKey: '02' + 'ef'.repeat(32),
    object: { color: '00'.repeat(32), recipient: { kind: 'any' }, maxCoinValue: '3' },
  };
  const before = structuredClone(grant);
  assert.throws(() => example.toJubjubGrantBookkeeping(grant), /bookkeeping requires a JubJub/);
  assert.deepEqual(grant, before);
});

test('legacy and explicitly JubJub grant bookkeeping preserve commitments and scope', () => {
  const legacy = {
    grantId: 'ab'.repeat(32),
    slot: 2,
    scopeSalt: 'cd'.repeat(32),
    granteePublicKey: 'ef'.repeat(32),
    object: { color: '00'.repeat(32), recipient: { kind: 'any' }, maxCoinValue: '3' },
  };
  assert.deepEqual(example.toJubjubGrantBookkeeping(legacy), legacy);
  const modern = { ...legacy, granteeScheme: 'jubjub-schnorr' };
  assert.deepEqual(example.toJubjubGrantBookkeeping(modern), legacy);
});

test('grant inbox adapter refuses unsupported host-decoded grant records before SDK recovery', async () => {
  const entries = [
    {
      kind: 'grant',
      record: {
        part: 'grant',
        granteeScheme: 'secp256k1-ecdsa',
        granteePublicKey: '02' + 'ab'.repeat(32),
      },
    },
  ];
  const before = structuredClone(entries);
  let calls = 0;
  const reader = example.jubjubGrantInbox({
    openInbox: async () => {
      calls++;
      return entries;
    },
  });
  await assert.rejects(
    () => reader.openInbox('undeployed', {}, []),
    /grant inbox requires a JubJub/,
  );
  assert.equal(calls, 1);
  assert.deepEqual(entries, before);
});

test('grant inbox adapter preserves coin/device/object entries and legacy or JubJub grant records', async () => {
  const entries = [
    null,
    { kind: 'coin', coin: {} },
    { kind: 'device', device: {} },
    { kind: 'grant', record: { part: 'object', object: {} } },
    { kind: 'grant', record: { part: 'grant', granteePublicKey: 'ab'.repeat(32) } },
    {
      kind: 'grant',
      record: { part: 'grant', granteeScheme: 'jubjub-schnorr', granteePublicKey: 'cd'.repeat(32) },
    },
  ];
  const reader = example.jubjubGrantInbox({ openInbox: async () => entries });
  assert.equal(await reader.openInbox('undeployed', {}, []), entries);
});

// A malformed decoded record is refused rather than interpreted as a legacy scheme.
test('grant inbox refuses a missing decoded record', async () => {
  for (const record of [null, undefined, 'invalid']) {
    const reader = example.jubjubGrantInbox({ openInbox: async () => [{ kind: 'grant', record }] });
    await assert.rejects(() => reader.openInbox('undeployed', {}, []), /malformed host grant/);
  }
});
