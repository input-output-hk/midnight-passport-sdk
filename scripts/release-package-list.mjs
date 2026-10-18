// Implemented packages shared by packing and reproducibility checks.
export const releasePackageDirectories = Object.freeze([
  'account',
  'adapter-browser',
  'adapter-midnight-js',
  'adapter-service',
  'adapter-webauthn',
  'contract',
  'keys',
  'protocol',
  'service',
]);

/** Reject missing, duplicate or unknown packages even when the total count matches.
 * @param {unknown} files
 */
export function assertReleasePackageSet(files) {
  const expected = new Set(
    releasePackageDirectories.map((name) => `@input-output-hk/mn-passport-${name}`),
  );
  if (!Array.isArray(files) || files.length !== expected.size)
    throw new Error('release: manifest has an incomplete package set');
  const names = files.map((file) => file?.name);
  if (new Set(names).size !== expected.size || names.some((name) => !expected.has(name)))
    throw new Error('release: manifest has a missing, duplicate or unknown package');
}
