// Only public/hash summaries leave the synthetic private fixture. Historical records are
// decrypted solely to count durable dispatch claims, never to export authority/tx bytes.
import assert from 'node:assert/strict';
import { createDecipheriv, createHash } from 'node:crypto';
import { readdir, readFile, lstat } from 'node:fs/promises';
import { join, isAbsolute } from 'node:path';
import { decodeMutationValue } from '../../packages/account/dist/index.js';
import {
  encryptedHostMutationStore,
  encryptedHostJobStore,
  hostHash,
  hostCanonical,
  validateHostRecord,
} from '../../packages/service/dist/index.js';
export const nativeJobHash = (/** @type {string|Uint8Array} */ v) =>
  createHash('sha256').update(v).digest('hex');
/** @param {string} root @param {{history?:boolean}} [options] */
export async function nativeJobSnapshot(root, options = {}) {
  assert.ok(isAbsolute(root));
  const info = await lstat(root);
  assert.ok(info.isDirectory() && !info.isSymbolicLink() && (info.mode & 0o077) === 0);
  /** Protected synthetic fixture; shape is validated before journal use. @type {any} */
  const f = decodeMutationValue(JSON.parse(await readFile(join(root, 'fixture.json'), 'utf8')));
  assert.ok(
    f.hostKey instanceof Uint8Array &&
      f.hostKey.length === 32 &&
      f.jobKey instanceof Uint8Array &&
      f.jobKey.length === 32,
  );
  const host = encryptedHostMutationStore(join(root, 'host-journal'), f.hostKey),
    jobs = encryptedHostJobStore(join(root, 'job-journal'), f.jobKey);
  try {
    /** @type {string[]} */ let files;
    try {
      files = await readdir(join(root, 'job-journal'));
    } catch (e) {
      if (/** @type {NodeJS.ErrnoException} */ (e).code !== 'ENOENT') throw e;
      files = [];
    }
    const ids = [
      ...new Set(
        files.flatMap((name) => {
          const m = /^([0-9a-f]{32})\.r[0-9]+\.json$/.exec(name);
          return m && m[1] !== '0'.repeat(32) ? [/** @type {string} */ (m[1])] : [];
        }),
      ),
    ].sort();
    const summaries = [];
    const seen = new Set();
    let dispatchClaims = 0,
      confirmed = 0;
    for (const id of ids) {
      const j = await jobs.read(id);
      assert.ok(j);
      const identity = j.descriptor.identity,
        r = await host.read(identity);
      /** @type {Record<string,number>} */ const claims = {};
      if (r)
        assert.equal(
          hostHash(r.input),
          hostHash(j.descriptor.input),
          'Host input differs from accepted job.',
        );
      if (r && options.history !== false) {
        const diskId = hostHash({
          networkId: identity.pins.networkId,
          bindingId: identity.pins.bindingId,
          requestId: identity.requestId,
        }).slice(0, 32);
        const names = (await readdir(join(root, 'host-journal')))
          .flatMap((name) => {
            const m = new RegExp('^' + diskId + '\\.r(0|[1-9][0-9]*)\\.json$').exec(name);
            return m ? [{ name, revision: Number(m[1]) }] : [];
          })
          // Audit the immutable prefix at the head we read. A live writer may
          // append later revisions between read() and this directory listing.
          .filter((file) => file.revision <= r.revision)
          .sort((a, b) => a.revision - b.revision);
        /** @type {import('../../packages/service/dist/index.js').HostMutationRecord|undefined} */ let prior;
        for (const [n, file] of names.entries()) {
          assert.equal(file.revision, n, 'Missing historical host revision.');
          const path = join(root, 'host-journal', file.name),
            stat = await lstat(path);
          assert.ok(stat.isFile() && !stat.isSymbolicLink() && (stat.mode & 0o077) === 0);
          const body = JSON.parse(await readFile(path, 'utf8'));
          assert.equal(body.revision, n);
          const encrypted = Buffer.from(body.ciphertext, 'base64');
          const decipher = createDecipheriv('aes-256-gcm', f.hostKey, encrypted.subarray(0, 12));
          decipher.setAAD(
            Buffer.from(
              hostCanonical({ domain: 'mn-passport:host-mutations:v1', identity, revision: n }),
            ),
          );
          decipher.setAuthTag(encrypted.subarray(-16));
          const plain = Buffer.concat([
            decipher.update(encrypted.subarray(12, -16)),
            decipher.final(),
          ]);
          try {
            const record =
              /** @type {import('../../packages/service/dist/index.js').HostMutationRecord} */ (
                JSON.parse(plain.toString('utf8'))
              );
            validateHostRecord(record);
            assert.equal(hostHash(record.identity), hostHash(identity));
            assert.equal(record.revision, n);
            assert.equal(hostHash(record.input), hostHash(r.input));
            if (prior?.plan) assert.equal(hostHash(record.plan), hostHash(prior.plan));
            for (const [index, step] of record.steps.entries()) {
              const old = prior?.steps[index];
              if (old) {
                assert.equal(
                  hostHash({ tx: old.tx, identifiers: old.identifiers }),
                  hostHash({ tx: step.tx, identifiers: step.identifiers }),
                );
              }
              if (step.phase === 'dispatching' && old?.phase !== 'dispatching') {
                assert.equal(old?.phase, 'ready');
                claims[index] = (claims[index] ?? 0) + 1;
              }
            }
            prior = record;
          } finally {
            plain.fill(0);
          }
        }
        assert.equal(names.length, r.revision + 1);
        for (const [index, step] of r.steps.entries()) {
          const count = claims[index] ?? 0;
          assert.ok(count <= 1, 'Duplicate durable dispatch claim.');
          dispatchClaims += count;
          for (const identifier of step.identifiers) {
            assert.ok(!seen.has(identifier), 'Repeated prepared identifier across effects.');
            seen.add(identifier);
          }
          if (step.phase === 'confirmed') {
            assert.equal(count, 1);
            confirmed++;
            assert.ok(step.confirmation?.succeeded);
          }
        }
      }
      if (r && options.history === false) {
        for (const [index, step] of r.steps.entries()) {
          claims[index] = step.phase === 'ready' ? 0 : 1;
          dispatchClaims += claims[index];
          if (step.phase === 'confirmed') confirmed++;
        }
      }
      summaries.push({
        jobId: id,
        identity,
        descriptorSha256: j.descriptorSha256,
        inputSha256: hostHash(j.descriptor.input),
        state: j.state,
        milestones: j.milestones,
        ...(r
          ? {
              host: {
                phase: r.phase,
                revision: r.revision,
                address: r.plan?.address,
                planHash: r.plan ? hostHash(r.plan) : undefined,
                steps: r.steps.map((s, index) => ({
                  phase: s.phase,
                  bytesSha256: nativeJobHash(Buffer.from(s.tx, 'hex')),
                  identifiers: s.identifiers,
                  dispatchClaims: claims[index] ?? 0,
                  ...(s.submissionId ? { submissionId: s.submissionId } : {}),
                  ...(s.confirmation ? { confirmation: s.confirmation } : {}),
                })),
              },
            }
          : {}),
      });
    }
    return {
      jobs: summaries,
      dispatchClaims,
      confirmed,
      attemptsInstrumented: false,
      historyAudited: options.history !== false,
    };
  } finally {
    jobs.close();
    host.close();
    f.hostKey.fill(0);
    f.jobKey.fill(0);
  }
}
/** Preserve every old descriptor, constructor and prepared byte sequence. New owner effects
 * may legitimately be appended after the original one finalises. @param {Awaited<ReturnType<typeof nativeJobSnapshot>>} before @param {Awaited<ReturnType<typeof nativeJobSnapshot>>} after */
