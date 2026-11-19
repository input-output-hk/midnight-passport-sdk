import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { createServer } from 'node:http';
import {
  existsSync,
  mkdirSync,
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
import { createClaimSponsorHandler } from '../../../examples/midnames-local/claim-sponsor-http.mts';
import { createClaimPreparationJournal } from '../../../examples/midnames-local/claim-preparation.mts';
import { createOnce } from '../../../examples/midnames-local/create-once.mts';
import { claimDispatchPath, isClaimSponsorOrigin } from '../src/midnames/claim-dispatch.js';
import {
  claimPreparePath,
  claimPreparedPath,
  claimQuotePath,
  claimRetirePath,
  claimStatusPath,
} from '../src/midnames/claim-preparation-transport.js';
import { claimDestination, claimQuote, claimQuoteDigest } from '../src/midnames/claim-quote.js';
import { ClaimPreIntentRefusal } from '../src/midnames/claim-quote.js';
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

test('the HTTP sponsor cannot dispatch a quote-less original without preparation', async (t) => {
  const { root, fence } = fixture(t);
  let handler: ReturnType<typeof createClaimSponsorHandler>;
  const server = createServer((request, response) => {
    void handler(request, response).then(
      () => {},
      () => response.destroy(),
    );
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => new Promise<void>((resolve) => server.close(() => resolve())));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const origin = 'http://127.0.0.1:' + address.port;
  handler = createClaimSponsorHandler(origin, root, {
    async authorize() {},
    async submit() {
      assert.fail('Quote-less receipt must not be submitted.');
    },
  });
  const response = await fetch(origin + claimDispatchPath, {
    method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify(original),
  });
  assert.equal(response.status, 409);
  assert.equal(existsSync(fence), false);
});

test('changed registry terms durably refuse before sponsor intent and allow a new quote', async (t) => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'midnames-refused-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const destination = claimDestination(original);
  const quote = claimQuote({
    ...destination,
    id: '91'.repeat(32),
    sponsorAddress: '92'.repeat(32),
    sponsorPaymentAddress: '95'.repeat(32),
    registryPayee: '93'.repeat(32),
    night: '1',
    maximumDust: '10000',
    expiresAt: Date.now() + 30_000,
  });
  const next = claimQuote({ ...quote, id: '94'.repeat(32), night: '2' });
  let current = quote;
  const prep = createClaimPreparationJournal(root, openClaimDispatch(root), {
    async issue() {
      return current;
    },
    async authorizeQuote(candidate) {
      if (candidate.night !== current.night) throw new Error('Registry price changed.');
    },
    async balance() {
      assert.fail('Refusal must precede balance.');
    },
  });
  await prep.issue(destination);
  current = next;
  const request = { quote, ownerCommitment: original.ownerCommitment, proof: '020305' };
  await assert.rejects(prep.prepare(request), ClaimPreIntentRefusal);
  assert.equal(existsSync(join(root, 'claim-prepare-intent.json')), false);
  await assert.rejects(prep.findPrepared(request), ClaimPreIntentRefusal);
  await assert.rejects(prep.prepare(request), ClaimPreIntentRefusal);
  assert.equal(existsSync(join(root, 'claim-prepare-intent.json')), false);
  assert.deepEqual(await prep.issue(destination), next);
  assert.equal(
    await prep.findPrepared({ quote: next, ownerCommitment: original.ownerCommitment }),
    undefined,
  );
});

test('recovers a retained sponsor preparation over HTTP after reopening the journal', async (t) => {
  assert.equal(isClaimSponsorOrigin('http://localhost:5173'), true);
  assert.equal(isClaimSponsorOrigin('http://localhost.example:5173'), false);
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'midnames-prepare-')));
  const journal = openClaimDispatch(root);
  const destination = claimDestination(original);
  const quote = claimQuote({
    ...destination,
    id: '91'.repeat(32),
    sponsorAddress: '92'.repeat(32),
    sponsorPaymentAddress: '95'.repeat(32),
    registryPayee: '93'.repeat(32),
    night: '1',
    maximumDust: '10000',
    expiresAt: Date.now() + 30_000,
  });
  let handler: ReturnType<typeof createClaimSponsorHandler>;
  const server = createServer((request, response) => {
    void handler(request, response).then(
      (handled) => {
        if (!handled) response.writeHead(404).end();
      },
      () => response.destroy(),
    );
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(root, { recursive: true, force: true });
  });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const origin = 'http://127.0.0.1:' + address.port;
  const dispatchPorts = {
    async authorize() {},
    async submit() {
      assert.fail('This test must never broadcast.');
    },
  };
  let quoteIssues = 0;
  const preparation = {
    async issue() {
      quoteIssues++;
      return quote;
    },
    async authorizeQuote() {},
    async balance(): Promise<Uint8Array> {
      throw new Error('Unexpected second balance.');
    },
  };
  const reopen = () => {
    handler = createClaimSponsorHandler(origin, root, dispatchPorts, preparation);
  };
  reopen();
  const post = (path: string, input: unknown, from = origin) =>
    fetch(origin + path, {
      method: 'POST',
      headers: { Origin: from, 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
  assert.equal((await post(claimQuotePath, destination, 'http://127.0.0.1:1')).status, 403);
  assert.deepEqual(await (await post(claimQuotePath, destination)).json(), quote);
  const earlierQuotes = [
    claimQuote({ ...quote, id: '94'.repeat(32) }),
    claimQuote({ ...quote, id: '96'.repeat(32) }),
    claimQuote({ ...quote, id: '98'.repeat(32) }),
  ] as const;
  for (const earlier of earlierQuotes)
    createOnce(join(root, `quote-${earlier.id}.json`), JSON.stringify(earlier));
  const lookup = { quote, ownerCommitment: original.ownerCommitment };
  assert.equal((await post(claimPreparedPath, lookup)).status, 404);
  assert.equal((await post(claimPreparePath, { ...lookup, proof: 'invalid' })).status, 409);
  const intentPath = join(root, 'claim-prepare-intent.json');
  assert.equal(existsSync(intentPath), false);
  const digest = await claimQuoteDigest(quote);
  const losingDecisionPath = join(root, `quote-decision-${earlierQuotes[2].id}.json`);
  createOnce(
    losingDecisionPath,
    JSON.stringify({
      kind: 'intent',
      digest: await claimQuoteDigest(earlierQuotes[2]),
      ownerCommitment: original.ownerCommitment,
      proofSha256: createHash('sha256').update(bytes).digest('hex'),
    }),
  );
  const losingDecision = readFileSync(losingDecisionPath);
  createOnce(
    intentPath,
    JSON.stringify({
      quoteId: quote.id,
      digest,
      ownerCommitment: original.ownerCommitment,
      proofSha256: createHash('sha256').update(bytes).digest('hex'),
    }),
  );
  reopen();
  assert.equal((await post(claimQuotePath, destination)).status, 423);
  assert.equal(quoteIssues, 1);
  const originalIntent = readFileSync(intentPath);
  const superseded = { quote: earlierQuotes[0], ownerCommitment: original.ownerCommitment };
  assert.equal((await post(claimPreparedPath, superseded)).status, 412);
  assert.equal((await post(claimPreparePath, { ...superseded, proof: '020305' })).status, 412);
  const lostRace = { quote: earlierQuotes[2], ownerCommitment: original.ownerCommitment };
  assert.equal((await post(claimPreparedPath, lostRace)).status, 412);
  assert.equal((await post(claimPreparePath, { ...lostRace, proof: '020305' })).status, 412);
  assert.deepEqual(readFileSync(losingDecisionPath), losingDecision);
  assert.deepEqual(readFileSync(intentPath), originalIntent);
  assert.equal(existsSync(join(root, 'claim-dispatch-fence.json')), false);
  assert.equal((await post(claimPreparedPath, lookup)).status, 202);
  assert.equal((await post(claimPreparePath, { ...lookup, proof: '020305' })).status, 202);
  assert.equal((await post(claimPreparePath, { ...lookup, proof: '020304' })).status, 409);
  const retained = { ...original, quoteSha256: digest };
  journal.retain(bytes, retained);
  reopen();
  assert.equal((await post(claimQuotePath, destination)).status, 423);
  assert.equal(quoteIssues, 1);
  const supersededAfterReceipt = {
    quote: earlierQuotes[1],
    ownerCommitment: original.ownerCommitment,
    proof: '020305',
  };
  assert.equal((await post(claimPreparePath, supersededAfterReceipt)).status, 412);
  assert.deepEqual(readFileSync(intentPath), originalIntent);
  assert.deepEqual(journal.preparedReceipt(), retained);
  assert.deepEqual(await (await post(claimPreparedPath, lookup)).json(), retained);
  assert.deepEqual(
    await (await post(claimPreparePath, { ...lookup, proof: '020305' })).json(),
    retained,
  );
  assert.equal(
    (await post(claimPreparedPath, { ...lookup, quote: { ...quote, night: '2' } })).status,
    409,
  );
  handler = createClaimSponsorHandler(origin, root, dispatchPorts);
  assert.equal((await post(claimDispatchPath, retained)).status, 409);
  assert.equal((await post(claimDispatchPath, original)).status, 409);
  assert.equal(existsSync(join(root, 'claim-dispatch-fence.json')), false);
});

test('retires only the exact expired, unsent preparation and preserves its original journal', async (t) => {
  const parent = realpathSync(mkdtempSync(join(tmpdir(), 'midnames-retire-')));
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  const root = join(parent, 'claim-journal');
  mkdirSync(root, { mode: 0o700 });
  const quote = claimQuote({
    ...claimDestination(original),
    id: '91'.repeat(32),
    sponsorAddress: '92'.repeat(32),
    sponsorPaymentAddress: '95'.repeat(32),
    registryPayee: '93'.repeat(32),
    night: '1',
    maximumDust: '10000',
    expiresAt: Date.now() - 1000,
  });
  const digest = await claimQuoteDigest(quote);
  const retained = { ...original, quoteSha256: digest };
  createOnce(join(root, `quote-${quote.id}.json`), JSON.stringify(quote));
  createOnce(
    join(root, 'claim-prepare-intent.json'),
    JSON.stringify({
      quoteId: quote.id,
      digest,
      ownerCommitment: original.ownerCommitment,
      proofSha256: original.transaction.sha256,
    }),
  );
  const dispatch = openClaimDispatch(root);
  dispatch.retain(bytes, retained);
  let handler: ReturnType<typeof createClaimSponsorHandler>;
  const server = createServer((request, response) => {
    void handler(request, response).then(
      () => {},
      () => response.destroy(),
    );
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => new Promise<void>((resolve) => server.close(() => resolve())));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const origin = `http://127.0.0.1:${address.port}`;
  let confirmations = 0;
  const ports = {
    async issue() {
      return quote;
    },
    async authorizeQuote() {},
    async balance() {
      assert.fail('Retirement cannot spend.');
    },
    async retireExpiredUnsent(receipt: ClaimReceipt) {
      confirmations++;
      assert.deepEqual(receipt, retained);
      assert.equal(dispatch.hasFence(receipt), false);
    },
  };
  const prep = createClaimPreparationJournal(root, dispatch, ports);
  handler = createClaimSponsorHandler(
    origin,
    root,
    {
      async authorize() {},
      async submit() {
        assert.fail('Status and retirement must not submit.');
      },
    },
    ports,
  );
  const status = (receipt: ClaimReceipt) =>
    fetch(origin + claimStatusPath, {
      method: 'POST',
      headers: { Origin: origin, 'Content-Type': 'application/json' },
      body: JSON.stringify(receipt),
    });
  assert.deepEqual(await (await status(retained)).json(), { status: 'prepared' });
  assert.equal((await status({ ...retained, name: 'other.night' })).status, 409);
  await assert.rejects(prep.retireExpiredUnsent({ ...retained, name: 'other.night' }));
  assert.equal(confirmations, 0);
  createOnce(join(root, 'claim-dispatch-fence.json'), JSON.stringify(retained));
  assert.deepEqual(await (await status(retained)).json(), { status: 'sent-or-unknown' });
  await assert.rejects(prep.retireExpiredUnsent(retained), /expired, unsent/);
  rmSync(join(root, 'claim-dispatch-fence.json'));
  assert.equal(confirmations, 0);
  const retirement = await fetch(origin + claimRetirePath, {
    method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify(retained),
  });
  assert.deepEqual(await retirement.json(), { status: 'retired' });
  const archive = join(parent, `claim-journal-retired-${retained.transaction.sha256}`);
  assert.deepEqual(openClaimDispatch(archive).preparedReceipt(), retained);
  assert.equal(openClaimDispatch(root).preparedReceipt(), undefined);
  assert.deepEqual(await (await status(retained)).json(), { status: 'retired' });
  assert.deepEqual(await prep.retireExpiredUnsent(retained), { status: 'retired' });
  assert.equal(confirmations, 1);
});
