// Public connector contracts: generated challenges/software ES256, synthetic transport only.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PassportConnectorError } from '../packages/account/dist/errors.js';
import { createAccountAuthorisation } from '../packages/account/dist/authorization.js';
import { pureCircuits as pure } from '../packages/contract/generated/acc-s3r1.1/index.js';
import {
  fixture,
  grantId,
  survivorId,
  tombstoneId,
} from './fixtures/overnight-p256-grant-revocation-fixture.mjs';

/** @typedef {Awaited<ReturnType<typeof fixture>>} Fixture */
/** @typedef {import('../packages/protocol/dist/index.js').PassportEvent} Event */
/** @param {Fixture} f @param {'one'|'all'} mode @param {import('../packages/protocol/dist/index.js').FlowOptions} [options] */
async function revoke(f, mode, options = f.options) {
  if (mode === 'one') {
    assert.ok(f.account.revokeGrant);
    return f.account.revokeGrant(grantId, options);
  }
  assert.ok(f.account.revokeAllGrants);
  return f.account.revokeAllGrants(options);
}

for (const mode of /** @type {const} */ (['one', 'all'])) {
  test(`${mode}: read revocation finishes holdings before a fresh final assertion and retains both receipts`, async () => {
    const f = await fixture();
    /** @type {Event[]} */ const events = [];
    const result = await revoke(f, mode, {
      signal: f.options.signal,
      onEvent: (event) => events.push(event),
    });
    assert.equal(result.status, mode === 'one' ? 'revoked' : 'cleared');
    assert.equal(result.txHash, 'original-final-receipt');
    assert.ok('txIds' in result);
    assert.deepEqual(result.txIds, ['original-final-id']);
    assert.ok(result.rotation);
    const rotated = f.calls.findIndex((call) => call.circuit === 'rotate_enc_key_with_p256');
    assert.equal(result.rotation.txHash, f.receipts[rotated]?.txHash);
    assert.deepEqual(
      result.rotation.sealedReadGrants.map((entry) => entry.grantId),
      mode === 'one' ? [survivorId] : [],
    );
    const circuit = `revoke_${mode === 'all' ? 'all_grants' : 'grant'}_with_p256`;
    const holding = f.trace.lastIndexOf('call:append_inbox_with_p256:holding');
    assert.ok(holding > f.trace.indexOf('call:rotate_enc_key_with_p256'));
    assert.ok(holding < f.trace.indexOf(`sign:${circuit}`));
    assert.ok(f.trace.indexOf(`sign:${circuit}`) < f.trace.indexOf(`call:${circuit}`));
    assert.equal(f.state.finalSigns, 1);
    assert.equal(f.state.finalCalls, 1);
    assert.deepEqual(f.sessions, [{ kind: 'rotate-encryption-key', account: f.account.address }]);
    const final = f.calls.at(-1);
    const first = f.calls[0];
    assert.ok(final && first);
    assert.ok(f.calls.every((call) => call.signal === f.options.signal));
    assert.notEqual(final.onEvent, first.onEvent, 'The nested rotation owns a distinct Flow.');
    const outer = events[0]?.flowId;
    const outerEvents = events.filter((event) => event.flowId === outer);
    assert.ok(new Set(events.map((event) => event.flowId)).size >= 2);
    assert.deepEqual(
      outerEvents.filter((event) => event.phase === 'start').map((event) => event.step),
      mode === 'one'
        ? [
            'grant.roster',
            'chain.read',
            'grant.roster',
            'chain.read',
            'grant.roster',
            'counter.scan',
            'passkey.sign',
            'grant.roster',
            'chain.read',
            'grant.roster',
          ]
        : [
            'grant.roster',
            'grant.roster',
            'grant.roster',
            'chain.read',
            'counter.scan',
            'passkey.sign',
            'grant.roster',
            'chain.read',
            'grant.roster',
          ],
    );
    const signature = f.signed.at(-1);
    assert.ok(signature);
    const publicKey = { ...(await f.authoriser.devicePublicKey()), identity: false };
    const self = { bytes: Buffer.from(f.account.address, 'hex') };
    assert.deepEqual(
      signature.challenge,
      mode === 'one'
        ? pure.challenge_revoke_grant_with_p256(
            self,
            publicKey,
            Buffer.from(grantId, 'hex'),
            signature.authNonce,
          )
        : pure.challenge_revoke_all_grants_with_p256(self, publicKey, signature.authNonce),
    );
    assert.deepEqual(signature.witnessValues, []);
    assert.equal(result.nextUseCounter, signature.useCounter + 1n);
  });

  test(`${mode}: spend-only revocation does not open a rotation session`, async () => {
    const f = await fixture({ read: false });
    const result = await revoke(f, mode);
    assert.equal(result.rotation, undefined);
    assert.equal(f.sessions.length, 0);
    assert.equal(f.calls.length, 1);
    assert.equal(f.state.finalSigns, 1);
  });

  for (const mismatch of ['counter', 'key', 'scheme']) {
    test(`${mode}: returned ${mismatch} mismatch refuses before final dispatch`, async () => {
      const f = await fixture({ read: false });
      f.state.mismatch = mismatch;
      await assert.rejects(revoke(f, mode), {
        code: 'NotAuthorised',
        message: 'The signature names another device.',
      });
      assert.equal(f.state.finalCalls, 0);
    });
  }

  test(`${mode}: uncertain final dispatch retains the original error and never retries`, async () => {
    const f = await fixture();
    const original = new PassportConnectorError(
      'MutationUnsettled',
      'original invocation 014785 is unknown',
      {
        step: 'sponsor.submit',
        retryable: false,
      },
    );
    f.state.finalError = original;
    await assert.rejects(revoke(f, mode), (error) => error === original);
    assert.equal(f.state.finalCalls, 1);
    assert.ok(f.calls.some((call) => call.circuit === 'rotate_enc_key_with_p256'));
    assert.equal(
      f.calls.at(-1)?.circuit,
      `revoke_${mode === 'one' ? 'grant' : 'all_grants'}_with_p256`,
    );
    assert.ok(f.state.entries.some((entry) => entry.active));
  });

  test(`${mode}: pre-dispatch cancellation prevents the final effect`, async () => {
    const f = await fixture({ read: false });
    const controller = new AbortController();
    f.state.afterSign = () => controller.abort();
    await assert.rejects(revoke(f, mode, { signal: controller.signal }), { code: 'Aborted' });
    assert.equal(f.state.finalCalls, 0);
  });

  test(`${mode}: source replacement at the final Flow start is observed with its receiver`, async () => {
    const f = await fixture({ read: false });
    let replacements = 0;
    const source = {
      async readGrant() {
        assert.equal(this, source);
        replacements++;
        return { active: false, read: false, authNonce: f.ledger().authNonce };
      },
      async readGrantRoster() {
        assert.equal(this, source);
        replacements++;
        return { authNonce: f.ledger().authNonce, generation: f.state.generation, entries: [] };
      },
    };
    await assert.rejects(
      revoke(f, mode, {
        onEvent(event) {
          if (event.phase === 'start' && event.step === 'grant.roster' && f.state.finalSigns)
            Object.assign(
              f.ports,
              mode === 'one' ? { grantDetails: source } : { grantRoster: source },
            );
        },
      }),
      { code: 'GrantRosterUnsettled' },
    );
    assert.equal(replacements, 1);
    assert.equal(f.state.finalCalls, 0);
  });

  test(`${mode}: lost source retains the existing InternalError step without fallback`, async () => {
    const f = await fixture({ read: false });
    await assert.rejects(
      revoke(f, mode, {
        onEvent(event) {
          if (event.phase === 'start' && event.step === 'grant.roster' && f.state.finalSigns)
            Object.assign(
              f.ports,
              mode === 'one' ? { grantDetails: undefined } : { grantRoster: undefined },
            );
        },
      }),
      {
        code: 'InternalError',
        step: 'grant.roster',
        message: `Cannot read properties of undefined (reading '${mode === 'one' ? 'readGrant' : 'readGrantRoster'}')`,
      },
    );
    assert.equal(f.state.finalCalls, 0);
  });

  test(`${mode}: final signing uses replacement authoriser methods with the original receiver`, async () => {
    const f = await fixture({ read: false });
    const original = f.authoriser.authorise;
    let replaced = 0;
    const result = await revoke(f, mode, {
      onEvent(event) {
        if (event.phase !== 'start' || event.step !== 'passkey.sign') return;
        f.authoriser.authorise = function (request) {
          assert.equal(this, f.authoriser);
          replaced++;
          return original.call(this, request);
        };
      },
    });
    assert.equal(replaced, 1);
    assert.equal(result.txHash, 'original-final-receipt');
  });

  test(`${mode}: abort after acknowledged dispatch preserves today's unsettled direct-flow outcome`, async () => {
    const f = await fixture({ read: false });
    const controller = new AbortController();
    f.state.acknowledge = async () => controller.abort();
    await assert.rejects(revoke(f, mode, { signal: controller.signal }), { code: 'Aborted' });
    assert.equal(f.state.finalCalls, 1);
    assert.equal(
      f.state.entries.some((entry) => entry.id === grantId && entry.active),
      false,
    );
  });
}