export function assertNativeJobContinuation(before, after) {
  assert.ok(before.historyAudited && after.historyAudited);
  assert.ok(after.dispatchClaims >= before.dispatchClaims && after.confirmed >= before.confirmed);
  for (const original of before.jobs) {
    const current = after.jobs.find((j) => j.jobId === original.jobId);
    assert.ok(current);
    assert.equal(current.descriptorSha256, original.descriptorSha256);
    assert.equal(current.inputSha256, original.inputSha256);
    assert.deepEqual(current.identity, original.identity);
    if (original.host) {
      assert.ok(current.host);
      if (original.host.planHash) assert.equal(current.host.planHash, original.host.planHash);
      for (const [n, s] of original.host.steps.entries()) {
        /** @type {{bytesSha256:string,identifiers:readonly string[],dispatchClaims:number,confirmation?: import('../../packages/service/dist/index.js').HostConfirmation}|undefined} */
        const next = current.host.steps[n];
        assert.ok(next);
        assert.equal(next.bytesSha256, s.bytesSha256);
        assert.deepEqual(next.identifiers, s.identifiers);
        assert.ok(next.dispatchClaims >= s.dispatchClaims && next.dispatchClaims <= 1);
        if (s.phase === 'confirmed') assert.deepEqual(next.confirmation, s.confirmation);
      }
    }
  }
}
/** @param {{code:number|null,messages:Array<Record<string,any>>}} r @param {string} operation @param {string} [code] */
export function requireNativeJobFailure(r, operation, code = 'MutationUnsettled') {
  assert.equal(r.code, 2);
  const failures = r.messages.filter((m) => m.failed);
  assert.equal(failures.length, 1);
  assert.equal(failures[0]?.failed, operation);
  assert.equal(failures[0]?.code, code);
  assert.equal(failures[0]?.audit?.unresolvedEffects, 1);
}
