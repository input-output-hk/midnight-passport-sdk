import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
const fixture = fileURLToPath(new URL('./fixtures/background-cleanup-child.mjs', import.meta.url));
for (const action of ['client-close', 'client-fatal', 'server-close', 'server-fatal']) {
  for (const mode of [
    'throw',
    'reject',
    'native-catch',
    'native-then',
    'then-getter',
    'then-reject',
    'never',
  ]) {
    for (const startup of ['normal', 'immediate']) {
      test(`background ${action}: ${mode} cleanup with ${startup} failure is observed and idempotent`, () => {
        const child = spawnSync(process.execPath, [fixture, action, mode, startup], {
          encoding: 'utf8',
          timeout: 5000,
          maxBuffer: 16384,
          env: { PATH: process.env.PATH, LANG: 'C' },
        });
        assert.equal(child.error, undefined);
        assert.equal(child.signal, null);
        assert.equal(child.status, 0, child.stderr);
        const result = JSON.parse(child.stdout);
        assert.deepEqual(result.unhandled, []);
        assert.equal(result.detachCount, 1);
      });
    }
  }
}
