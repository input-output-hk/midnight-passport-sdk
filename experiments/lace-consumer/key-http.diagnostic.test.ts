// Tests the actual host loaders against an existing loopback SDK key service.
import { it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { loadCircuitAssets, loadVerifierKey } from '../../src/acc/artefact-loader';
import { accManifest } from '../../src/acc/manifest';
import { expectedVk } from '../../src/acc/acc-module';
const service = process.env.PASSPORT_KEY_SERVICE_URL;
if (!service) throw new Error('set PASSPORT_KEY_SERVICE_URL');
const base = service + '/v1/zk/acc-s3r1.1';
const requests: Array<{ path: string; sha256: string; size: number }> = [];
const fetchBytes = async (url: string) => {
  const response = await fetch(url, { headers: { Origin: 'http://localhost:5173' } });
  expect(response.status).toBe(200);
  expect(response.headers.get('access-control-allow-origin')).toBe('http://localhost:5173');
  const bytes = new Uint8Array(await response.arrayBuffer());
  requests.push({
    path: new URL(url).pathname,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    size: bytes.length,
  });
  return bytes;
};
it('loads all pinned verifier keys and the owner proving set through a reduced SDK HTTP cache', async () => {
  const profile = await (await fetch(service + '/v1/profile')).json();
  expect(profile.circuits.slice().sort()).toEqual(Object.keys(accManifest.circuits).sort());
  expect(profile.verifierCircuits.slice().sort()).toEqual(Object.keys(expectedVk).sort());
  for (const [circuit, pin] of Object.entries(expectedVk))
    await loadVerifierKey({ artefactUrl: base, circuit, expectedSha256: pin, fetchBytes });
  for (const circuit of Object.keys(accManifest.circuits))
    await loadCircuitAssets({
      artefactUrl: base,
      circuit: circuit as keyof typeof accManifest.circuits,
      fetchBytes,
    });
  expect((await fetch(base + '/keys/withdraw_shielded_with_grant_jubjub.prover')).status).toBe(404);
  const pin = accManifest.circuits.deposit_unshielded.proverKeySha256;
  const head = await fetch(base + '/keys/deposit_unshielded.prover', {
    method: 'HEAD',
    headers: { Origin: 'http://localhost:5173' },
  });
  expect(head.status).toBe(200);
  const range = await fetch(base + '/keys/deposit_unshielded.prover', {
    headers: { Range: 'bytes=0-31', Origin: 'http://localhost:5173' },
  });
  expect(range.status).toBe(206);
  expect((await range.arrayBuffer()).byteLength).toBe(32);
  await expect(
    loadVerifierKey({
      artefactUrl: base,
      circuit: 'deposit_unshielded',
      expectedSha256: '00'.repeat(32),
      fetchBytes,
    }),
  ).rejects.toMatchObject({ code: 'artefact-integrity' });
  if (process.env.KEY_HTTP_RECEIPT_FILE)
    writeFileSync(
      process.env.KEY_HTTP_RECEIPT_FILE,
      JSON.stringify(
        {
          schemaVersion: 1,
          source: process.env.LACE_SOURCE_REVISION,
          profile,
          requests,
          range: true,
          cors: true,
          wrongHashRejected: true,
          fullCompatibility: false,
        },
        null,
        2,
      ) + '\n',
      { flag: 'wx', mode: 0o600 },
    );
}, 120000);
