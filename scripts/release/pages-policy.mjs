// Semantic documentation checks supplement exact uploaded-artifact byte equality.
import assert from 'node:assert/strict';
import { currentContent, verifyCurrentCommands } from './instructions.mjs';

/** @param {string} version */
export function canonicalPages(version) {
  const rc = /-rc([0-9]+)$/.exec(version);
  assert.ok(rc?.[1], 'This preview lane requires an RC release route');
  return [
    '',
    'getting-started/',
    'getting-started/installation.html',
    'getting-started/first-integration.html',
    'packages/',
    'packages/api.html',
    'packages/examples.html',
    'demo/',
    'demo/signing-activity.html',
    'guides/authorization.html',
    'guides/assets.html',
    'operations/quality.html',
    `operations/rc${rc[1]}-preview.html`,
    'operations/services.html',
    'architecture/standards.html',
  ];
}
/** @param {unknown} input @param {string} head */
export function admitPagesWorkflow(input, head) {
  const run =
    /** @type {{path?:string,head_sha?:string,status?:string,conclusion?:string,event?:string}} */ (
      input
    );
  assert.ok(
    run &&
      run.path === '.github/workflows/docs-pages.yml' &&
      run.head_sha === head &&
      run.status === 'completed' &&
      run.conclusion === 'success' &&
      ['push', 'workflow_dispatch'].includes(run.event ?? ''),
    'Wrong/unsuccessful Pages workflow',
  );
}
/** @param {string} html */
function plain(html) {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(
      /&(?:amp|lt|gt|quot|#39|#x27);/g,
      (entity) =>
        ({ '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&#x27;': "'" })[
          entity
        ] ?? entity,
    )
    .replace(/\s+/g, ' ')
    .trim();
}
/** @param {string} html @param {string} route @param {string} version @param {import('./images.mjs').ImagePin[]} images */
export function verifyRenderedInstructions(html, route, version, images) {
  html = currentContent(html);
  const pre = [...html.matchAll(/<pre\b[^>]*>([\s\S]*?)<\/pre>/gi)]
    .map((match) => '```sh\n' + plain(match[1] ?? '') + '\n```')
    .join('\n');
  const commands = verifyCurrentCommands(pre, version, images);
  if (route === 'getting-started/first-integration.html')
    assert.ok(
      commands.packageCommands > 0,
      'Rendered first integration lacks exact package command',
    );
  if (
    route === 'getting-started/installation.html' ||
    /operations\/rc[0-9]+-preview\.html$/.test(route)
  ) {
    const main = /<main\b[^>]*>([\s\S]*?)<\/main>/i.exec(html);
    const first = [...(main?.[1] ?? '').matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)]
      .map((match) => plain(match[1] ?? ''))
      .find((paragraph) => paragraph.length > 0);
    assert.ok(first, 'Current introduction missing');
    const selected = /\b[0-9]+\.[0-9]+\.[0-9]+-rc[0-9]+\b/.exec(first);
    assert.equal(selected?.[0], version, 'Active introduction selects an older release');
  }
  if (/operations\/rc[0-9]+-preview\.html$/.test(route)) {
    const rows = [...html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map((match) =>
      plain(match[1] ?? ''),
    );
    for (const pin of images) {
      const selected = rows.filter((row) => row.includes(`midnight-passport-${pin.role}:`));
      assert.equal(selected.length, 1);
      assert.ok(
        selected[0]?.includes(`midnight-passport-${pin.role}:${version}`) &&
          selected[0].includes(pin.digest),
        'Rendered release image table differs from receipt',
      );
    }
  }
  return commands;
}
