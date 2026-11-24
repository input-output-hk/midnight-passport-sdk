import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

test('target control refuses a missing owner without creating a witness file', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'passport-name-owner-'));
  const ownerSecretFile = join(directory, 'missing-owner.private.bin');
  try {
    const worker = fork(
      new URL('../../../examples/midnames-local/claim-owner-worker.mjs', import.meta.url),
      [],
      {
        env: {},
        execArgv: [],
        serialization: 'advanced',
        stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
        signal: AbortSignal.timeout(10_000),
      },
    );
    let failedAt: unknown;
    worker.on('message', (reply: { failedAt?: unknown }) => {
      failedAt = reply?.failedAt;
    });
    const closed = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) =>
      worker.once('close', (code, signal) => resolve({ code, signal })),
    );
    worker.send({
      operation: 'update_target',
      ownerSecretFile,
      ownerSecretMustExist: false,
      nameId: '1',
      newTargetAddress: 'a'.repeat(64),
      newTargetType: 'contract',
    });
    assert.deepEqual(await closed, { code: 1, signal: null });
    assert.equal(failedAt, 'initialize');
    assert.equal(existsSync(ownerSecretFile), false);
  } finally {
    rmSync(directory, { recursive: true });
  }
});
