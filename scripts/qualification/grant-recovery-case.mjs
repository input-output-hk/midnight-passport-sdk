// Shared assertions for generated-contract and opt-in native qualification.
// Fixtures supply the transport; neither execution tier implies a real provider pass.
import assert from 'node:assert/strict';
import {
  createPassportAccounts,
  createGrantBookkeepingRecovery,
} from '../../packages/account/dist/index.js';
import { openGrantView } from '../../packages/keys/dist/index.js';

/** @typedef {import('../../packages/account/dist/ports/index.js').PassportPorts} Ports */
/** @typedef {import('../../packages/adapter-midnight-js/dist/index.js').ReadGrantOpeningSource} Openings */
/** @typedef {ReturnType<typeof import('../../packages/adapter-midnight-js/dist/index.js').createMidnightGrantSource>} Grants */
const hex = (/** @type {Uint8Array} */ bytes) => Buffer.from(bytes).toString('hex');
const bytes = (/** @type {string} */ value) => new Uint8Array(Buffer.from(value, 'hex'));

/** This case deliberately receives no original grant journal or staged openings.
 * The fixture must make a distinct empty account profile for every requested name.
 * @param {{account:string, origin:string, pure:import('../../packages/account/dist/grant-scope.js').GrantScopePure,
 * profile:(role:'owner'|'survivor',name:string)=>Promise<Ports>,
 * grants:(openings:Openings)=>Grants,
 * grantees:Array<{grantId:string,readSecret:Uint8Array}>, effectCount:()=>number,
 * assertRetained:()=>Promise<void>, assertHoldings:()=>Promise<void>, heldCoins:0|1,
 * stage?:(summary:object)=>Promise<void>}} c
 */
