import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, open, readdir, rename, unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { maximumLedgerSnapshotBytes } from './ledger-state-root.ts';

export interface CheckpointPosition {
  readonly height: number;
  readonly blockHash: string;
}

const headerBytes = 40;
const pendingName = /^\.pending-[0-9a-f-]{36}$/;

function position(header: Buffer): CheckpointPosition {
  const height = Number(header.readBigUInt64BE());
  if (!Number.isSafeInteger(height)) throw new Error('Invalid checkpoint height.');
  return { height, blockHash: header.subarray(8).toString('hex') };
}

async function readExactly(
  handle: Awaited<ReturnType<typeof open>>,
  length: number,
  offset: number,
): Promise<Buffer> {
  const bytes = Buffer.alloc(length);
  let received = 0;
  while (received < length) {
    const { bytesRead } = await handle.read(bytes, received, length - received, offset + received);
    if (!bytesRead) throw new Error('Truncated ledger checkpoint.');
    received += bytesRead;
  }
  return bytes;
}

async function syncDirectory(directory: string) {
  const handle = await open(
    directory,
    constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
  );
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function requirePrivateDirectory(directory: string) {
  const info = await lstat(directory);
  if (!info.isDirectory() || info.mode & 0o077 || (process.getuid && info.uid !== process.getuid()))
    throw new Error('Ledger checkpoint directory must be private.');
}

/** Disposable, single-writer cache. Every read is reauthenticated by the caller. */
export async function openLedgerCheckpointStore(directory: string, capacity: number) {
  const base = dirname(directory);
  await requirePrivateDirectory(base);
  await mkdir(directory, { mode: 0o700 }).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'EEXIST') throw error;
  });
  await requirePrivateDirectory(directory);
  await syncDirectory(base);

  const slot = (height: number) => height % capacity;
  const filename = (index: number) => join(directory, `checkpoint-${index}.bin`);
  async function read(index: number, expected?: CheckpointPosition) {
    const handle = await open(
      filename(index),
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    ).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error;
      return undefined;
    });
    if (!handle) return undefined;
    try {
      const stats = await handle.stat();
      const { size, mode } = stats;
      if (
        !stats.isFile() ||
        mode & 0o077 ||
        size <= headerBytes ||
        size > headerBytes + maximumLedgerSnapshotBytes
      )
        throw new Error('Invalid ledger checkpoint file.');
      const actual = position(await readExactly(handle, headerBytes, 0));
      if (slot(actual.height) !== index) throw new Error('Invalid checkpoint slot.');
      if (!expected) return { position: actual, snapshot: undefined };
      if (expected.height !== actual.height || expected.blockHash !== actual.blockHash)
        return undefined;
      return {
        position: actual,
        snapshot: await readExactly(handle, size - headerBytes, headerBytes),
      };
    } finally {
      await handle.close();
    }
  }
  return {
    async discardInterruptedWrites() {
      const entries = await readdir(directory);
      for (const name of entries.filter((name) => pendingName.test(name)))
        await unlink(join(directory, name));
    },
    async latest() {
      let latest: CheckpointPosition | undefined;
      for (let index = 0; index < capacity; index++) {
        const record = await read(index);
        if (record && (!latest || record.position.height > latest.height)) latest = record.position;
      }
      return latest;
    },
    async read(expected: CheckpointPosition) {
      return (await read(slot(expected.height), expected))?.snapshot;
    },
    async write(at: CheckpointPosition, snapshot: Uint8Array) {
      if (!snapshot.length || snapshot.length > maximumLedgerSnapshotBytes)
        throw new Error('Invalid ledger checkpoint snapshot size.');
      const header = Buffer.alloc(headerBytes);
      header.writeBigUInt64BE(BigInt(at.height));
      header.set(Buffer.from(at.blockHash, 'hex'), 8);
      const temporary = join(directory, '.pending-' + randomUUID());
      const handle = await open(temporary, 'wx', 0o600);
      try {
        try {
          const { bytesWritten } = await handle.writev([header, snapshot]);
          if (bytesWritten !== header.length + snapshot.length)
            throw new Error('Incomplete ledger checkpoint write.');
          await handle.sync();
        } finally {
          await handle.close();
        }
        await rename(temporary, filename(slot(at.height)));
        await syncDirectory(directory);
      } finally {
        await unlink(temporary).catch((error: NodeJS.ErrnoException) => {
          if (error.code !== 'ENOENT') throw error;
        });
      }
    },
  };
}
