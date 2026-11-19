import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { fetchPinnedMidnamesSource } from './upstream-source.mjs';

const source = 'pragma language_version 0.22;\n';
const manifest = {
  midnamesSourceBranch: 'ledger-9-live',
  sourceSha256: createHash('sha256').update(source).digest('hex'),
};

test('fetches the Ledger 9 branch only when its source matches the pin', async () => {
  let requestedUrl;
  const actual = await fetchPinnedMidnamesSource(manifest, async (url) => {
    requestedUrl = url;
    return new Response(source);
  });
  assert.equal(actual, source);
  assert.equal(
    requestedUrl,
    'https://raw.githubusercontent.com/midnames/ns-sdk/ledger-9-live/ns.compact',
  );
});

test('refuses a changed branch source before compilation', async () => {
  await assert.rejects(
    fetchPinnedMidnamesSource(manifest, async () => new Response(source + 'changed')),
    /branch source changed/,
  );
});

test('refuses a failed upstream fetch', async () => {
  await assert.rejects(
    fetchPinnedMidnamesSource(manifest, async () => new Response('', { status: 404 })),
    /HTTP 404/,
  );
});
