// Actual authorized GitHub npm archives, exact-byte provenance and source comparison.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { checkConsumerTarballs } from '../consumer-inputs.mjs';
import { packageArchive } from '../consumer/installed-inputs.mjs';
import { registryBytes } from './transport.mjs';
import { json, put, sha256 } from './files.mjs';
import { command } from './process.mjs';

/** @typedef {{repository:string,source:string,workflow:string}} AttestationPin */
/** @param {Buffer} bytes @param {{integrity:string,shasum:string}} dist @param {Buffer} source */
export function verifyArchive(bytes, dist, source) {
  assert.equal(
    dist.integrity,
    'sha512-' + createHash('sha512').update(bytes).digest('base64'),
    'Registry SRI differs',
  );
  assert.equal(
    dist.shasum,
    createHash('sha1').update(bytes).digest('hex'),
    'Registry SHA1 differs',
  );
  const unpack = (/** @type {Buffer} */ data) =>
    gunzipSync(data, { maxOutputLength: 256 * 1024 * 1024 });
  assert.ok(unpack(bytes).equals(unpack(source)), 'Registry/source uncompressed archive differs');
  return {
    sha256: sha256(bytes),
    sourceSha256: sha256(source),
    exactSourceArchive: bytes.equals(source),
    decompressedArchiveMatches: true,
    compressedArchiveDifference: !bytes.equals(source),
    gzipOsByteDifference: bytes[9] !== source[9],
  };
}
/** gh performs Sigstore verification with pinned signer workflow + source digest.
 * @param {string} file @param {string} hash @param {AttestationPin} pin @param {string} root @param {string} name */
export function verifyAttestation(file, hash, pin, root, name) {
  const verified = command(
    'gh',
    [
      'attestation',
      'verify',
      file,
      '--repo',
      pin.repository,
      '--signer-workflow',
      `${pin.repository}/.github/workflows/${pin.workflow}`,
      '--source-digest',
      pin.source,
      '--format',
      'json',
    ],
    { timeout: 90_000 },
  );
  put(join(root, name), verified.stdout);
  const results = JSON.parse(verified.stdout);
  assertAttestedSubject(results, hash);
  return {
    repository: pin.repository,
    source: pin.source,
    workflow: pin.workflow,
    subjectSha256: hash,
    receiptSha256: sha256(verified.stdout),
  };
}
/** @param {unknown} results @param {string} hash */
export function assertAttestedSubject(results, hash) {
  assert.ok(
    Array.isArray(results) &&
      results.some(
        (row) =>
          Array.isArray(row.verificationResult?.statement?.subject) &&
          row.verificationResult.statement.subject.some(
            (/** @type {{digest?:{sha256?:string}}} */ subject) => subject.digest?.sha256 === hash,
          ),
      ),
    'Verified statement lacks exact archive subject',
  );
}
/** @typedef {{version:string,source:string,sourceBundle:string,sourceManifestSha256:string,publisher:AttestationPin,sourceAttestation:AttestationPin}} RegistryPlan */
/** @param {RegistryPlan} plan @param {string} root @param {string} token */
export async function acceptRegistry(plan, root, token) {
  const manifestBytes = readFileSync(join(plan.sourceBundle, 'manifest.json'));
  assert.equal(
    sha256(manifestBytes),
    plan.sourceManifestSha256,
    'Independent source manifest pin differs',
  );
  const source = checkConsumerTarballs(plan.sourceBundle, plan.version);
  const manifest = json(join(plan.sourceBundle, 'manifest.json'));
  const bundle = join(root, 'bundle');
  mkdirSync(bundle, { mode: 0o700 });
  const records = [];
  for (const row of source.files) {
    const metadata = JSON.parse(
      (
        await registryBytes(`https://npm.pkg.github.com/${encodeURIComponent(row.name)}`, token)
      ).toString(),
    );
    assert.equal(metadata['dist-tags']?.next, plan.version, 'Dist-tag differs');
    const version = metadata.versions?.[plan.version];
    assert.equal(version?.name, row.name);
    assert.equal(version?.version, plan.version);
    const bytes = await registryBytes(version.dist.tarball, token, {
      artifact: true,
      limit: 32 * 1024 * 1024,
    });
    const hashes = verifyArchive(
      bytes,
      version.dist,
      readFileSync(join(plan.sourceBundle, row.file)),
    );
    const files = packageArchive(bytes),
      pkg = JSON.parse(files.get('package.json')?.toString() ?? 'null');
    assert.equal(pkg?.name, row.name);
    assert.equal(pkg?.version, plan.version);
    assert.ok(
      [...files.keys()].every(
        (file) => !/(?:\.prover$|(?:^|\/)(?:review|tests?)(?:\/|$))/.test(file),
      ),
      'Private/test payload in package',
    );
    const short = row.name.split('/')[1];
    const access = JSON.parse(
      command('gh', ['api', `orgs/input-output-hk/packages/npm/${short}`]).stdout,
    );
    assert.equal(access.visibility, 'private');
    assert.equal(access.repository?.full_name, plan.publisher.repository);
    put(join(bundle, row.file), bytes);
    const attestations = [plan.sourceAttestation, plan.publisher].map((pin, index) =>
      verifyAttestation(
        join(bundle, row.file),
        hashes.sha256,
        pin,
        root,
        `${short}-attestation-${index}.json`,
      ),
    );
    manifest.files.find((/** @type {{name:string}} */ entry) => entry.name === row.name).sha256 =
      hashes.sha256;
    records.push({
      name: row.name,
      version: plan.version,
      file: row.file,
      ...hashes,
      integrity: version.dist.integrity,
      visibility: 'private',
      distTag: 'next',
      attestations,
    });
  }
  put(join(bundle, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  // The original source bundle is read again: archived source comparison is not an input-drift waiver.
  assert.deepEqual(checkConsumerTarballs(plan.sourceBundle, plan.version), source);
  const receipt = {
    kind: 'actual-private-registry-archives',
    version: plan.version,
    source: plan.source,
    packages: records,
    privateTarballsPubliclyMirrored: false,
  };
  put(join(root, 'registry.json'), JSON.stringify(receipt, null, 2) + '\n');
  return receipt;
}
