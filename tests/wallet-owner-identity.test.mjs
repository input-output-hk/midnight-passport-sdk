import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm, chmod, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { encodeMutationValue } from '../packages/account/dist/index.js';
import { readSyntheticOwnerWalletSeed } from '../scripts/qualification/wallet-owner-identity.mjs';
/** @param {import('node:test').TestContext} t */
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'passport-owner-wallet-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}
test('wallet reconnect pins only owner key-source seed without mutating private source or using target material', async (t) => {
  const root = await fixture(t),
    path = join(root, 'fixture.json'),
    seed = new Uint8Array(64).fill(7);
  const data = JSON.stringify(
    encodeMutationValue({
      participants: { owner: { seed }, target: { seed: new Uint8Array(32).fill(9) } },
    }),
  );
  await writeFile(path, data, { mode: 0o600 });
  const pinned = readSyntheticOwnerWalletSeed(path);
  assert.deepEqual(pinned, seed);
  pinned.fill(0);
  assert.deepEqual(readSyntheticOwnerWalletSeed(path), seed);
  assert.equal(await readFile(path, 'utf8'), data);
});
test('owner wallet selection fails closed for missing/zero seed, non-private files or symbolic aliases', async (t) => {
  const root = await fixture(t),
    path = join(root, 'fixture.json');
  for (const seed of [undefined, new Uint8Array(32), new Uint8Array(3).fill(1)]) {
    await writeFile(
      path,
      JSON.stringify(
        encodeMutationValue({ participants: { owner: seed === undefined ? {} : { seed } } }),
      ),
      { mode: 0o600 },
    );
    assert.throws(() => readSyntheticOwnerWalletSeed(path));
  }
  await writeFile(
    path,
    JSON.stringify(
      encodeMutationValue({ participants: { owner: { seed: new Uint8Array(32).fill(1) } } }),
    ),
    { mode: 0o600 },
  );
  await chmod(path, 0o644);
  assert.throws(() => readSyntheticOwnerWalletSeed(path));
  await chmod(path, 0o600);
  await chmod(root, 0o755);
  assert.throws(() => readSyntheticOwnerWalletSeed(path));
  await chmod(root, 0o700);
  const second = await fixture(t);
  await symlink(path, join(second, 'fixture.json'));
  assert.throws(() => readSyntheticOwnerWalletSeed(join(second, 'fixture.json')));
  assert.throws(() => readSyntheticOwnerWalletSeed('fixture.json'));
});
