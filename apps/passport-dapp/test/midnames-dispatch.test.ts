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
import { IDBFactory } from 'fake-indexeddb';
import { openClaimDispatch } from '../../../examples/midnames-local/claim-dispatch.mts';
import { createClaimSponsorHandler } from '../../../examples/midnames-local/claim-sponsor-http.mts';
import {
  claimBalanceTtl,
  createClaimPreparationJournal,
} from '../../../examples/midnames-local/claim-preparation.mts';
import { createOnce } from '../../../examples/midnames-local/create-once.mts';
import { claimDispatchPath, isClaimSponsorOrigin } from '../src/midnames/claim-dispatch.js';
import { openClaimJournal } from '../src/midnames/claim-journal.js';
import {
  claimPreparePath,
  claimPreparedPath,
  claimQuotePath,
  claimRetirePath,
  claimRetireFailurePath,
  claimStatusPath,
} from '../src/midnames/claim-preparation-transport.js';
import { claimDestination, claimQuote, claimQuoteDigest } from '../src/midnames/claim-quote.js';
import { ClaimPreIntentRefusal } from '../src/midnames/claim-quote.js';
import type { ClaimReceipt } from '../src/midnames/claim-receipt.js';

const bytes = Uint8Array.of(2, 3, 5);

test('sponsor balance leaves browser review time without outliving the quote', () => {
  const now = Date.UTC(2026, 10, 19, 11, 20);
  assert.equal(claimBalanceTtl(now + 240_000, now).getTime(), now + 240_000);
  assert.equal(claimBalanceTtl(now + 150_000, now).getTime(), now + 150_000);
  assert.throws(() => claimBalanceTtl(now + 119_999, now), /too little time/);
});

test('archives only an expired unprepared intent and releases the sponsor for a fresh quote', async (t) => {
  const parent = realpathSync(mkdtempSync(join(tmpdir(), 'midnames-unprepared-')));
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  const root = join(parent, 'claim-journal');
  mkdirSync(root, { mode: 0o700 });
  const quote = claimQuote({
    ...claimDestination(original),
    id: 'a1'.repeat(32),
    sponsorAddress: 'a2'.repeat(32),
    sponsorPaymentAddress: 'a3'.repeat(32),
    registryPayee: 'a4'.repeat(32),
    night: '1',
    maximumDust: '10000',
    expiresAt: Date.now() - 1000,
  });
  const digest = await claimQuoteDigest(quote);
  const sibling = claimQuote({ ...quote, id: 'a5'.repeat(32), name: 'sibling.night' });
  const intent = {
    quoteId: quote.id,
    digest,
    ownerCommitment: original.ownerCommitment,
    proofSha256: original.transaction.sha256,
  };
  createOnce(join(root, `quote-${quote.id}.json`), JSON.stringify(quote));
  createOnce(join(root, `quote-${sibling.id}.json`), JSON.stringify(sibling));
  createOnce(
    join(root, `quote-decision-${quote.id}.json`),
    JSON.stringify({
      kind: 'intent',
      digest,
      ownerCommitment: intent.ownerCommitment,
      proofSha256: intent.proofSha256,
    }),
  );
  createOnce(join(root, 'claim-prepare-intent.json'), JSON.stringify(intent));
  const ports = {
    async issue() {
      return { ...quote, id: 'b1'.repeat(32), expiresAt: Date.now() + 240_000 };
    },
    async authorizeQuote() {},
    async balance() {
      assert.fail('No balancing during retirement.');
    },
    async retireExpiredUnprepared(value: typeof quote) {
      assert.deepEqual(value, quote);
    },
  };
  const dispatch = openClaimDispatch(root);
  const prep = createClaimPreparationJournal(root, dispatch, ports);
  const input = { quote, ownerCommitment: original.ownerCommitment };
  await assert.rejects(
    prep.retireExpiredUnprepared({ ...input, ownerCommitment: 'ff'.repeat(32) }),
  );
  createOnce(
    join(root, 'claim-dispatch-fence.json'),
    JSON.stringify({ ...original, quoteSha256: digest }),
  );
  await assert.rejects(prep.retireExpiredUnprepared(input), /expired, unprepared/);
  rmSync(join(root, 'claim-dispatch-fence.json'));
  dispatch.retain(bytes, { ...original, quoteSha256: digest });
  await assert.rejects(prep.retireExpiredUnprepared(input), /expired, unprepared/);
  rmSync(join(root, 'claim-prepared.private.json'));
  assert.deepEqual(await prep.retireExpiredUnprepared(input), { status: 'retired' });
  assert.deepEqual(await prep.retireExpiredUnprepared(input), { status: 'retired' });
  const archive = join(parent, `claim-journal-unprepared-${quote.id}`);
  assert.deepEqual(
    JSON.parse(readFileSync(join(archive, 'claim-prepare-intent.json'), 'utf8')),
    intent,
  );
  assert.equal(existsSync(join(root, 'claim-prepare-intent.json')), false);
  assert.equal((await prep.issue(claimDestination(original))).id, 'b1'.repeat(32));
  assert.equal(dispatch.hasAnyFence(), false);
  const reopened = createClaimPreparationJournal(root, openClaimDispatch(root), ports);
  const siblingRequest = { quote: sibling, ownerCommitment: 'ee'.repeat(32) };
  await assert.rejects(reopened.findPrepared(siblingRequest), ClaimPreIntentRefusal);
  await assert.rejects(
    reopened.findPrepared({ ...siblingRequest, ownerCommitment: 'ff'.repeat(32) }),
    ClaimPreIntentRefusal,
  );
  assert.deepEqual(
    JSON.parse(readFileSync(join(archive, `quote-decision-${sibling.id}.json`), 'utf8')),
    { kind: 'archive-refused', digest: await claimQuoteDigest(sibling) },
  );
  assert.equal(
    existsSync(join(archive, `quote-decision-${sibling.id}.json`)),
    true,
    'the no-intent decision stays beside the original issued quote',
  );
  await assert.rejects(reopened.findPrepared(siblingRequest), ClaimPreIntentRefusal);
  await assert.rejects(
    reopened.findPrepared({ ...siblingRequest, quote: { ...sibling, night: '2' } }),
  );
  writeFileSync(join(archive, `quote-${sibling.id}.json`), '{broken');
  await assert.rejects(reopened.findPrepared(siblingRequest));
});

