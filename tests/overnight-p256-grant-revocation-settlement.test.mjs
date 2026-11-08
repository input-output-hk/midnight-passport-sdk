// Internal observation contracts inject time; no crypto/proof or native qualification.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { startFlow } from '../packages/account/dist/flow.js';
import { PassportConnectorError } from '../packages/account/dist/errors.js';
import {
  settleAllGrantRevocation,
  settleSingleGrantRevocation,
} from '../packages/account/dist/p256-grant-revocation-completion.js';
import { createFakePorts, FAKE_POLICY } from '../packages/account/dist/testing/index.js';

/** @typedef {import('../packages/account/dist/p256-grant-revocation-types.js').GrantRevocationOperation} Operation */
/** @typedef {import('../packages/account/dist/p256-grant-revocation-types.js').SingleGrantRevocation} Single */
/** @typedef {import('../packages/account/dist/p256-grant-revocation-types.js').AllGrantRevocation} All */
/** @typedef {import('../packages/account/dist/p256-grant-revocation-types.js').SignedSingleGrantRevocation} Approval */
/** @typedef {import('../packages/account/dist/ports/index.js').GrantDetailSource} Details */
/** @typedef {import('../packages/account/dist/grant-roster.js').GrantRoster} Roster */
const grantId = 'ab'.repeat(32);

async function fixture() {
  const fake = createFakePorts();
  /** @type {Array<Awaited<ReturnType<Details['readGrant']>>>} */ const details = [];
  /** @type {Roster[]} */ const rosters = [];
  /** @type {import('../packages/protocol/dist/index.js').PassportEvent[]} */ const events = [];
  /** @type {number[]} */ const sleeps = [];
  let reads = 0;
  const grant = { active: true, read: false, authNonce: 4n };
  const entry = { id: grantId, active: true, read: false };
  const roster = { authNonce: 4n, generation: 7n, entries: [entry] };
  const record = {
    address: 'cd'.repeat(32),
    scheme: /** @type {const} */ ('p256-webauthn'),
    status: /** @type {const} */ ('active'),
    credentialId: Uint8Array.of(1),
    publicKey: await fake.authoriser.devicePublicKey(),
    policy: FAKE_POLICY,
  };
  const view = {
    booted: true,
    specVersion: 3,
    entryCount: 1,
    authNonce: 4n,
    deviceEpoch: 0n,
    hasEntry: () => false,
  };
  const flow = startFlow({ onEvent: (event) => events.push(event) }, fake.random);
  /** @type {Operation} */
  const operation = {
    record,
    options: {},
    flow,
    host: {
      ports: {
        grantDetails: {
          async readGrant() {
            reads++;
            return details.shift() ?? grant;
          },
        },
        grantRoster: {
          async readGrantRoster() {
            reads++;
            return rosters.shift() ?? roster;
          },
        },
      },
      authoriser: fake.authoriser,
      network: fake.network,
      binding: async () => fake.binding,
      chain: async () => fake.chain,
      readView: async () => view,
      findCounter: async () => undefined,
      notHeld: () => new PassportConnectorError('AccountNotFound', 'not held'),
      rotate: async () => {
        throw new Error('Settlement must not rotate.');
      },
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    },
  };
  /** @type {Single} */ const single = {
    pure: fake.binding.pureCircuits,
    grantId,
    grant,
    view,
    rotation: undefined,
    rotated: undefined,
  };
  /** @type {All} */ const all = {
    roster,
    baseline: `${grantId}:1:0`,
    view,
    rotation: undefined,
    rotated: undefined,
  };
  /** @type {Approval} */ const approval = {
    counter: 2n,
    id: Buffer.from(grantId, 'hex'),
    signed: {
      scheme: 'p256-webauthn',
      pk: record.publicKey,
      useCounter: 2n,
      authenticatorData: new Uint8Array(37),
      sig: { r: 1n, s: 2n },
    },
  };
  return {
    operation,
    single,
    all,
    approval,
    grant,
    roster,
    entry,
    details,
    rosters,
    events,
    sleeps,
    reads: () => reads,
  };
}

test('selective settlement requires both inactive tombstone and advanced nonce, preserving per-read Flow steps', async () => {
  const f = await fixture();
  f.details.push(
    { ...f.grant, authNonce: 5n },
    { ...f.grant, active: false },
    { ...f.grant, active: false, authNonce: 5n },
  );
  const result = await settleSingleGrantRevocation(f.operation, f.single, f.approval, {
    txHash: 'original',
  });
  assert.equal(result.txHash, 'original');
  assert.equal(result.nextUseCounter, 3n);
  assert.equal(f.reads(), 3);
  assert.deepEqual(f.sleeps, [1000, 1000]);
  assert.deepEqual(
    f.events.map((event) => event.phase),
    ['start', 'end', 'start', 'end', 'start', 'end'],
  );
  assert.equal(new Set(f.events.map((event) => event.id)).size, 3);
});

test('all settlement requires advanced nonce, exact generation and empty complete map within one Flow step', async () => {
  const f = await fixture();
  f.rosters.push(
    { ...f.roster, generation: 8n, entries: [] },
    { ...f.roster, authNonce: 5n, entries: [] },
    { ...f.roster, authNonce: 5n, generation: 8n },
    { ...f.roster, authNonce: 5n, generation: 8n, entries: [] },
  );
  const result = await settleAllGrantRevocation(f.operation, f.all, f.approval, {
    txHash: 'original',
  });
  assert.equal(result.txHash, 'original');
  assert.equal(result.generation, 8n);
  assert.equal(f.reads(), 4);
  assert.deepEqual(f.sleeps, [1000, 1000, 1000]);
  assert.deepEqual(
    f.events.map((event) => event.phase),
    ['start', 'end'],
  );
  assert.equal(new Set(f.events.map((event) => event.id)).size, 1);
});

for (const mode of ['one', 'all']) {
  test(`${mode}: unsettled observation keeps the exact bounded polling/error behavior`, async () => {
    const f = await fixture();
    const work =
      mode === 'one'
        ? settleSingleGrantRevocation(f.operation, f.single, f.approval, { txHash: 'original' })
        : settleAllGrantRevocation(f.operation, f.all, f.approval, { txHash: 'original' });
    await assert.rejects(work, {
      code: 'GrantRosterUnsettled',
      message:
        mode === 'one'
          ? 'The submitted grant revocation did not settle.'
          : 'The submitted revoke-all did not clear the live ACC grant map.',
    });
    assert.equal(f.reads(), 30);
    assert.deepEqual(f.sleeps, Array(29).fill(1000));
  });
}

test('all settlement validates the complete returned roster before accepting a terminal observation', async () => {
  const f = await fixture();
  f.rosters.push({ authNonce: 5n, generation: 8n, entries: [f.entry, f.entry] });
  await assert.rejects(
    settleAllGrantRevocation(f.operation, f.all, f.approval, { txHash: 'original' }),
    {
      code: 'BindingUnsupported',
      message: 'Invalid live ACC grant roster.',
      step: 'grant.roster',
    },
  );
  assert.equal(f.reads(), 1);
  assert.deepEqual(f.sleeps, []);
});