export async function runGrantRecoveryCase(c) {
  assert.equal(c.grantees.length, 2);
  assert.equal(new Set(c.grantees.map((g) => g.grantId)).size, 2);
  /** @type {object[]} */ const results = [];
  const missing = { readReadPublicKey: async () => undefined };
  const commitments = c.grants(missing);
  /** @param {'owner'|'survivor'} role @param {string} name @param {Openings} [openingOverride] */
  const profile = async (role, name, openingOverride) => {
    const base = await c.profile(role, name);
    assert.ok(base.viewingKey && base.records && typeof base.chain !== 'function');
    assert.equal(await base.records.read(), undefined, 'A recovered profile must start empty.');
    const recovery = createGrantBookkeepingRecovery({
      networkId: base.network.networkId,
      origin: c.origin,
      chain: base.chain,
      viewingKey: base.viewingKey,
      commitments,
      pure: c.pure,
    });
    const grants = c.grants(openingOverride ?? recovery);
    const ports = {
      ...base,
      readGrants: grants,
      grants,
      grantCommitments: grants,
      grantDetails: grants,
      grantRoster: grants,
    };
    const accounts = createPassportAccounts(ports);
    assert.ok(accounts.openAccountAt);
    const account = await accounts.openAccountAt(c.account);
    assert.ok(account.rotateViewingKey && account.revokeGrant && account.revokeAllGrants);
    return {
      account,
      rotate: account.rotateViewingKey,
      revoke: account.revokeGrant,
      revokeAll: account.revokeAllGrants,
      recovery,
      grants,
      ports,
      chain: base.chain,
    };
  };
  /** Verify refusals before any transport effect, with the whole public view unchanged.
   * @param {()=>Promise<unknown>} work @param {string} code */
  const refusal = async (work, code) => {
    const effects = c.effectCount();
    const before = await snapshot();
    await assert.rejects(work, { code });
    assert.equal(c.effectCount(), effects, 'Refusal must precede every effect attempt.');
    assert.deepEqual(await snapshot(), before);
    await c.assertRetained();
  };
  /** @param {string} name @param {object} details */
  const record = async (name, details) => {
    const summary = { name, ...details };
    results.push(summary);
    await c.stage?.(summary);
    await c.assertRetained();
  };
  const owner = await profile('owner', 'recovered-owner');
  const snapshot = async () => {
    const view = await owner.chain.readAccount(c.account, {
      includeInbox: true,
      includeDevices: true,
    });
    assert.ok(view);
    const { hasEntry: _predicate, ...fields } = view;
    return fields;
  };
  const survivor = await profile('survivor', 'independent-reader');
  const ids = c.grantees.map((g) => g.grantId).sort();
  const roster = await commitments.readGrantRoster(c.account);
  assert.deepEqual(
    roster.entries
      .filter((g) => g.active && g.read)
      .map((g) => g.id)
      .sort(),
    ids,
  );
  /** @type {Array<import('../../packages/account/dist/ports/index.js').GrantBookkeeping>} */ const books =
    [];
  for (const grantee of c.grantees) {
    const book = await owner.recovery.recover(c.account, grantee.grantId);
    assert.equal(book.grantId, grantee.grantId);
    assert.equal('scopeDigest' in book, false);
    assert.equal('scope' in book, false);
    assert.ok(book.readPublicKey);
    books.push(book);
    await refusal(
      () => survivor.recovery.recover(c.account, grantee.grantId),
      'GrantBookkeepingUnsettled',
    );
  }
  await refusal(() => survivor.rotate(), 'GrantBookkeepingUnsettled');
  await record('original-reader-reconstruction', {
    reconstructed: 2,
    independentReaderRefused: true,
    recoveredFullIssueScope: false,
  });

  for (const [name, openings] of /** @type {Array<[string,Openings]>} */ ([
    ['absent-opening', missing],
    ['wrong-read-key', { readReadPublicKey: async () => 'ff'.repeat(32) }],
  ])) {
    const rejected = await profile('owner', name, openings);
    const targets = await rejected.grants.readActiveReadGrantTargets(c.account);
    assert.deepEqual(targets.targets.map((t) => t.grantId).sort(), ids);
    assert.ok(targets.targets.every((t) => t.readPublicKey === undefined));
    await refusal(() => rejected.rotate(), 'GrantRosterUnsettled');
  }
  await record('opening-preflight-refusals', {
    preservedActiveTargets: 2,
    noTransportEffects: true,
  });

  /** Grantees receive owner-decoded publication seals, then open with independent read keys.
   * This is not a claim of unaided grantee inbox discovery.
   * @param {Set<string>} active */
  const readers = async (active) => {
    const live = await owner.chain.readAccount(c.account, {
      includeInbox: true,
      includeDevices: true,
    });
    assert.ok(
      live?.encKey && live.inboxEntries && owner.ports.viewingKey && survivor.ports.viewingKey,
    );
    const ring = { account: c.account, encKey: live.encKey, envelopes: live.inboxEntries };
    const opened = await owner.ports.viewingKey.openInbox(
      owner.ports.network.networkId,
      ring,
      live.inboxEntries,
    );
    await survivor.ports.viewingKey.openInbox(
      survivor.ports.network.networkId,
      ring,
      live.inboxEntries,
    );
    for (const grantee of c.grantees) {
      let current = false;
      for (const entry of opened) {
        if (
          entry?.kind !== 'grant' ||
          entry.record.part !== 'view' ||
          entry.record.grantId !== grantee.grantId
        )
          continue;
        const secret = await openGrantView(grantee.readSecret, {
          account: c.account,
          grantId: grantee.grantId,
          seal: bytes(entry.record.seal),
          expectedEncKey: live.encKey,
        });
        if (secret) {
          current = true;
          secret.fill(0);
        }
      }
      assert.equal(
        current,
        active.has(grantee.grantId),
        'Only surviving grantees may open the current key.',
      );
    }
    await c.assertHoldings();
    return hex(live.encKey);
  };
  const before = await readers(new Set(ids));
  const effectsBefore = c.effectCount();
  /** @type {import('../../packages/protocol/dist/index.js').PassportEvent[]} */ const events = [];
  await owner.rotate({ onEvent: (e) => events.push(e) });
  assert.ok(events.length > 0, 'Audit checks require actual progress events.');
  const after = await readers(new Set(ids));
  assert.notEqual(after, before);
  assert.ok(c.effectCount() > effectsBefore);
  // Bookkeeping is protected capability material, never a public progress payload.
  for (const book of books) assert.ok(!JSON.stringify(events).includes(book.scopeSalt));
  await record('recovered-reader-rotation', {
    activeReadGrants: 2,
    ownerAndSurvivorRetained: true,
    heldCoinsQualified: c.heldCoins,
  });

  const first = c.grantees[0],
    second = c.grantees[1];
  assert.ok(first && second);
  const revoked = await owner.revoke(first.grantId);
  assert.equal(revoked.status, 'revoked');
  const selectiveKey = await readers(new Set([second.grantId]));
  assert.notEqual(selectiveKey, after);
  const firstLive = await commitments.readGrantCommitment(c.account, first.grantId);
  assert.equal(firstLive?.active, false);
  await refusal(() => owner.recovery.recover(c.account, first.grantId), 'GrantRevoked');
  await owner.recovery.recover(c.account, second.grantId);
  await record('selective-read-revocation', {
    revoked: 1,
    survivingReadGrants: 1,
    revokedOpeningRefused: true,
    heldCoinsQualified: c.heldCoins,
  });

  const generation = (await commitments.readGrantRoster(c.account)).generation;
  const cleared = await owner.revokeAll();
  assert.equal(cleared.status, 'cleared');
  const finalRoster = await commitments.readGrantRoster(c.account);
  assert.equal(finalRoster.generation, (generation + 1n) & ((1n << 32n) - 1n));
  assert.equal(finalRoster.entries.length, 0);
  assert.notEqual(await readers(new Set()), selectiveKey);
  // A cleared map has no individual commitment/authNonce to authenticate. The
  // recovery API deliberately reports unsettled rather than inventing a tombstone.
  for (const grantee of c.grantees)
    await refusal(
      () => owner.recovery.recover(c.account, grantee.grantId),
      'GrantBookkeepingUnsettled',
    );
  await record('all-read-revocation', {
    activeGrants: 0,
    generationAdvanced: true,
    ownerAndSurvivorRetained: true,
    heldCoinsQualified: c.heldCoins,
  });
  return {
    cases: results,
    originalJournalConsulted: false,
    fullIssueScopeRecovered: false,
    privateGranteeKeysRecovered: false,
    nativeGrantContinuationQualified: false,
  };
}
