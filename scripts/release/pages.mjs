// Anonymous deployed bytes must equal the exact successful workflow's uploaded artifact.
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { safeArchive } from '../consumer/installed-inputs.mjs';
import { admitHttps, publicBytes } from './transport.mjs';
import { command } from './process.mjs';
import { put, sha256 } from './files.mjs';
import { admitPagesWorkflow, canonicalPages, verifyRenderedInstructions } from './pages-policy.mjs';

/** @param {string} route */
export function admitSiteRoute(route) {
  assert.match(route, /^(?:[a-z0-9_.-]+\/)*[a-z0-9_.-]*\/?$/i, 'Expected relative site path');
  assert.ok(
    !route.startsWith('/') && !route.includes('\\') && !route.includes('%') && !/[?#]/.test(route),
  );
  assert.ok(!route.split('/').some((part) => part === '..' || part === '.'));
  return route;
}
/** @typedef {{repository:string,runId:string,head:string,artifactSha256:string,base:string,routes:string[],version:string}} PagesPlan */
/** @param {PagesPlan} plan @param {string} root @param {import('./images.mjs').ImagePin[]} images */
export async function acceptPages(plan, root, images) {
  const base = admitHttps(plan.base, 'input-output-hk.github.io');
  assert.equal(base.pathname, '/midnight-passport-sdk/');
  assert.equal(base.search, '');
  const workflow = JSON.parse(
    command('gh', ['api', `repos/${plan.repository}/actions/runs/${plan.runId}`]).stdout,
  );
  admitPagesWorkflow(workflow, plan.head);
  const run = JSON.parse(
    command('gh', [
      'run',
      'view',
      plan.runId,
      '-R',
      plan.repository,
      '--json',
      'status,conclusion,headSha,jobs,url',
    ]).stdout,
  );
  assert.ok(
    run.status === 'completed' && run.conclusion === 'success' && run.headSha === plan.head,
  );
  assert.ok(
    run.jobs.length === 2 &&
      run.jobs.every((/** @type {{conclusion:string}} */ job) => job.conclusion === 'success'),
  );
  assert.deepEqual(run.jobs.map((/** @type {{name:string}} */ job) => job.name).sort(), [
    'build',
    'deploy',
  ]);
  const download = join(root, 'pages-artifact');
  mkdirSync(download, { mode: 0o700 });
  command(
    'gh',
    [
      'run',
      'download',
      plan.runId,
      '-R',
      plan.repository,
      '--name',
      'github-pages',
      '--dir',
      download,
    ],
    { timeout: 120_000 },
  );
  const files = readdirSync(download);
  assert.equal(files.length, 1);
  const file = files[0];
  assert.ok(file && file.endsWith('.tar'));
  const archive = readFileSync(join(download, file));
  assert.equal(
    sha256(archive),
    plan.artifactSha256,
    'Uploaded Pages archive differs from independent pin',
  );
  const site = safeArchive(gzipSync(archive), 'site');
  assert.ok([...site.values()].every((bytes) => bytes.length <= 16 * 1024 * 1024));
  assert.ok([...site.values()].reduce((sum, bytes) => sum + bytes.length, 0) <= 128 * 1024 * 1024);
  const routes = new Set(plan.routes.map(admitSiteRoute));
  assert.equal(routes.size, plan.routes.length);
  assert.ok(
    routes.size <= 100 && canonicalPages(plan.version).every((route) => routes.has(route)),
    'Canonical library/demo/API/release routes missing',
  );
  assert.ok(
    routes.has('') && routes.has('getting-started/installation.html'),
    'Canonical entry/install checks required',
  );
  const index = site.get('index.html');
  assert.ok(index);
  for (const match of index
    .toString()
    .matchAll(/(?:src|href)=["']\/midnight-passport-sdk\/(assets\/[^"']+)["']/g))
    if (match[1]) routes.add(admitSiteRoute(match[1]));
  assert.ok(routes.size <= plan.routes.length + 20, 'Unexpected root asset inventory');
  const checked = [];
  for (const route of routes) {
    const expected = site.get(!route || route.endsWith('/') ? route + 'index.html' : route);
    assert.ok(expected, 'Page/asset missing from exact uploaded artifact');
    const actual = await publicBytes(new URL(route, base).href, Math.max(1, expected.length));
    assert.ok(actual.equals(expected), 'Served Pages bytes differ from uploaded artifact');
    if (route.endsWith('.html'))
      verifyRenderedInstructions(actual.toString(), route, plan.version, images);
    if (route === 'getting-started/installation.html') {
      assert.ok(actual.includes(plan.version), 'Current installation does not select release');
      assert.ok(!/@RC\d+_|STAGED TEXT/.test(actual.toString()), 'Unresolved release placeholder');
    }
    checked.push({ route, bytes: actual.length, sha256: sha256(actual) });
  }
  const receipt = {
    kind: 'actual-deployed-pages',
    version: plan.version,
    documentationSource: plan.head,
    workflow: plan.runId,
    artifactSha256: plan.artifactSha256,
    pagesAndAssets: checked,
    nativeProof: false,
    realProvider: false,
  };
  put(join(root, 'pages.json'), JSON.stringify(receipt, null, 2) + '\n');
  return receipt;
}
