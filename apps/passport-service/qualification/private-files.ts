import assert from 'node:assert/strict';
import { isAbsolute, join } from 'node:path';
import {
  mkdirSync,
  lstatSync,
  existsSync,
  readFileSync,
  openSync,
  writeFileSync,
  fsyncSync,
  closeSync,
  renameSync,
} from 'node:fs';
import { encodeMutationValue, decodeMutationValue } from '../../../packages/account/dist/index.js';

/** Private synthetic fixture state, deliberately separate from public evidence. */
export function privateFiles(root: string) {
  assert.ok(isAbsolute(root));
  mkdirSync(root, { recursive: true, mode: 0o700 });
  assert.ok(!lstatSync(root).isSymbolicLink() && (lstatSync(root).mode & 0o077) === 0);
  const path = (name: string) => {
    assert.match(name, /^[a-z0-9-]+\.json$/);
    return join(root, name);
  };
  return {
    exists: (name: string) => existsSync(path(name)),
    read: (name: string): any => decodeMutationValue(JSON.parse(readFileSync(path(name), 'utf8'))),
    save(name: string, value: unknown) {
      const tmp = path(name) + '.pending';
      const fd = openSync(tmp, 'w', 0o600);
      try {
        writeFileSync(fd, JSON.stringify(encodeMutationValue(value)) + '\n');
        fsyncSync(fd);
      } finally {
        closeSync(fd);
      }
      renameSync(tmp, path(name));
      const dir = openSync(root, 'r');
      try {
        fsyncSync(dir);
      } finally {
        closeSync(dir);
      }
    },
  };
}
export async function boundedWait(test: () => boolean | Promise<boolean>, ms = 180000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await test()) return;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('Qualification handshake or observation deadline expired.');
}
export const publicEvent = (value: object) => console.log('PASSPORT_LIVE ' + JSON.stringify(value));
