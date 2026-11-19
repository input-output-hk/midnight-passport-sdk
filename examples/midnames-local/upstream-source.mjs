import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

export async function fetchPinnedMidnamesSource(manifest, request = fetch) {
  assert.match(manifest.midnamesSourceBranch, /^[a-z0-9][a-z0-9-]*$/);
  assert.match(manifest.sourceSha256, /^[a-f0-9]{64}$/);
  const url = `https://raw.githubusercontent.com/midnames/ns-sdk/${manifest.midnamesSourceBranch}/ns.compact`;
  const response = await request(url, {
    redirect: 'error',
    signal: AbortSignal.timeout(30_000),
  });
  assert.ok(response.ok, `Midnames source fetch failed: HTTP ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  assert.ok(bytes.length > 0 && bytes.length <= 1_000_000, 'Unexpected Midnames source size');
  const hash = createHash('sha256').update(bytes).digest('hex');
  assert.equal(
    hash,
    manifest.sourceSha256,
    'Ledger 9 branch source changed; review and update the pin',
  );
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}
