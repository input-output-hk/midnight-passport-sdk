import { test } from 'node:test';
import assert from 'node:assert/strict';
import { granteePoint } from '@input-output-hk/mn-passport-account';
import { createMockCredentials } from '../src/dev/mock-passkey.ts';
import { prepareGranteePasskey } from '../src/grantee-passkey.ts';

test('separate mock grantee passkey yields a valid public JubJub key only', async () => {
  const memory = new Map<string, string>();
  const origin = 'http://localhost:5173';
  const credentials = createMockCredentials({
    storage: {
      getItem: (key) => memory.get(key) ?? null,
      setItem: (key, value) => void memory.set(key, value),
    },
    origin,
  });
  const publicKey = await prepareGranteePasskey({ rpId: 'localhost', origin, credentials });
  assert.match(publicKey, /^[0-9a-f]{64}$/);
  assert.ok(granteePoint(publicKey));
});