for (const mutation of ['key', 'nonce', 'epoch', 'inactive', 'read']) {
  test(`selective read: ${mutation} change during the final assertion refuses dispatch`, async () => {
    const f = await fixture();
    f.state.afterSign = () => {
      if (mutation === 'key') f.ledger().encKey = new Uint8Array(32);
      if (mutation === 'nonce') f.ledger().authNonce++;
      if (mutation === 'epoch') f.ledger().deviceEpoch++;
      if (mutation === 'inactive' || mutation === 'read')
        f.state.entries = f.state.entries.map((entry) =>
          entry.id === grantId
            ? { ...entry, ...(mutation === 'inactive' ? { active: false } : { read: false }) }
            : entry,
        );
    };
    await assert.rejects(revoke(f, 'one'), {
      code: 'GrantRosterUnsettled',
      message: 'The grant changed before submission.',
    });
    assert.equal(f.state.finalCalls, 0);
  });
}

for (const mutation of ['generation', 'tombstone', 'membership', 'nonce']) {
  test(`complete roster: ${mutation} change during the final assertion refuses dispatch`, async () => {
    const f = await fixture();
    f.state.afterSign = () => {
      if (mutation === 'generation') f.state.generation++;
      if (mutation === 'tombstone')
        f.state.entries = f.state.entries.filter((entry) => entry.id !== tombstoneId);
      if (mutation === 'membership')
        f.state.entries = f.state.entries.filter((entry) => entry.id !== survivorId);
      if (mutation === 'nonce') f.ledger().authNonce++;
    };
    await assert.rejects(revoke(f, 'all'), {
      code: 'GrantRosterUnsettled',
      message: 'The grant roster changed.',
    });
    assert.equal(f.state.finalCalls, 0);
  });
}

