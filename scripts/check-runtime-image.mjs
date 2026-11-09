// Pipe into the image's Node entrypoint; inspecting a Dockerfile is not image acceptance.
import { lstatSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/** Check known development/private paths in the actual runtime filesystem.
 * This is an artifact-content policy, not a general secret scanner.
 * @param {string} root
 */
export function checkRuntimeImage(root) {
  for (const name of [
    'review',
    'tests',
    'docs',
    '.git',
    '.github',
    '.mn-passport-skills',
    'coverage',
    '.nyc_output',
  ]) {
    if (lstatSync(join(root, name), { throwIfNoEntry: false }))
      throw Error(`Development/private path in runtime image: ${name}`);
  }
  for (const workspace of ['apps', 'packages']) {
    for (const entry of readdirSync(join(root, workspace), { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name === 'node_modules') continue;
      for (const name of ['test', 'tests', 'qualification']) {
        const path = join(workspace, entry.name, name);
        if (lstatSync(join(root, path), { throwIfNoEntry: false }))
          throw Error(`Development/private path in runtime image: ${path}`);
      }
    }
  }
  return { status: 'passed', root, policy: 'known-development-paths' };
}

// The stdin route is used by both image smoke scripts; the file route supports fixtures.
if (
  process.argv[1] === '-' ||
  (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
) {
  if (!process.argv[2]) throw Error('Supply the runtime filesystem root');
  console.log(JSON.stringify(checkRuntimeImage(process.argv[2])));
}
