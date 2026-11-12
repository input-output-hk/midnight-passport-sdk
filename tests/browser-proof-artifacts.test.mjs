import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { gunzipSync } from 'node:zlib';
import { createBrowserProofArtifacts } from '../packages/adapter-browser/dist/worker-proof-artifacts.js';

const circuit = 'append_inbox_with_jubjub';
const location = `contract:${'ab'.repeat(32)}/${circuit}?vk=c7b4858b558b2d53ba36567ae2ff27f9f855593ad8910ebaf60f84b10d9bf601`;
const bytes = Uint8Array.of(1, 2, 3);
const options = {
  bindingId: 'acc-s3r1.1',
  manifestSha256: '77fb9c17b0d59047456c43115d9a58f5cb99a226ee73b6b974fd724930c3153f',
  artefactUrl: 'https://keys.example/v1/zk/acc-s3r1.1',
  circuits: [circuit],
  parameters: [
    {
      k: 16,
      url: 'https://srs.example/bls_midnight_2p16',
      size: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    },
  ],
};

test('rejects unpinned settings before any fetch', () => {
  const fetch = async () => assert.fail('No request expected.');
  for (const invalid of [
    { manifestSha256: '0'.repeat(64) },
    { artefactUrl: 'https://keys.example/v1/zk/another-binding' },
    { artefactUrl: 'https://keys.example/v1/zk/acc-s3r1.1?token=credential' },
    { artefactUrl: 'http://keys.example/v1/zk/acc-s3r1.1' },
    { circuits: ['challenge_append_inbox_with_jubjub'] },
    { parameters: [...options.parameters, ...options.parameters] },
    { maxAccArtifactBytes: Infinity },
  ])
    assert.throws(() => createBrowserProofArtifacts({ ...options, ...invalid, fetch }));
});

test('rejects unexpected key locations and parameter indices before network access', async () => {
  const artifacts = createBrowserProofArtifacts({
    ...options,
    fetch: async () => assert.fail('No request expected.'),
  });
  assert.equal(await artifacts.lookupKey(circuit), undefined);
  assert.equal(
    await artifacts.lookupKey(location.replace(circuit, 'withdraw_unshielded')),
    undefined,
  );
  await assert.rejects(artifacts.lookupKey(location.slice(0, -1) + '0'), {
    code: 'ArtefactIntegrity',
  });
  await assert.rejects(artifacts.getParams(17), { code: 'ArtefactIntegrity' });
});

test('parameter reads share work, ignore mutable input pins and retry a bad digest', async () => {
  const parameters = structuredClone(options.parameters);
  let fetches = 0;
  const artifacts = createBrowserProofArtifacts({
    ...options,
    parameters,
    fetch: async (url, init) => {
      assert.equal(url, options.parameters[0]?.url);
      assert.deepEqual(init, {
        method: 'GET',
        credentials: 'omit',
        redirect: 'error',
        referrerPolicy: 'no-referrer',
      });
      return new Response(++fetches === 1 ? Uint8Array.of(1, 2, 4) : bytes);
    },
  });
  assert.ok(parameters[0]);
  parameters[0].url = 'https://unexpected.example/';
  await assert.rejects(artifacts.getParams(16), { code: 'ArtefactIntegrity' });
  const [a, b] = await Promise.all([artifacts.getParams(16), artifacts.getParams(16)]);
  assert.deepEqual(a, bytes);
  assert.deepEqual(b, bytes);
  assert.equal(fetches, 2);
});

test('cancels oversized bodies and refuses incomplete responses', async () => {
  let cancelled = false;
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(Uint8Array.of(1, 2, 3, 4));
    },
    cancel() {
      cancelled = true;
    },
  });
  const oversized = createBrowserProofArtifacts({
    ...options,
    fetch: async () => new Response(stream),
  });
  await assert.rejects(oversized.getParams(16), /byte limit/);
  assert.equal(cancelled, true);
  for (const response of [
    new Response(bytes, { status: 206 }),
    new Response(bytes, { headers: { 'content-range': 'bytes 0-2/4' } }),
    new Response(bytes.subarray(0, 2)),
  ]) {
    const artifacts = createBrowserProofArtifacts({ ...options, fetch: async () => response });
    await assert.rejects(artifacts.getParams(16), /artifact response|parameter pin mismatch/);
  }
});

test('verifies binary ZKIR and verifier bytes before accepting the prover key', async () => {
  const { files } = JSON.parse(
    gunzipSync(
      await readFile(
        new URL('../packages/contract/resources/acc-s3r1.1.zkir.json.gz', import.meta.url),
      ),
    ).toString(),
  );
  /** @type {string[]} */
  const requested = [];
  const artifacts = createBrowserProofArtifacts({
    ...options,
    fetch: async (url) => {
      const path = String(url).slice(options.artefactUrl.length + 1);
      requested.push(path);
      const data = files[path];
      return new Response(data ? new Uint8Array(Buffer.from(data, 'base64')) : bytes);
    },
  });
  await assert.rejects(artifacts.lookupKey(location), { code: 'ZK_ARTIFACT_INTEGRITY' });
  assert.deepEqual(requested, [
    `keys/${circuit}.verifier`,
    `zkir/${circuit}.bzkir`,
    `keys/${circuit}.prover`,
  ]);
});
