// Signed published manifests, remote annotated tags and exact dispatch receipts; no writes.
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { assertReleasePackageSet } from '../release-package-list.mjs';
import { assertSigner } from './signatures.mjs';
import { command } from './process.mjs';
import { json, sha256 } from './files.mjs';

/** @typedef {{file:string,sha256:string,pagesFile:string,pagesSha256:string,signer:string}} PublicationPin */
/** @param {string} file @param {string} signer */
function signature(file, signer) {
  const result = command('gpg', ['--batch', '--status-fd=1', '--verify', file + '.asc', file]);
  assertSigner(result.stdout, signer);
}
/** @param {string} root @param {PublicationPin} pin */
function admitAssets(root, pin) {
  assert.equal(sha256(readFileSync(join(root, pin.file))), pin.sha256);
  assert.equal(sha256(readFileSync(join(root, pin.pagesFile))), pin.pagesSha256);
  for (const file of [pin.file, pin.pagesFile, 'SHA256SUMS'])
    signature(join(root, file), pin.signer);
  const seen = new Set();
  for (const line of readFileSync(join(root, 'SHA256SUMS'), 'utf8').trim().split('\n')) {
    const match = /^([a-f0-9]{64})  ([A-Za-z0-9_.-]+)$/.exec(line);
    assert.ok(match && match[1] && match[2]);
    assert.ok(!seen.has(match[2]) && !match[2].endsWith('.tgz'));
    seen.add(match[2]);
    assert.equal(sha256(readFileSync(join(root, match[2]))), match[1]);
  }
  assert.ok(seen.has(pin.file) && seen.has('PACKAGES.json') && seen.has('IMAGES.txt'));
  return json(join(root, pin.file));
}
/** @param {ReturnType<import('./plan.mjs').releasePlan>} plan @param {string} root */
export function acceptPublication(plan, root) {
  const repositories = [plan.sourceAttestation.repository, plan.publisher.repository];
  const downloaded = [];
  for (const [index, repository] of repositories.entries()) {
    const target = join(root, `publication-${index}`);
    mkdirSync(target, { mode: 0o700 });
    const release = JSON.parse(
      command('gh', [
        'release',
        'view',
        `sdk-v${plan.version}`,
        '-R',
        repository,
        '--json',
        'tagName,isDraft,assets,url',
      ]).stdout,
    );
    assert.equal(release.tagName, `sdk-v${plan.version}`);
    assert.equal(release.isDraft, false);
    assert.ok(
      Array.isArray(release.assets) &&
        release.assets.length >= 9 &&
        release.assets.every((/** @type {{name:string}} */ asset) => !asset.name.endsWith('.tgz')),
      'Private tarballs must not be public release assets',
    );
    const required = [
      plan.publication.file,
      plan.publication.file + '.asc',
      plan.publication.pagesFile,
      plan.publication.pagesFile + '.asc',
      'SHA256SUMS',
      'SHA256SUMS.asc',
      'PACKAGES.json',
      'IMAGES.txt',
    ];
    for (const file of required)
      assert.ok(release.assets.some((/** @type {{name:string}} */ asset) => asset.name === file));
    command(
      'gh',
      [
        'release',
        'download',
        `sdk-v${plan.version}`,
        '-R',
        repository,
        '--dir',
        target,
        ...required.flatMap((file) => ['--pattern', file]),
        '--pattern',
        '*-lace-handover.md',
      ],
      { timeout: 120_000 },
    );
    const publication = admitAssets(target, plan.publication),
      pages = json(join(target, plan.publication.pagesFile));
    assert.equal(publication.version, plan.version);
    assert.equal(publication.source?.commit, plan.source);
    assert.equal(publication.privatePublisher?.commit, plan.publisher.source);
    assert.equal(pages.publicationReceiptSha256, plan.publication.sha256);
    assert.equal(pages.sdkSource, plan.source);
    assert.equal(pages.documentationMerge, plan.pages.head);
    assert.equal(String(pages.workflow?.id), plan.pages.runId);
    assert.equal(pages.uploadedArtifactSha256, plan.pages.artifactSha256);
    assertReleasePackageSet(publication.packages);
    assert.equal(publication.images?.length, 3);
    for (const image of plan.images)
      assert.equal(
        publication.images.find((/** @type {{name:string}} */ row) => row.name === image.role)
          ?.registryDigest,
        image.digest,
      );
    downloaded.push({
      repository,
      release: release.url,
      publicationSha256: plan.publication.sha256,
      pagesSha256: plan.publication.pagesSha256,
    });
  }
  const publication = json(join(root, 'publication-0', plan.publication.file));
  const dispatch = plan.tags.map((tag) => verifyRemoteDispatch(plan, tag, publication));
  return { kind: 'signed-remote-release-records', downloaded, dispatch, publication };
}
/** @param {ReturnType<import('./plan.mjs').releasePlan>} plan @param {import('./signatures.mjs').SignedTag} tag @param {Record<string,unknown>} publication */
function verifyRemoteDispatch(plan, tag, publication) {
  const publisher = tag.source === plan.publisher.source;
  const repository = publisher ? plan.publisher.repository : plan.sourceAttestation.repository;
  const localTag = command('git', ['rev-parse', `refs/tags/${tag.tag}`], {
    cwd: tag.checkout,
  }).stdout.trim();
  const remote = JSON.parse(
    command('gh', ['api', `repos/${repository}/git/ref/tags/${tag.tag}`]).stdout,
  );
  assert.equal(remote.object?.type, 'tag');
  assert.equal(
    remote.object?.sha,
    localTag,
    'Remote tag differs from locally verified signed object',
  );
  const workflows = /** @type {Record<string,string>} */ (publication.workflows),
    url = workflows[publisher ? 'privatePublisher' : tag.tag];
  assert.ok(url);
  const match = new RegExp(`^https://github\\.com/${repository}/actions/runs/([0-9]+)$`).exec(url);
  assert.ok(match?.[1]);
  const run = JSON.parse(
    command('gh', ['api', `repos/${repository}/actions/runs/${match[1]}`]).stdout,
  );
  const prefix = tag.tag.split('-v')[0],
    path =
      prefix === 'sdk'
        ? '.github/workflows/publish.yml'
        : `.github/workflows/publish-${prefix === 'keys' ? 'key' : prefix}-image.yml`;
  assert.equal(run.path, path);
  assert.equal(run.head_sha, tag.source);
  assert.equal(run.status, 'completed');
  assert.equal(run.conclusion, 'success');
  assert.ok(run.event === 'push' || run.event === 'workflow_dispatch');
  if (run.event === 'push') assert.equal(run.head_branch, tag.tag);
  return {
    repository,
    tag: tag.tag,
    tagObject: localTag,
    source: tag.source,
    runId: String(run.id),
    path,
    event: run.event,
  };
}
/** @param {Array<{name:string,sha256:string,integrity:string}>} actual @param {unknown} expected */
export function matchPublishedPackages(actual, expected) {
  assertReleasePackageSet(expected);
  assertReleasePackageSet(actual);
  const rows = /** @type {Array<{name:string,sha256:string,integrity:string}>} */ (expected);
  for (const row of actual) {
    const pin = rows.find((item) => item.name === row.name);
    assert.ok(pin);
    assert.equal(row.sha256, pin.sha256, 'Registry bytes differ from signed publication');
    assert.equal(row.integrity, pin.integrity);
  }
}
