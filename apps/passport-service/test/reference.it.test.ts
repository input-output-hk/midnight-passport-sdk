import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../src/config.ts';
import { loadReferenceBackend } from '../src/reference-backend.ts';

test(
  'the reference backend deploys an ACC on the localnet (PASSPORT_IT=1)',
  { skip: process.env.PASSPORT_IT !== '1', timeout: 30 * 60_000 },
  async () => {
    const backend = await loadReferenceBackend(loadConfig(process.env));
    const keys = backend.sponsorKeys();
    assert.ok(keys.coinPublicKey.length > 0);
    const { address } = await backend.deploy(
      new Uint8Array(32).fill(1),
      new Uint8Array(32).fill(2),
      true,
    );
    assert.match(address, /^[0-9a-f]{64}$/);
  },
);
