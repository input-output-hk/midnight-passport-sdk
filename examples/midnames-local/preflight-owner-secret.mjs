// Run in a separate owner process before any sponsor wallet transaction.
import assert from 'node:assert/strict';
import { loadOrCreateOwnerSecret } from './owner-secret.mjs';

assert.equal(process.argv.length, 3);
const { secret } = loadOrCreateOwnerSecret(process.argv[2]);
try {
  assert.equal(secret.length, 32);
} finally {
  secret.fill(0);
}
