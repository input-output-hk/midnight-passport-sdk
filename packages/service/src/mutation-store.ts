import { mkdir, readdir, readFile, open, link, unlink, lstat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

interface ByteRecord {
  readonly revision: number;
  readonly bytes: Uint8Array;
}
const MAX_BYTES = 8 * 1024 * 1024 + 28;
/** Immutable revision slots + atomic hard-link publication. A killed writer leaves only an
 * unreferenced temp file; no stale PID lock or partially written committed record to steal.
 * Local POSIX filesystems only. Retain encrypted revisions; compact only under operator policy.
 */
export function fileMutationByteStore(directory: string) {
  const root = resolve(directory);
  const ready = async () => {
    await mkdir(root, { recursive: true, mode: 0o700 });
    const info = await lstat(root);
    if (!info.isDirectory() || info.isSymbolicLink() || info.mode & 0o077)
      throw new Error('Mutation store directory must be private (0700).');
  };
  const check = (id: string) => {
    if (!/^[0-9a-f]{32}$/.test(id)) throw new Error('Invalid mutation store ID.');
  };
  const read = async (id: string): Promise<ByteRecord | undefined> => {
    check(id);
    await ready();
    const pattern = new RegExp(`^${id}\\.r(0|[1-9][0-9]{0,5})\\.json$`);
    const revisions = (await readdir(root)).flatMap((name) => {
      const m = pattern.exec(name);
      return m ? [Number(m[1])] : [];
    });
    if (!revisions.length) return undefined;
    const revision = Math.max(...revisions),
      path = join(root, `${id}.r${revision}.json`);
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink() || info.mode & 0o077)
      throw new Error('Mutation record must be a private regular file.');
    if (info.size > MAX_BYTES * 2) throw new Error('Mutation store record exceeds the bound.');
    const value = JSON.parse(await readFile(path, 'utf8')) as {
      revision: number;
      ciphertext: string;
    };
    if (value.revision !== revision || typeof value.ciphertext !== 'string')
      throw new Error('Corrupt mutation store record.');
    const bytes = new Uint8Array(Buffer.from(value.ciphertext, 'base64'));
    if (Buffer.from(bytes).toString('base64') !== value.ciphertext || bytes.length > MAX_BYTES)
      throw new Error('Corrupt mutation store ciphertext.');
    return { revision, bytes };
  };
  return {
    read,
    async compareAndSwap(
      id: string,
      expectedRevision: number | undefined,
      next: ByteRecord,
    ): Promise<boolean> {
      check(id);
      await ready();
      if (
        next.revision !== (expectedRevision === undefined ? 0 : expectedRevision + 1) ||
        next.revision > 999999 ||
        next.bytes.length > MAX_BYTES
      )
        throw new Error('Invalid mutation store revision or size.');
      if ((await read(id))?.revision !== expectedRevision) return false;
      const temporary = join(root, `.pending-${id}-${randomUUID()}`),
        target = join(root, `${id}.r${next.revision}.json`);
      const handle = await open(temporary, 'wx', 0o600);
      try {
        await handle.writeFile(
          JSON.stringify({
            revision: next.revision,
            ciphertext: Buffer.from(next.bytes).toString('base64'),
          }),
        );
        await handle.sync();
      } finally {
        await handle.close();
      }
      try {
        try {
          await link(temporary, target);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false;
          throw error;
        }
        const dir = await open(root, 'r');
        try {
          await dir.sync();
        } finally {
          await dir.close();
        }
        return true;
      } finally {
        await unlink(temporary);
      }
    },
  };
}
