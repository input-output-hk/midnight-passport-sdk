import { test } from 'node:test';
import assert from 'node:assert/strict';
import { jubjub } from '@noble/curves/misc.js';
import { hostedJubjubAuthoriser } from '../packages/adapter-browser/dist/hosted-jubjub-authoriser.js';

/** @typedef {import('../packages/account/dist/ports/index.js').FlowDescriptor} FlowDescriptor */
/** @typedef {import('../packages/adapter-browser/dist/hosted-jubjub-authoriser.js').HostedJubjubAuthoriser<string, bigint, bigint, string, FlowDescriptor>} HostedSource */

const point = jubjub.Point.BASE.toAffine();
/** @type {import('../packages/account/dist/ports/index.js').JubjubAuthorisation} */
const signature = {
  scheme: 'jubjub-schnorr',
  pk: point,
  useCounter: 7n,
  sigR: point,
  sigS: 2n,
  grindNonce: 0n,
};

/** @param {Partial<HostedSource>} [overrides] */
const make = (overrides = {}) => {
  /** @type {unknown[][]} */
  const calls = [];
  /** @type {HostedSource} */
  const source = {
    scheme: 'jubjub-schnorr',
    deviceCommitment: async (account, epoch, counter) => {
      calls.push(['commitment', account, epoch, counter]);
      return 'ab'.repeat(32);
    },
    devicePublicKey: async () => point,
    authorise: async (request) => {
      calls.push(['authorise', request]);
      return signature;
    },
    withKeySession: async (operation, flow) => {
      calls.push(['session', flow]);
      return operation();
    },
    ...overrides,
  };
  /** @type {import('../packages/adapter-browser/dist/hosted-jubjub-authoriser.js').HostedJubjubConversions<string, bigint, bigint, FlowDescriptor>} */
  const convert = {
    account: (value) => `account:${value}`,
    epoch: (value) => value + 1n,
    counter: (value) => value + 2n,
    flow: (descriptor) => ({ ...descriptor }),
  };
  const adapter = hostedJubjubAuthoriser(source, convert);
  return { adapter, calls, source, convert };
};

test('hosted authoriser preserves circuit inputs and converts branded values', async () => {
  const { adapter, calls } = make();
  const commitments = await adapter.deviceCommitments('ab'.repeat(32), 3n, [5n, 6n]);
  assert.deepEqual(commitments, ['ab'.repeat(32), 'ab'.repeat(32)]);
  assert.deepEqual(calls.slice(0, 2), [
    ['commitment', `account:${'ab'.repeat(32)}`, 4n, 7n],
    ['commitment', `account:${'ab'.repeat(32)}`, 4n, 8n],
  ]);
  const signed = await adapter.authorise({
    account: 'ab'.repeat(32),
    circuit: 'issue_grant_with_jubjub',
    args: [1n],
    witnessValues: ['witness'],
    authNonce: 9n,
    useCounter: 5n,
    challenge: () => new Uint8Array(32),
  });
  assert.equal(signed, signature);
  assert.deepEqual(calls[2]?.[1], {
    account: `account:${'ab'.repeat(32)}`,
    circuit: 'issue_grant_with_jubjub',
    args: [1n],
    witnessValues: ['witness'],
    authNonce: 9n,
    useCounter: 7n,
  });
  assert.equal(
    await adapter.devicePublicKeyHex(),
    Buffer.from(jubjub.Point.BASE.toBytes()).toString('hex'),
  );
});

test('hosted key session carries consent context and refuses unsupported owner flows', async () => {
  const { adapter, calls, source, convert } = make();
  const scope = {
    grantee: { scheme: /** @type {const} */ ('jubjub-schnorr'), publicKey: 'ab'.repeat(32) },
    operations: /** @type {const} */ (['withdraw-unshielded']),
    color: '00'.repeat(32),
    recipient: { kind: /** @type {const} */ ('any') },
    maxCoinValue: '5',
    perCallCap: '5',
    cap: '5',
    expiresAt: null,
    read: false,
  };
  /** @type {FlowDescriptor} */
  const descriptor = {
    kind: 'issue-grant',
    account: 'ab'.repeat(32),
    grantId: 'cd'.repeat(32),
    scope,
    slot: 2,
    scopeSalt: 'ef'.repeat(32),
    scopeDigest: '01'.repeat(32),
  };
  assert.equal(await adapter.withKeySession(async () => 42, descriptor), 42);
  assert.deepEqual(calls[0], ['session', descriptor]);
  assert.throws(
    () => adapter.withKeySession(async () => 0, { kind: 'rotate-encryption-key' }),
    /no rotate-encryption-key consent descriptor/,
  );
  assert.throws(
    () =>
      adapter.withKeySession(async () => 0, {
        kind: 'withdraw-unshielded',
        account: 'ab'.repeat(32),
        color: '01'.repeat(32),
        amount: '7',
        recipient: '02'.repeat(32),
      }),
    /no withdraw-unshielded consent descriptor/,
  );
  assert.throws(
    () =>
      adapter.withKeySession(async () => 0, {
        kind: 'withdraw-shielded',
        account: 'ab'.repeat(32),
        color: '01'.repeat(32),
        amount: '7',
        recipient: '02'.repeat(32),
        inboxIndex: 3,
      }),
    /no withdraw-shielded consent descriptor/,
  );
  assert.equal(calls.length, 1);
  const lossy = hostedJubjubAuthoriser(source, {
    ...convert,
    flow: () => ({ kind: 'sign-in' }),
  });
  assert.throws(
    () => lossy.withKeySession(async () => 0, descriptor),
    /consent descriptor changed/,
  );
  assert.equal(calls.length, 1);
});

test('hosted authoriser refuses wrong scheme, missing session and invalid public key', async () => {
  const { adapter, source, convert } = make();
  assert.throws(
    () =>
      adapter.authorise({
        account: 'ab'.repeat(32),
        circuit: 'issue_grant_with_p256',
        args: [],
        witnessValues: [],
        authNonce: 0n,
        useCounter: 0n,
      }),
    /does not use the JubJub arm/,
  );
  const { withKeySession: _session, ...withoutSession } = source;
  assert.throws(() => hostedJubjubAuthoriser(withoutSession, convert), /needs a key session/);
  const invalid = make({ devicePublicKey: async () => ({ x: 1n, y: 1n }) });
  await assert.rejects(invalid.adapter.devicePublicKeyHex());
});
