import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { remoteDirectory } from '../packages/adapter-service/dist/index.js';
import {
  createFileDirectoryStore,
  createServer,
  directoryRoute,
} from '../packages/service/dist/index.js';

const networkId = 'undeployed';
const hint = {
  address: 'ab'.repeat(32),
  scheme: /** @type {const} */ ('p256-webauthn'),
  credentialId: Uint8Array.of(1),
  publicKey: { x: 2n, y: 3n },
  policy: { rp_id_hash: new Uint8Array(32).fill(4), origin: new Uint8Array(21).fill(5) },
  salt: new Uint8Array(32).fill(6),
  keyEntries: [new Uint8Array(192).fill(7), new Uint8Array(192).fill(8)],
  status: /** @type {const} */ ('deployed'),
};

test('v1 directory stores sealed P-256 and JubJub hints with write-once status transitions', async (t) => {
  const file = join(mkdtempSync(join(tmpdir(), 'passport-dir-')), 'directory.json');
  const store = createFileDirectoryStore(file);
  const server = createServer({ host: '127.0.0.1', corsOrigin: 'http://localhost:5173' }, [
    directoryRoute({ networkId, store }),
  ]);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(undefined)));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}`;
  const directory = remoteDirectory(base);
  const key = { kind: /** @type {const} */ ('credential-id'), credentialId: hint.credentialId };
  assert.equal(await directory.get(networkId, key), undefined);
  await directory.put(networkId, hint);
  assert.deepEqual(await directory.get(networkId, key), hint);
  await directory.put(networkId, hint);
  await directory.put(networkId, { ...hint, status: 'active' });
  assert.deepEqual(await directory.get(networkId, key), { ...hint, status: 'active' });
  await assert.rejects(directory.put(networkId, hint));
  await assert.rejects(
    directory.put(networkId, { ...hint, address: 'cd'.repeat(32), status: 'active' }),
  );
  assert.equal(await directory.get('another', key), undefined);

  const sealed = new Uint8Array(192).fill(7);
  const jubjub = {
    address: 'cd'.repeat(32),
    scheme: /** @type {const} */ ('jubjub-schnorr'),
    credentialId: Uint8Array.of(2),
    publicKey: { x: 8n, y: 9n },
    salt: new Uint8Array(32).fill(10),
    keyEntries: [sealed],
    status: /** @type {const} */ ('deployed'),
  };
  await directory.put(networkId, jubjub);
  assert.deepEqual(
    await directory.get(networkId, { kind: 'credential-id', credentialId: jubjub.credentialId }),
    jubjub,
  );
  const bad = await fetch(`${base}/v1/accounts/${networkId}/02`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      hint: {
        ...jubjub,
        credentialId: '02',
        publicKey: { x: '8', y: '9' },
        salt: '0a'.repeat(32),
        keyEntries: ['ff'],
      },
    }),
  });
  assert.equal(bad.status, 400);
});

test('directory CAS allows only one concurrent first writer and refuses an unverified proof', async (t) => {
  const store = createFileDirectoryStore(
    join(mkdtempSync(join(tmpdir(), 'passport-dir-')), 'directory.json'),
  );
  const key = '01';
  const wire = {
    address: hint.address,
    scheme: hint.scheme,
    credentialId: key,
    publicKey: { x: '2', y: '3' },
    policy: { rp_id_hash: '04'.repeat(32), origin: '05'.repeat(21) },
    salt: '06'.repeat(32),
    status: /** @type {const} */ ('deployed'),
  };
  assert.deepEqual(
    await Promise.all([
      store.compareAndSet(networkId, key, undefined, wire),
      store.compareAndSet(networkId, key, undefined, { ...wire, address: 'cd'.repeat(32) }),
    ]),
    [true, false],
  );
  const server = createServer({ host: '127.0.0.1', corsOrigin: 'http://localhost:5173' }, [
    directoryRoute({ networkId, store }),
  ]);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(undefined)));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const response = await fetch(`http://127.0.0.1:${address.port}/v1/accounts/${networkId}/${key}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      hint: wire,
      proof: {
        scheme: 'p256-webauthn',
        challenge: 'aa',
        authenticatorData: 'bb',
        clientDataJSON: 'cc',
        signature: 'dd',
      },
    }),
  });
  assert.equal(response.status, 501);
});
