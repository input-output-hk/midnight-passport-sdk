import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { openClaimDispatch } from '../../../examples/midnames-local/claim-dispatch.mts';
import type { ClaimReceipt } from '../src/midnames/claim-receipt.js';

const bytes = Uint8Array.of(2, 3, 5);
const original: ClaimReceipt = {
  networkId: 'undeployed',
  registryAddress: '12'.repeat(32),
  accountAddress: '34'.repeat(32),
  name: 'charlie.night',
  ownerCommitment: '56'.repeat(32),
  transaction: {
    identifiers: ['00' + '78'.repeat(32)],
    sha256: createHash('sha256').update(bytes).digest('hex'),
  },
};

function fixture(t: { after(action: () => void): void }) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'midnames-dispatch-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const journal = openClaimDispatch(root);
  journal.retain(bytes, original);
  return { root, journal, fence: join(root, 'claim-dispatch-fence.json') };
}

test('fences concurrent dispatches and reconciles the original after response loss and reopen', async (t) => {
  const { root, journal, fence } = fixture(t);
  let proceed = () => {};
  const released = new Promise<void>((resolve) => {
    proceed = resolve;
  });
  let authorizations = 0;
  const submissions: Array<{ bytes: Uint8Array; fence: unknown }> = [];
  const ports = {
    async authorize(input: Uint8Array, receipt: ClaimReceipt) {
      authorizations++;
      assert.deepEqual(input, bytes);
      assert.deepEqual(receipt, original);
      // A host callback must not change the data the dispatch will use.
      input.fill(0);
      await released;
    },
    async submit(input: Uint8Array) {
      submissions.push({
        bytes: input,
        fence: JSON.parse(readFileSync(fence, 'utf8')) as unknown,
      });
      throw Error('Node response lost');
    },
  };
  const first = journal.dispatch(original, ports);
  const second = openClaimDispatch(root).dispatch(original, ports);
  assert.equal(authorizations, 2);
  assert.equal(existsSync(fence), false);
  proceed();
  assert.deepEqual(await Promise.all([first, second]), [
    { status: 'pending', receipt: original },
    { status: 'pending', receipt: original },
  ]);
  const reopened = openClaimDispatch(root);
  assert.deepEqual(await reopened.dispatch(original, ports), {
    status: 'pending',
    receipt: original,
  });
  assert.deepEqual(submissions, [{ bytes, fence: original }]);
  assert.equal(authorizations, 2);
  assert.throws(() => reopened.retain(bytes, original), { code: 'EEXIST' });
});

test('requires exact acknowledgement and leaves policy refusals before the fence', async (t) => {
  const { journal, fence } = fixture(t);
  const ports = {
    async authorize() {
      throw new Error('Sponsor budget refused');
    },
    async submit() {
      assert.fail('Refusal must not broadcast');
    },
  };
  await assert.rejects(
    journal.dispatch({ ...original, name: 'alice.night' }, ports),
    /acknowledgement/,
  );
  await assert.rejects(journal.dispatch(original, ports), /budget/);
  assert.equal(existsSync(fence), false);
  let submissions = 0;
  assert.deepEqual(
    await journal.dispatch(original, {
      async authorize() {},
      async submit() {
        submissions++;
      },
    }),
    { status: 'pending', receipt: original },
  );
  assert.equal(submissions, 1);
});

test('fails closed on corrupted original bytes or a mismatched fence', async (t) => {
  const { root, journal, fence } = fixture(t);
  const ports = {
    async authorize() {
      assert.fail('Corrupt claims must fail before policy admission');
    },
    async submit() {
      assert.fail('Corrupt claims must not broadcast');
    },
  };
  writeFileSync(fence, JSON.stringify({ ...original, accountAddress: 'ab'.repeat(32) }), {
    mode: 0o600,
  });
  await assert.rejects(journal.dispatch(original, ports), /fence differs/);
  writeFileSync(
    join(root, 'claim-prepared.private.json'),
    JSON.stringify({ receipt: original, bytes: 'ab' }),
  );
  await assert.rejects(journal.dispatch(original, ports), /transaction differs/);
});
