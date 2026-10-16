import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from '@input-output-hk/mn-passport-service';
import type { FundingConfig } from '../src/config.ts';
import { decodeValueArg, valueCallRoute } from '../src/value-call.ts';

test('value call decoder restores nested bytes and integers without accepting raw numbers', () => {
  assert.deepEqual(
    decodeValueArg({ auth: { pk: { x: { $bigint: '23' } }, data: { $bytes: '00ff' } } }),
    { auth: { pk: { x: 23n }, data: Uint8Array.of(0, 255) } },
  );
  for (const value of [
    1,
    -1,
    { $bigint: '-1' },
    { $bigint: '01' },
    { $bytes: 'f' },
    { $bytes: 'gg' },
    { $bytes: 'aa', extra: true },
    { __proto__: null, constructor: 1 },
  ]) {
    assert.throws(() => decodeValueArg(value));
  }
});

test('value endpoint refuses other circuits and deposits above the demo policy before touching the wallet', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'mn-passport-value-'));
  const address = 'a'.repeat(64);
  const deploymentsFile = join(directory, 'deployments.json');
  writeFileSync(deploymentsFile, JSON.stringify({ undeployed: [address] }));
  const config = {
    networkId: 'undeployed',
    host: '127.0.0.1',
    corsOrigin: 'http://localhost:5173',
    deploymentsFile,
    assets: [{ color: '0'.repeat(64), maxPerRequest: 10n, maxPerUtcDay: 100n }],
  } as unknown as FundingConfig;
  const server = createServer(config, [valueCallRoute(config, null as never, () => true)]);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const port = (server.address() as { port: number }).port;
    const post = (circuit: string, amount: string) =>
      fetch(`http://127.0.0.1:${port}/v1/value-call`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          accountAddress: address,
          circuit,
          args: [
            { $bytes: '0'.repeat(64) },
            { $bigint: amount },
            { bytes: { $bytes: 'b'.repeat(64) } },
            {},
          ],
        }),
      });
    assert.equal((await post('deposit_unshielded', '1')).status, 400);
    assert.equal((await post('withdraw_unshielded_with_p256', '11')).status, 400);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(directory, { recursive: true, force: true });
  }
});
