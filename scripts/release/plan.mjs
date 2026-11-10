// Closed operator plans contain pins and paths, never tokens or arbitrary command hooks.
import assert from 'node:assert/strict';
import { isAbsolute, normalize } from 'node:path';
import { exact, object, text } from './files.mjs';

const hash = (/** @type {unknown} */ value) => text(value, /^[a-f0-9]{64}$/);
const source = (/** @type {unknown} */ value) => text(value, /^[a-f0-9]{40}$/);
const version = (/** @type {unknown} */ value) =>
  text(value, /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/);
/** @param {unknown} value */
export function absolutePath(value) {
  const path = text(value, /^.+$/);
  assert.ok(isAbsolute(path) && normalize(path) === path && path !== '/' && !/[\r\n,]/.test(path));
  return path;
}
/** @param {unknown} value */
function attestation(value) {
  const row = object(value);
  exact(row, ['repository', 'source', 'workflow']);
  return {
    repository: text(row.repository, /^input-output-hk\/midnight-passport-sdk(?:-publisher)?$/),
    source: source(row.source),
    workflow: text(row.workflow, /^publish\.yml$/),
  };
}
/** @param {unknown} input */
export function releasePlan(input) {
  const row = object(input);
  exact(row, [
    'schemaVersion',
    'version',
    'source',
    'sourceBundle',
    'sourceManifestSha256',
    'publisher',
    'sourceAttestation',
    'images',
    'pages',
    'documentationCheckout',
    'tags',
    'compilerManifest',
    'compilerManifestSha256',
    'publicKeys',
    'publication',
  ]);
  assert.equal(row.schemaVersion, 1);
  const sdk = {
    version: version(row.version),
    source: source(row.source),
    sourceBundle: absolutePath(row.sourceBundle),
    sourceManifestSha256: hash(row.sourceManifestSha256),
    publisher: attestation(row.publisher),
    sourceAttestation: attestation(row.sourceAttestation),
  };
  assert.equal(sdk.sourceAttestation.repository, 'input-output-hk/midnight-passport-sdk');
  assert.equal(sdk.sourceAttestation.source, sdk.source);
  assert.equal(sdk.publisher.repository, 'input-output-hk/midnight-passport-sdk-publisher');
  assert.ok(Array.isArray(row.images) && row.images.length === 3);
  const images = row.images.map((input) => {
    const image = object(input);
    exact(image, ['role', 'repository', 'digest', 'version', 'sourceAlias']);
    const role = text(image.role, /^(?:keys|service|funding)$/);
    assert.equal(image.repository, `ghcr.io/input-output-hk/midnight-passport-${role}`);
    assert.equal(image.version, sdk.version);
    assert.equal(image.sourceAlias, `sha-${sdk.source.slice(0, 12)}`);
    return {
      role: /** @type {'keys'|'service'|'funding'} */ (role),
      repository: String(image.repository),
      digest: text(image.digest, /^sha256:[a-f0-9]{64}$/),
      version: sdk.version,
      sourceAlias: String(image.sourceAlias),
    };
  });
  assert.deepEqual(images.map((image) => image.role).sort(), ['funding', 'keys', 'service']);
  const pages = object(row.pages);
  exact(pages, ['repository', 'runId', 'head', 'artifactSha256', 'base', 'routes', 'version']);
  assert.equal(pages.repository, 'input-output-hk/midnight-passport-sdk');
  assert.equal(pages.version, sdk.version);
  assert.ok(
    Array.isArray(pages.routes) &&
      pages.routes.length >= 15 &&
      pages.routes.every((route) => typeof route === 'string'),
  );
  const pagesPlan = {
    repository: String(pages.repository),
    runId: text(pages.runId, /^[1-9][0-9]+$/),
    head: source(pages.head),
    artifactSha256: hash(pages.artifactSha256),
    base: text(pages.base, /^https:\/\/input-output-hk\.github\.io\/midnight-passport-sdk\/$/),
    routes: /** @type {string[]} */ (pages.routes),
    version: sdk.version,
  };
  assert.ok(Array.isArray(row.tags) && row.tags.length === 5);
  const tags = row.tags.map((input) => {
    const tag = object(input);
    exact(tag, ['checkout', 'tag', 'source', 'signer']);
    return {
      checkout: absolutePath(tag.checkout),
      tag: text(tag.tag, /^(?:sdk|keys|service|funding)-v[0-9A-Za-z.-]+$/),
      source: source(tag.source),
      signer: text(tag.signer, /^[A-F0-9]{40}$/),
    };
  });
  assert.deepEqual(
    tags.map((tag) => tag.tag).sort(),
    [
      `sdk-v${sdk.version}`,
      `sdk-v${sdk.version}`,
      `keys-v${sdk.version}`,
      `service-v${sdk.version}`,
      `funding-v${sdk.version}`,
    ].sort(),
  );
  for (const tag of tags)
    assert.ok(
      tag.source === sdk.source ||
        (tag.tag.startsWith('sdk-') && tag.source === sdk.publisher.source),
    );
  assert.equal(tags.filter((tag) => tag.source === sdk.publisher.source).length, 1);
  const publication = object(row.publication);
  exact(publication, ['file', 'sha256', 'pagesFile', 'pagesSha256', 'signer']);
  const publicationPin = {
    file: text(publication.file, /^[a-z0-9-]+-publication-receipt\.json$/),
    sha256: hash(publication.sha256),
    pagesFile: text(publication.pagesFile, /^pages-verification\.json$/),
    pagesSha256: hash(publication.pagesSha256),
    signer: text(publication.signer, /^[A-F0-9]{40}$/),
  };
  return {
    ...sdk,
    images,
    pages: pagesPlan,
    documentationCheckout: absolutePath(row.documentationCheckout),
    tags,
    compilerManifest: absolutePath(row.compilerManifest),
    compilerManifestSha256: hash(row.compilerManifestSha256),
    publicKeys: absolutePath(row.publicKeys),
    publication: publicationPin,
  };
}