test('a competing browser recovers its own archived no-intent quote after an unrelated lookup', async (t) => {
  const parent = realpathSync(mkdtempSync(join(tmpdir(), 'midnames-quote-browsers-')));
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  const root = join(parent, 'claim-journal');
  mkdirSync(root, { mode: 0o700 });
  const destination = claimDestination(original);
  const base = claimQuote({
    ...destination,
    id: 'a1'.repeat(32),
    sponsorAddress: 'a2'.repeat(32),
    sponsorPaymentAddress: 'a3'.repeat(32),
    registryPayee: 'a4'.repeat(32),
    night: '1',
    maximumDust: '10000',
    expiresAt: Date.now() + 1500,
  });
  const competing = claimQuote({ ...base, id: 'b1'.repeat(32) });
  const ownerA = 'e1'.repeat(32);
  const ownerB = 'e2'.repeat(32);
  const browserA = await openClaimJournal(new IDBFactory());
  const browserBFactory = new IDBFactory();
  let browserB = await openClaimJournal(browserBFactory);
  t.after(() => {
    browserA.close();
    browserB.close();
  });
  const ports = {
    issued: 0,
    async issue() {
      return this.issued++ === 0
        ? base
        : this.issued === 2
          ? competing
          : claimQuote({ ...base, id: 'c1'.repeat(32), expiresAt: Date.now() + 240_000 });
    },
    async authorizeQuote() {},
    async balance() {
      assert.fail('Recovering a no-intent quote cannot balance a transaction.');
    },
    async retireExpiredUnprepared(quote: typeof base) {
      assert.deepEqual(quote, base);
    },
  };
  const prep = createClaimPreparationJournal(root, openClaimDispatch(root), ports);
  assert.deepEqual(await prep.issue(destination), base);
  assert.deepEqual(await prep.issue(destination), competing);
  for (const [browser, quote, credential, owner] of [
    [browserA, base, 'f1'.repeat(32), ownerA],
    [browserB, competing, 'f2'.repeat(32), ownerB],
  ] as const) {
    await browser.selectName(quote.registryAddress, quote.accountAddress, credential, quote.name);
    await browser.reserve(quote, credential);
    await browser.bindOwner(quote, credential, owner);
  }
  const digest = await claimQuoteDigest(base);
  const intent = {
    quoteId: base.id,
    digest,
    ownerCommitment: ownerA,
    proofSha256: original.transaction.sha256,
  };
  createOnce(
    join(root, `quote-decision-${base.id}.json`),
    JSON.stringify({ kind: 'intent', ...intent }),
  );
  createOnce(join(root, 'claim-prepare-intent.json'), JSON.stringify(intent));
  await new Promise((resolve) => setTimeout(resolve, Math.max(0, base.expiresAt - Date.now() + 1)));
  assert.deepEqual(await prep.retireExpiredUnprepared({ quote: base, ownerCommitment: ownerA }), {
    status: 'retired',
  });
  const archive = join(parent, `claim-journal-unprepared-${base.id}`);
  const reopened = createClaimPreparationJournal(root, openClaimDispatch(root), ports);
  // The first caller is not the second browser's owner. It cannot bind the
  // sponsor's no-intent decision to itself and strand that browser.
  await assert.rejects(
    reopened.findPrepared({ quote: competing, ownerCommitment: 'ee'.repeat(32) }),
    ClaimPreIntentRefusal,
  );
  browserB.close();
  browserB = await openClaimJournal(browserBFactory);
  await assert.rejects(
    reopened.findPrepared({ quote: competing, ownerCommitment: ownerB }),
    ClaimPreIntentRefusal,
  );
  await assert.rejects(browserB.releaseRefused(competing, 'f2'.repeat(32), ownerA));
  await browserB.releaseRefused(competing, 'f2'.repeat(32), ownerB);
  assert.equal(
    await browserB.readPreparation(competing.registryAddress, competing.name, 'f2'.repeat(32)),
    undefined,
  );
  assert.deepEqual(
    await browserA.readPreparation(base.registryAddress, base.name, 'f1'.repeat(32)),
    { quote: base, ownerCommitment: ownerA },
  );
  assert.deepEqual(
    JSON.parse(readFileSync(join(archive, `quote-decision-${competing.id}.json`), 'utf8')),
    { kind: 'archive-refused', digest: await claimQuoteDigest(competing) },
  );
  const fresh = await reopened.issue(destination);
  await browserB.selectName(
    fresh.registryAddress,
    fresh.accountAddress,
    'f2'.repeat(32),
    fresh.name,
  );
  await browserB.reserve(fresh, 'f2'.repeat(32));
  assert.equal(
    (await browserB.readPreparation(fresh.registryAddress, fresh.name, 'f2'.repeat(32)))?.quote.id,
    fresh.id,
  );
  assert.notEqual(fresh.id, competing.id);
});

