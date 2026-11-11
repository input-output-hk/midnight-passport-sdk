import { randomUUID } from 'node:crypto';
import { closeSync, fsyncSync, linkSync, openSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/** Publish a complete private file without replacing an earlier writer's record. */
export function createOnce(path: string, bytes: string | Uint8Array): void {
  const temporary = path + '.' + randomUUID() + '.pending';
  const file = openSync(temporary, 'wx', 0o600);
  try {
    try {
      writeFileSync(file, bytes);
      fsyncSync(file);
    } finally {
      closeSync(file);
    }
    linkSync(temporary, path);
  } finally {
    unlinkSync(temporary);
  }
  const parent = openSync(dirname(path), 'r');
  try {
    fsyncSync(parent);
  } finally {
    closeSync(parent);
  }
}
