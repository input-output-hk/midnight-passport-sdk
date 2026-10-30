// Copy only immutable encrypted revisions out of an owned Linux state volume.
// The production service never reads this observer mirror and it cannot drive work.
import assert from 'node:assert/strict';
import { mkdir, readFile, lstat, rename, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { nativeJobHash } from './native-job-evidence.mjs';

const JOURNALS = ['host-journal', 'job-journal'];
const REVISION = /^[a-f0-9]{32}\.r(0|[1-9][0-9]{0,5})\.json$/;
const LIMIT = 16 * 1024 * 1024 + 128;
/** @param {string} label @param {string} arm @param {'creation'|'lifecycle'} [profile] */
export function imageStateNames(label, arm, profile = 'creation') {
  assert.ok(['creation', 'lifecycle'].includes(profile));
  assert.match(label, /^image-v[1-9][0-9]{0,2}$/);
  assert.ok(['jubjub', 'p256'].includes(arm));
  const prefix =
    profile === 'lifecycle' ? 'mn-passport-joblife-20261028' : 'mn-passport-hostjobs-20261027';
  const container = `${prefix}-${label}-${arm}`;
  return { container, volume: container + '-state' };
}

/** Executed read-only by Node in the production container; no keys or plaintext read.
 * It hashes all published encrypted files, including previously mirrored history.
 */
export const IMAGE_JOURNAL_MANIFEST = `
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const result={};
for(const journal of ${JSON.stringify(JOURNALS)}) {
 const root=path.join('/data/state',journal);
 if(!fs.existsSync(root)){result[journal]=[];continue;}
 const dir=fs.lstatSync(root);if(!dir.isDirectory()||dir.isSymbolicLink()||(dir.mode&63))throw Error('Unsafe journal directory');
 result[journal]=fs.readdirSync(root).filter(name=>${REVISION}.test(name)).sort().map(name=>{
  const p=path.join(root,name),s=fs.lstatSync(p);
  if(!s.isFile()||s.isSymbolicLink()||(s.mode&63)||s.size>${LIMIT})throw Error('Unsafe published revision');
  return {name,size:s.size,sha256:crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex')};
 });
}
console.log(JSON.stringify(result));`;

/** @typedef {{name:string,size:number,sha256:string}} Entry */
/** Never overwrite an observed revision. Deletion, replacement and byte drift fail closed.
 * A concurrently appended revision is harmless; the next observation collects it.
 * @param {string} root
 * @param {Record<string,Entry[]>} manifest
 * @param {(journal:string,name:string,destination:string)=>Promise<void>} copy
 */
export async function mirrorImageJournals(root, manifest, copy) {
  assert.deepEqual(Object.keys(manifest).sort(), [...JOURNALS].sort());
  for (const journal of JOURNALS) {
    const entries = manifest[journal];
    assert.ok(Array.isArray(entries) && entries.length <= 10000);
    const names = new Set();
    const directory = join(root, journal);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const directoryInfo = await lstat(directory);
    assert.ok(
      directoryInfo.isDirectory() &&
        !directoryInfo.isSymbolicLink() &&
        !(directoryInfo.mode & 0o077),
    );
    for (const entry of entries) {
      assert.deepEqual(Object.keys(entry).sort(), ['name', 'sha256', 'size']);
      assert.match(entry.name, REVISION);
      assert.ok(!names.has(entry.name));
      names.add(entry.name);
      assert.ok(Number.isSafeInteger(entry.size) && entry.size >= 0 && entry.size <= LIMIT);
      assert.match(entry.sha256, /^[a-f0-9]{64}$/);
      const target = join(directory, entry.name);
      let exists = true;
      try {
        await lstat(target);
      } catch (error) {
        if (/** @type {NodeJS.ErrnoException} */ (error).code !== 'ENOENT') throw error;
        exists = false;
      }
      const temporary = target + '.snapshot-pending';
      const path = exists ? target : temporary;
      if (!exists) {
        await assert.rejects(lstat(temporary), { code: 'ENOENT' });
        await copy(journal, entry.name, temporary);
      }
      const info = await lstat(path);
      assert.ok(info.isFile() && !info.isSymbolicLink() && !(info.mode & 0o077));
      assert.equal(info.size, entry.size);
      assert.equal(nativeJobHash(await readFile(path)), entry.sha256);
      if (!exists) await rename(temporary, target);
    }
    for (const name of await readdir(directory))
      if (REVISION.test(name)) assert.ok(names.has(name), 'Published Linux revision disappeared.');
  }
}

/** @param {{exitCode:number|null,signalCode:string|null}} child */
export const nativeWorkerStopped = (child) => child.exitCode !== null || child.signalCode !== null;