test('retires an expired issued quote whose prepare request never reached the sponsor', async (t) => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'midnames-no-intent-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const quote = claimQuote({
    ...claimDestination(original),
    id: 'c1'.repeat(32),
    sponsorAddress: 'c2'.repeat(32),
    sponsorPaymentAddress: 'c3'.repeat(32),
    registryPayee: 'c4'.repeat(32),
    night: '1',
    maximumDust: '10000',
    expiresAt: Date.now() - 1000,
  });
  const digest = await claimQuoteDigest(quote);
  createOnce(join(root, `quote-${quote.id}.json`), JSON.stringify(quote));
  const dispatch = openClaimDispatch(root);
  let confirmations = 0;
  const prep = createClaimPreparationJournal(root, dispatch, {
    async issue() {
      return quote;
    },
    async authorizeQuote() {},
    async balance() {
      assert.fail('A retired quote must not balance.');
    },
    async retireExpiredUnprepared() {
      confirmations++;
    },
  });
  const request = { quote, ownerCommitment: original.ownerCommitment };
  const loneDecision = join(root, `quote-decision-${quote.id}.json`);
  createOnce(
    loneDecision,
    JSON.stringify({
      kind: 'intent',
      digest,
      ownerCommitment: original.ownerCommitment,
      proofSha256: original.transaction.sha256,
    }),
  );
  await assert.rejects(prep.retireExpiredUnprepared(request), /expired, unprepared/);
  rmSync(loneDecision);
  assert.deepEqual(await prep.retireExpiredUnprepared(request), { status: 'retired' });
  assert.deepEqual(await prep.retireExpiredUnprepared(request), { status: 'retired' });
  assert.equal(confirmations, 1);
  assert.deepEqual(
    JSON.parse(readFileSync(join(root, `quote-unprepared-retired-${quote.id}.json`), 'utf8')),
    { digest, ownerCommitment: original.ownerCommitment },
  );
  await assert.rejects(prep.findPrepared(request), ClaimPreIntentRefusal);
  await assert.rejects(prep.prepare({ ...request, proof: '020305' }), ClaimPreIntentRefusal);
  assert.equal(dispatch.preparedReceipt(), undefined);
  assert.equal(dispatch.hasAnyFence(), false);
});

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

