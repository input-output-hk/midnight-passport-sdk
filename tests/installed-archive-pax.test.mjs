// Tiny in-memory npm tar fixtures exercise admission without extracting any filesystem path.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { gzipSync } from 'node:zlib';
import { packageArchive } from '../scripts/consumer/installed-inputs.mjs';

/** @param {string} name @param {string|Buffer} body @param {string} [type] */
function entry(name, body, type = '0') {
  const data = Buffer.from(body);
  const header = Buffer.alloc(512);
  header.write(name, 0, 100, 'utf8');
  header.write('0000644\0', 100, 'ascii');
  header.write(data.length.toString(8).padStart(11, '0') + '\0', 124, 'ascii');
  header.fill(32, 148, 156);
  header.write(type, 156, 'ascii');
  header.write('ustar\0', 257, 'ascii');
  const checksum = [...header].reduce((sum, value) => sum + value, 0);
  header.write(checksum.toString(8).padStart(6, '0') + '\0 ', 148, 'ascii');
  return Buffer.concat([header, data, Buffer.alloc((512 - (data.length % 512)) % 512)]);
}
/** @param {string} key @param {string} value */
function pax(key, value) {
  const record = `${key}=${value}\n`;
  let length = Buffer.byteLength(record) + 2;
  for (;;) {
    const next = Buffer.byteLength(record) + String(length).length + 1;
    if (next === length) return `${length} ${record}`;
    length = next;
  }
}
/** @param {Buffer[]} entries */
const archive = (entries) => gzipSync(Buffer.concat([...entries, Buffer.alloc(1024)]));
const manifest = () => entry('package/package.json', '{}');

test('PAX path and size preserve exact bytes, root/directory admission and header reset', () => {
  const files = packageArchive(
    archive([
      entry('package/', '', '5'),
      entry('package/dist/', '', '5'),
      manifest(),
      entry('PaxHeader', pax('path', 'package/dist/renamed.js') + pax('size', '3'), 'x'),
      entry('package/ignored.js', 'one'),
      entry('package/original.js', 'two'),
    ]),
  );
  assert.deepEqual([...files.keys()], ['package.json', 'dist/renamed.js', 'original.js']);
  assert.equal(files.get('dist/renamed.js')?.toString(), 'one');
  assert.equal(files.get('original.js')?.toString(), 'two');
});

for (const record of [
  '0 path=x\n',
  'x path=x\n',
  '99 path=x\n',
  '9 path=x!',
  '7 abcd\n',
  '12 =valuexx\n',
]) {
  test(`malformed PAX record ${JSON.stringify(record)} retains its parse refusal`, () => {
    assert.throws(() => packageArchive(archive([manifest(), entry('PaxHeader', record, 'x')])), {
      message: 'invalid tar extended record',
    });
  });
}

test('duplicate overrides, linkpath and stacked records keep their distinct refusal order', () => {
  assert.throws(
    () =>
      packageArchive(
        archive([
          manifest(),
          entry('PaxHeader', pax('path', 'package/a') + pax('path', 'package/b'), 'x'),
        ]),
      ),
    { message: 'unsafe tar override' },
  );
  assert.throws(
    () =>
      packageArchive(archive([manifest(), entry('PaxHeader', pax('linkpath', 'package/a'), 'x')])),
    { message: 'unsafe tar override' },
  );
  assert.throws(
    () =>
      packageArchive(
        archive([
          manifest(),
          entry('PaxHeader', pax('path', 'package/a'), 'x'),
          entry('PaxHeader2', 'malformed', 'x'),
        ]),
      ),
    { message: 'stacked tar overrides' },
  );
});

test('size override precedes type/path admission, and PAX paths cannot traverse or duplicate files', () => {
  assert.throws(
    () =>
      packageArchive(
        archive([
          manifest(),
          entry('PaxHeader', pax('size', '9') + pax('path', '../outside'), 'x'),
          entry('../bad', 'abc', '2'),
        ]),
      ),
    { message: 'tar size override' },
  );
  for (const path of ['../outside', 'package/../outside', 'package/a\\b', 'package//a'])
    assert.throws(
      () =>
        packageArchive(
          archive([
            manifest(),
            entry('PaxHeader', pax('path', path), 'x'),
            entry('package/a', 'abc'),
          ]),
        ),
      { message: 'unsafe tar package path' },
    );
  assert.throws(
    () =>
      packageArchive(
        archive([
          manifest(),
          entry('PaxHeader', pax('path', 'package/package.json'), 'x'),
          entry('package/a', '{}'),
        ]),
      ),
    { message: 'duplicate tar file' },
  );
});

test('checksum validation precedes a malformed PAX body and dangling overrides stay incomplete', () => {
  const broken = entry('PaxHeader', 'not a PAX record', 'x');
  broken[0] = (broken[0] ?? 0) ^ 1;
  assert.throws(() => packageArchive(archive([manifest(), broken])), {
    message: 'invalid tar checksum',
  });
  assert.throws(
    () =>
      packageArchive(archive([manifest(), entry('PaxHeader', pax('path', 'package/unused'), 'x')])),
    { message: 'incomplete npm tar archive' },
  );
});
