// Actual generated ACC/software signatures in fresh synthetic workers, not a native proof lane.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { encryptedMutationJournal } from '../packages/keys/dist/index.js';
import { fileMutationByteStore } from '../packages/service/dist/index.js';
import { invokeMutationWorker } from '../scripts/qualification/mutation-matrix.mjs';

const id = '91'.repeat(16);
const pins = {
  networkId: 'undeployed',
  bindingId: 'acc-s3r1.1',
  scheme: /** @type {const} */ ('p256-webauthn'),
  manifestSha256: '77fb9c17b0d59047456c43115d9a58f5cb99a226ee73b6b974fd724930c3153f',
};
/** Same public synthetic source recipe as mutation-worker; never an actual user's fixture. */
const source = {
  withSession: (/** @type {() => Promise<unknown>} */ operation) => operation(),
  deviceSecret: async () => new Uint8Array(32).fill(7),
  deriveSecret: async (
    /** @type {Parameters<import('../packages/account/dist/ports/index.js').PrfKeySource['deriveSecret']>[0]} */ request,
  ) =>
    new Uint8Array(
      createHash('sha256').update(`7|${request.domain}|${request.context}`).digest(),
    ).slice(0, request.length ?? 32),
};

/** @param {string} root */
async function document(root) {
  const journal = encryptedMutationJournal(
    pins,
    {
      ...source,
      withSession: (work) => work(),
    },
    fileMutationByteStore(join(root, 'journal')),
  );
  const record = await journal.read(id);
  assert.ok(record);
  return record;
}

// Pins the pre-extraction program's ordered calls and therefore effect/request-ID positions.
const creationProgram = [
  'credential.create',
  'authoriser.devicePublicKey',
  'authoriser.deviceBinding',
  'consent.flow',
  'authoriser.devicePublicKeyHex',
  'viewing.createKeys',
  'deploy',
  'directory.put',
  'chain.read',
  'consent.flow',
  'authoriser.devicePublicKeyHex',
  'chain.call',
  'chain.read',
  'authoriser.sign',
  'chain.call',
  'chain.read',
  'authoriser.sign',
  'chain.call',
  'chain.read',
  'consent.flow',
  'directory.put',
  'record.write',
];

for (const boundary of [
  'deploy:after',
  'first-owner-send:after',
  'receipt:' + id + ':14:after',
  'receipt:' + id + ':17:after',
]) {
  test(`durable creation resumes ${boundary} with the original transcript prefix and effect IDs`, async () => {
    const root = await mkdtemp(join(tmpdir(), 'passport-readiness-durable-'));
    try {
      const interrupted = invokeMutationWorker(root, 'p256', 'create', 'run', boundary);
      assert.equal(interrupted.status, 86, JSON.stringify(interrupted));
      const before = await document(root);
      const originalPrefix = before.entries.map(({ name, digest, effect }) => ({
        name,
        digest,
        effect,
      }));
      const effects = before.entries.flatMap((entry) => (entry.effect ? [entry.effect] : []));
      assert.ok(effects.length > 0);
      if (before.entries.some((entry) => entry.effect && entry.phase === 'running')) {
        const refused = invokeMutationWorker(root, 'p256', 'create', 'resume', 'none', 'unknown');
        assert.equal(refused.output?.code, 'MutationUnsettled');
        assert.deepEqual(
          (await document(root)).entries.map(({ name, digest, effect }) => ({
            name,
            digest,
            effect,
          })),
          originalPrefix,
        );
      }
      const resumed = invokeMutationWorker(root, 'p256', 'create', 'resume');
      assert.equal(resumed.status, 0, JSON.stringify(resumed));
      const after = await document(root);
      assert.equal(after.phase, 'complete');
      assert.deepEqual(
        after.entries
          .slice(0, before.entries.length)
          .map(({ name, digest, effect }) => ({ name, digest, effect })),
        originalPrefix,
      );
      assert.deepEqual(
        after.entries.map((entry) => entry.name),
        creationProgram,
      );
      assert.deepEqual(
        after.entries.flatMap((entry) => (entry.effect ? [entry.effect.key] : [])),
        [6, 11, 14, 17].map((index) => `${id}:${index}`),
      );
      assert.deepEqual(after.randomSeed, before.randomSeed);
      assert.equal(resumed.output?.created, 1, 'creation material is never regenerated');
      assert.equal(
        resumed.output?.effects,
        4,
        'one deploy, one activation and two original appends',
      );
      const again = invokeMutationWorker(root, 'p256', 'create', 'resume');
      assert.equal(again.status, 0, JSON.stringify(again));
      assert.equal(again.output?.effects, 4);
      assert.deepEqual((await document(root)).entries, after.entries);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
}