test('a sponsor funding refusal is explicit and leaves the original unfenced', async (t) => {
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
    async authorize() {
      throw new Error('The dedicated claim sponsor needs NIGHT and two DUST inputs.');
    },
    async submit() {
      assert.fail('A refused claim must not be submitted.');
    },
  });
  const response = await fetch(origin + claimDispatchPath, {
    method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify(original),
  });
  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), { code: 'SponsorNeedsFunding' });
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
  assert.equal(
    (await post(claimPreparedPath, { ...lostRace, ownerCommitment: 'ff'.repeat(32) })).status,
    409,
    'a recorded owner decision remains bound to that owner',
  );
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
  const sibling = claimQuote({ ...quote, id: '99'.repeat(32), name: 'sibling.night' });
  createOnce(join(root, `quote-${quote.id}.json`), JSON.stringify(quote));
  createOnce(join(root, `quote-${sibling.id}.json`), JSON.stringify(sibling));
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
  const reopened = createClaimPreparationJournal(root, openClaimDispatch(root), ports);
  assert.deepEqual(
    (await reopened.findPrepared({ quote, ownerCommitment: original.ownerCommitment }))?.receipt,
    retained,
  );
  await assert.rejects(
    reopened.findPrepared({ quote: sibling, ownerCommitment: 'ee'.repeat(32) }),
    ClaimPreIntentRefusal,
  );
  await assert.rejects(
    reopened.findPrepared({ quote: sibling, ownerCommitment: 'ff'.repeat(32) }),
    ClaimPreIntentRefusal,
  );
  assert.equal(confirmations, 1);
});