test('complete roster generation change after holdings refuses before final signing', async () => {
  const f = await fixture();
  f.state.afterHoldings = () => {
    f.state.generation++;
  };
  await assert.rejects(revoke(f, 'all'), {
    code: 'GrantRosterUnsettled',
    message: 'The grant map changed during viewing-key rotation.',
  });
  assert.equal(f.state.finalSigns, 0);
  assert.equal(f.state.finalCalls, 0);
});

test('revoke-all preserves uint32 generation wrap', async () => {
  const f = await fixture({ read: false });
  f.state.generation = (1n << 32n) - 1n;
  const result = await revoke(f, 'all');
  assert.ok('generation' in result);
  assert.equal(result.generation, 0n);
});

test('challenge admission keeps selective early and revoke-all after selected-device validation', async () => {
  const f = await fixture({ read: false });
  assert.ok(typeof f.ports.binding !== 'function');
  Object.assign(f.ports.binding, {
    pureCircuits: {
      ...pure,
      challenge_revoke_grant_with_p256: undefined,
      challenge_revoke_all_grants_with_p256: undefined,
    },
  });
  assert.ok(f.account.revokeGrant);
  await assert.rejects(f.account.revokeGrant('invalid'), {
    code: 'BindingUnsupported',
    message: 'P-256 revoke needs the pinned grant binding and live grant details.',
  });
  f.state.wrongOwner = true;
  await assert.rejects(revoke(f, 'all'), {
    code: 'NotAuthorised',
    message: 'The selected device does not own this ACC.',
  });
  f.state.wrongOwner = false;
  await assert.rejects(revoke(f, 'all'), {
    code: 'BindingUnsupported',
    message: 'The binding lacks P-256 grant challenges.',
  });
  assert.equal(f.state.finalSigns, 0);
});

test('selective challenge replacement at signing start retains its pure receiver and exact arguments', async () => {
  const f = await fixture({ read: false });
  assert.ok(typeof f.ports.binding !== 'function');
  const circuits = { ...pure };
  Object.assign(f.ports.binding, { pureCircuits: circuits });
  let replacements = 0;
  const original = circuits.challenge_revoke_grant_with_p256;
  await revoke(f, 'one', {
    onEvent(event) {
      if (event.phase !== 'start' || event.step !== 'passkey.sign') return;
      circuits.challenge_revoke_grant_with_p256 = function (...args) {
        assert.equal(this, circuits);
        replacements++;
        return original.apply(this, args);
      };
    },
  });
  assert.equal(replacements, 1);
});

test('delayed final acknowledgment survives reviewed primary context expiry without losing receipts', async () => {
  const f = await fixture();
  let expired = false;
  let reviews = 0;
  f.state.acknowledge = async () => {
    expired = true;
  };
  const router = createAccountAuthorisation({
    primary: f.account,
    isContextCurrent: () => !expired,
    consent: {
      review: async () => {
        reviews++;
        return true;
      },
    },
  });
  const result = await router.run(
    {
      route: 'primary',
      flow: { kind: 'revoke-grant', account: f.account.address, grantId },
    },
    (account) => {
      assert.equal(account, f.account);
      return revoke(f, 'one');
    },
  );
  assert.equal(reviews, 1);
  assert.equal(expired, true);
  assert.equal(result.txHash, 'original-final-receipt');
  assert.ok(result.rotation?.txHash);
  assert.equal(f.state.finalCalls, 1);
});
