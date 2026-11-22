#!/usr/bin/env node
// Assemble a separate complete ACC tree from the pinned compiler output and
// independently restored 0.36.1 keys. Never replace the old binding's files.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createReadStream } from 'node:fs';
import {
  constants,
  copyFileSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, isAbsolute, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { composeAccProfileManifest } from './compose-acc-profile.mjs';

const BINDING_ID = 'acc-s3r1.1-zkir036';
const MANIFEST_SHA256 = '590d3c97db7fce05d5ea85a9bf37c82b7032c498703a2807276ca7ae0ca52e5f';
/** @param {Uint8Array} bytes */
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
/** @param {string} name */
const resource = (name) => new URL(`../resources/${BINDING_ID}.${name}`, import.meta.url);
/** @param {string} name */
const safeName = (name) => /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name) && name !== '..';

/** @param {string} path */
function occupied(path) {
  try {
    lstatSync(path);
    return true;
  } catch (error) {
    if (/** @type {NodeJS.ErrnoException} */ (error).code === 'ENOENT') return false;
    throw error;
  }
}

/** @param {string} path @param {string} label */
function directory(path, label) {
  if (!isAbsolute(path) || !lstatSync(path).isDirectory() || lstatSync(path).isSymbolicLink())
    throw new Error(`${label} must be an absolute real directory`);
  return realpathSync(path);
}

/** @param {Record<string, any>} manifest @param {string} folder */
function files(manifest, folder) {
  const node = manifest[folder];
  if (!node || node.type !== 'directory') throw new Error(`missing ${folder} directory`);
  const entries = Object.entries(node).filter(([name]) => name !== 'type');
  if (!entries.length) throw new Error(`empty ${folder} directory`);
  for (const [name, pin] of entries) {
    if (
      !safeName(name) ||
      pin?.type !== 'file' ||
      !Number.isSafeInteger(pin.size) ||
      pin.size <= 0 ||
      !/^[a-f0-9]{64}$/.test(pin.hash)
    )
      throw new Error(`invalid ${folder}/${name} pin`);
  }
  return entries;
}

/** @param {string} file */
async function digest(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

/**
 * @param {{sourceDir: string, keyDir: string, outputDir: string, requireReflink?: boolean}} paths
 * @returns {Promise<{bindingId: string, manifestSha256: string, files: number}>}
 */
export async function stageAccCandidateAssets({
  sourceDir,
  keyDir,
  outputDir,
  requireReflink = false,
}) {
  const source = directory(sourceDir, 'source'),
    keys = directory(keyDir, 'keys');
  if (source === keys) throw new Error('source and candidate keys must be separate');
  if (!isAbsolute(outputDir)) throw new Error('output must be an absolute path');
  const requested = resolve(outputDir),
    parent = directory(dirname(requested), 'output parent'),
    output = join(parent, basename(requested));
  if (
    occupied(requested) ||
    occupied(output) ||
    [source, keys].some((input) => output === input || output.startsWith(`${input}${sep}`))
  )
    throw new Error('output exists or is inside an input tree');
  const sourceManifestPath = join(source, 'compiler/contract-manifest.json');
  const sourceStat = lstatSync(sourceManifestPath);
  if (!sourceStat.isFile() || sourceStat.isSymbolicLink())
    throw new Error('source compiler manifest must be a regular file');
  const sourceBytes = readFileSync(sourceManifestPath),
    keyManifestBytes = readFileSync(resource('key-manifest.json')),
    expected = composeAccProfileManifest(sourceBytes, keyManifestBytes),
    packaged = readFileSync(resource('artefact-manifest.json'));
  if (!expected.equals(packaged) || sha256(packaged) !== MANIFEST_SHA256)
    throw new Error('candidate manifest differs from the pinned profile');
  const original = JSON.parse(sourceBytes.toString('utf8')),
    candidate = JSON.parse(packaged.toString('utf8'));
  const queue = [];
  for (const folder of ['compiler', 'contract', 'zkir', 'keys']) {
    if (folder !== 'keys') directory(join(source, folder), `${folder} source`);
    const old = new Map(files(original, folder));
    const next = files(candidate, folder);
    if (old.size !== next.length) throw new Error(`${folder} inventory differs`);
    for (const [name, pin] of next) {
      const previous = old.get(name);
      if (!previous) throw new Error(`${folder}/${name} is absent from the source`);
      if (folder !== 'keys' && (previous.size !== pin.size || previous.hash !== pin.hash))
        throw new Error(`${folder}/${name} differs from the compiler output`);
      queue.push({
        input: folder === 'keys' ? join(keys, name) : join(source, folder, name),
        relative: join(folder, name),
        pin,
      });
    }
  }
  const scratch = mkdtempSync(join(parent, `.${basename(output)}-stage-`));
  let published = false;
  try {
    for (const { input, relative, pin } of queue) {
      const stat = lstatSync(input);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== pin.size)
        throw new Error(`${relative} is missing, linked or has the wrong size`);
      const target = join(scratch, relative);
      mkdirSync(dirname(target), { recursive: true });
      if (requireReflink && process.platform === 'darwin') {
        // Node's COPYFILE_FICLONE_FORCE is ENOSYS on the pinned macOS Node;
        // /bin/cp -c uses clonefile and fails if the volume cannot clone.
        execFileSync('/bin/cp', ['-c', '-n', input, target]);
      } else {
        copyFileSync(
          input,
          target,
          constants.COPYFILE_EXCL |
            (requireReflink ? constants.COPYFILE_FICLONE_FORCE : constants.COPYFILE_FICLONE),
        );
      }
      if ((await digest(target)) !== pin.hash)
        throw new Error(`${relative} differs from the candidate manifest`);
    }
    writeFileSync(join(scratch, 'compiler/contract-manifest.json'), packaged, { flag: 'wx' });
    // Claim the path exclusively: rename alone may replace an output created
    // while the large asset tree was being staged.
    mkdirSync(output, { mode: 0o700 });
    const reservation = lstatSync(output);
    try {
      renameSync(scratch, output);
    } catch (error) {
      // Remove only our untouched empty reservation, never a concurrent writer's.
      try {
        const current = lstatSync(output);
        if (
          current.isDirectory() &&
          current.dev === reservation.dev &&
          current.ino === reservation.ino &&
          readdirSync(output).length === 0
        )
          rmdirSync(output);
      } catch {
        // Keep the original publication failure and leave uncertain state alone.
      }
      throw error;
    }
    published = true;
    return { bindingId: BINDING_ID, manifestSha256: MANIFEST_SHA256, files: queue.length };
  } finally {
    if (!published) rmSync(scratch, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (
    ![6, 7].includes(args.length) ||
    args[0] !== '--source' ||
    args[2] !== '--keys' ||
    args[4] !== '--output' ||
    (args.length === 7 && args[6] !== '--require-reflink')
  )
    throw new Error(
      'usage: stage-acc-candidate-assets.mjs --source DIR --keys DIR --output DIR [--require-reflink]',
    );
  console.log(
    JSON.stringify(
      await stageAccCandidateAssets({
        sourceDir: args[1] ?? '',
        keyDir: args[3] ?? '',
        outputDir: args[5] ?? '',
        requireReflink: args[6] === '--require-reflink',
      }),
    ),
  );
}
