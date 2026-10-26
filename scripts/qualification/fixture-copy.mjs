import { cp, lstat, readdir } from 'node:fs/promises';
import { join } from 'node:path';

/** Refuse aliases before a worker can write through a copied fixture.
 * @param {string} root */
export async function requireRegularFixtureTree(root) {
  const entry = await lstat(root);
  if (entry.isSymbolicLink() || (!entry.isFile() && !entry.isDirectory()))
    throw new Error('Qualification fixture must contain only regular files and directories.');
  if (entry.isDirectory())
    for (const name of await readdir(root)) await requireRegularFixtureTree(join(root, name));
}
/** Destination must be fresh; preserve a partial copy on failure for inspection.
 * @param {string} source @param {string} destination */
export async function copyQualificationFixture(source, destination) {
  await requireRegularFixtureTree(source);
  await cp(source, destination, {
    recursive: true,
    dereference: false,
    errorOnExist: true,
    force: false,
  });
  // Also reject aliases introduced between the preflight and copy, before any worker starts.
  await requireRegularFixtureTree(destination);
}
