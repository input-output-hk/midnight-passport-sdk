// Active commands are checked separately from historical release prose.
import assert from 'node:assert/strict';
import { command } from './process.mjs';
import { sha256 } from './files.mjs';

/** @param {string} source */
export function currentContent(source) {
  // Explicitly delimited historical examples are excluded; unmarked recipes are current.
  const historical =
    /<!-- release-acceptance:historical:start -->[\s\S]*?<!-- release-acceptance:historical:end -->/g;
  source = source.replace(historical, '');
  assert.ok(
    !source.includes('<!-- release-acceptance:historical:'),
    'Unbalanced historical command boundary',
  );
  return source;
}
/** @param {string} source @param {string} version @param {import('./images.mjs').ImagePin[]} images */
export function verifyCurrentCommands(source, version, images) {
  source = currentContent(source);
  let packageCommands = 0,
    imageCommands = 0;
  for (const match of source.matchAll(/```[^\n]*\n([\s\S]*?)```/g)) {
    const block = match[1] ?? '';
    for (const install of block.matchAll(/(?:npm\s+install|pnpm\s+add)([\s\S]*?)(?:\n\n|$)/g)) {
      for (const dependency of (install[1] ?? '').matchAll(
        /@input-output-hk\/mn-passport-[a-z-]+(?:@([^\s\\;]+))?/g,
      )) {
        assert.equal(
          dependency[1],
          version,
          'Active install command must pin the current exact release',
        );
        packageCommands++;
      }
    }
    for (const image of block.matchAll(
      /ghcr\.io\/input-output-hk\/midnight-passport-(keys|service|funding)(@sha256:[a-f0-9]+|:[^\s\\]+)?/g,
    )) {
      const pin = images.find((row) => row.role === image[1]);
      assert.ok(pin);
      assert.equal(
        image[2],
        '@' + pin.digest,
        'Active image command must use the release immutable digest',
      );
      imageCommands++;
    }
  }
  return { packageCommands, imageCommands };
}
/** @param {string} checkout @param {string} head @param {string} version @param {import('./images.mjs').ImagePin[]} images */
export function acceptInstructions(checkout, head, version, images) {
  const git = (/** @type {string[]} */ args) =>
    command('git', args, { cwd: checkout }).stdout.trim();
  assert.equal(git(['cat-file', '-t', head]), 'commit');
  const paths = git(['ls-tree', '-r', '--name-only', head])
    .split('\n')
    .filter(
      (path) =>
        path === 'README.md' ||
        /^(?:apps|packages)\/(?:[^/]+\/)?README\.md$/.test(path) ||
        /^docs-site\/(?:getting-started|operations)\/[^/]+\.md$/.test(path),
    );
  const rows = paths.map((path) => {
    const bytes = Buffer.from(
      command('git', ['show', `${head}:${path}`], { cwd: checkout }).stdout,
    );
    return {
      path,
      sha256: sha256(bytes),
      ...verifyCurrentCommands(bytes.toString(), version, images),
    };
  });
  assert.ok(rows.some((row) => row.path === 'README.md'));
  assert.ok(
    rows.reduce((sum, row) => sum + row.imageCommands, 0) >= 3,
    'Current backend image recipes missing',
  );
  assert.ok(
    rows.reduce((sum, row) => sum + row.packageCommands, 0) >= 1,
    'Current package install recipe missing',
  );
  return { documentationHead: head, files: rows };
}
