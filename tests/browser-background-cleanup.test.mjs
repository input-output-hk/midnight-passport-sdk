import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const fixture = fileURLToPath(
  new URL('./fixtures/browser-background-cleanup-child.mjs', import.meta.url),
);
/** @param {string} action @param {string} mode @param {string} startup */
function verify(action, mode, startup) {
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
}
for (const action of ['direct', 'client-close', 'client-fatal', 'server-stop', 'server-fatal']) {
  for (const mode of [
    'throw',
    'reject',
    'native-catch',
    'native-then',
    'then-getter',
    'then-reject',
    'never',
  ]) {
    test(`browser bridge ${action}: ${mode} cleanup preserves synchronous closure and observes results`, () => {
      verify(action, mode, 'normal');
    });
  }
}
for (const startup of ['registration', 'start']) {
  for (const action of ['direct', 'client-close', 'server-fatal']) {
    for (const mode of ['reject', 'throw', 'never']) {
      test(`browser bridge ${startup} failure: ${action} releases partial listeners with ${mode} cleanup`, () => {
        verify(action, mode, startup);
      });
    }
  }
}
