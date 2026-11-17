// Emit only a public naming commitment; keep the 32-byte witness in this process.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { loadOrCreateOwnerSecret } from './owner-secret.mjs';

const path = process.argv[2];
assert.ok(path);
const { secret, created } = loadOrCreateOwnerSecret(path, { create: false });
try {
  assert.equal(created, false, 'Existing owner secret required.');
  const tag = Buffer.alloc(32);
  tag.write('midnight.domains');
  console.log(createHash('sha256').update(tag).update(secret).digest('hex'));
} finally {
  secret.fill(0);
}