test('archives an exact indexed sponsor failure before a fresh quote or browser release', async (t) => {
  const parent = realpathSync(mkdtempSync(join(tmpdir(), 'midnames-failed-')));
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  const root = join(parent, 'claim-journal');
  mkdirSync(root, { mode: 0o700 });
  const quote = claimQuote({
    ...claimDestination(original),
    id: 'a1'.repeat(32),
    sponsorAddress: 'a2'.repeat(32),
    sponsorPaymentAddress: 'a3'.repeat(32),
    registryPayee: 'a4'.repeat(32),
    night: '1',
    maximumDust: '10000',
    expiresAt: Date.now() + 240_000,
  });
  const sibling = claimQuote({ ...quote, id: 'a5'.repeat(32), name: 'sibling.night' });
  const digest = await claimQuoteDigest(quote);
  const retained = { ...original, quoteSha256: digest };
  createOnce(join(root, `quote-${quote.id}.json`), JSON.stringify(quote));
  createOnce(join(root, `quote-${sibling.id}.json`), JSON.stringify(sibling));
  createOnce(
    join(root, 'claim-prepare-intent.json'),
    JSON.stringify({
      quoteId: quote.id,
      digest,
      ownerCommitment: original.ownerCommitment,
      proofSha256: original.transaction.sha256,
    }),
  );
  createOnce(
    join(root, `quote-decision-${quote.id}.json`),
    JSON.stringify({
      kind: 'intent',
      digest,
      ownerCommitment: original.ownerCommitment,
      proofSha256: original.transaction.sha256,
    }),
  );
  const journal = openClaimDispatch(root);
  journal.retain(bytes, retained);
  const next = claimQuote({ ...quote, id: 'b1'.repeat(32) });
  let reason: 'failed' | 'claim-failed' = 'claim-failed';
  let checks = 0;
  let wait: Promise<void> | undefined;
  let resume = () => {};
  const preparation = {
    async issue() {
      return next;
    },
    async authorizeQuote() {},
    async balance() {
      assert.fail('Indexed failure recovery never balances.');
    },
    async retireIndexedFailure() {
      checks++;
      await wait;
      return { reason, finalizedHash: 'c1'.repeat(32) };
    },
  };
  let handler = createClaimSponsorHandler(
    'http://127.0.0.1:1',
    root,
    {
      async authorize() {},
      async submit() {
        assert.fail('Indexed failure recovery never sends.');
      },
    },
    preparation,
  );
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
  t.after(async () => new Promise<void>((resolve) => server.close(() => resolve())));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const origin = `http://127.0.0.1:${address.port}`;
  const dispatchPorts = {
    async authorize() {},
    async submit() {
      assert.fail('Indexed failure recovery never sends.');
    },
  };
  handler = createClaimSponsorHandler(origin, root, dispatchPorts, preparation);
  const post = (path: string, input: unknown) =>
    fetch(origin + path, {
      method: 'POST',
      headers: { Origin: origin, 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
  assert.equal((await post(claimRetireFailurePath, retained)).status, 409);
  createOnce(join(root, 'claim-dispatch-fence.json'), JSON.stringify(retained));
  reason = 'failed';
  preparation.retireIndexedFailure = async () => {
    throw new Error('Indexer unavailable.');
  };
  assert.equal((await post(claimRetireFailurePath, retained)).status, 409);
  assert.equal(
    existsSync(join(parent, `claim-journal-failed-${retained.transaction.sha256}`)),
    false,
  );
  let changed = 0;
  preparation.retireIndexedFailure = async () => ({
    reason: changed++ === 0 ? 'failed' : 'claim-failed',
    finalizedHash: 'c1'.repeat(32),
  });
  assert.equal((await post(claimRetireFailurePath, retained)).status, 409);
  assert.equal(
    existsSync(join(parent, `claim-journal-failed-${retained.transaction.sha256}`)),
    false,
  );
  preparation.retireIndexedFailure = async () => {
    checks++;
    await wait;
    return { reason, finalizedHash: 'c1'.repeat(32) };
  };
  wait = new Promise<void>((resolve) => {
    resume = resolve;
  });
  const retiring = post(claimRetireFailurePath, retained);
  for (let attempt = 0; attempt < 100 && checks === 0; attempt++)
    await new Promise((resolve) => setTimeout(resolve, 1));
  assert.ok(checks > 0, 'Retirement reached the indexed failure recheck.');
  assert.equal((await post(claimQuotePath, claimDestination(original))).status, 409);
  assert.equal((await post(claimRetireFailurePath, retained)).status, 409);
  resume();
  assert.deepEqual(await (await retiring).json(), { status: 'retired', reason: 'failed' });
  const archive = join(parent, `claim-journal-failed-${retained.transaction.sha256}`);
  assert.deepEqual(openClaimDispatch(archive).preparedReceipt(), retained);
  assert.deepEqual(JSON.parse(readFileSync(join(archive, 'claim-indexed-failure.json'), 'utf8')), {
    receipt: retained,
    reason: 'failed',
    finalizedHash: 'c1'.repeat(32),
  });
  assert.equal((await post(claimQuotePath, claimDestination(original))).status, 200);
  handler = createClaimSponsorHandler(origin, root, dispatchPorts, preparation);
  assert.deepEqual(await (await post(claimRetireFailurePath, retained)).json(), {
    status: 'retired',
    reason: 'failed',
  });
  assert.equal(
    (await post(claimRetireFailurePath, { ...retained, name: 'other.night' })).status,
    409,
  );
  assert.equal(
    (await post(claimPreparedPath, { quote: sibling, ownerCommitment: 'ee'.repeat(32) })).status,
    412,
  );
});
