import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

const moduleUrl = new URL('../scripts/qualification/lifecycle-stages.mjs', import.meta.url).href;
for (const padding of [0, 2 * 1024 * 1024]) {
  test(
    `injected crash flushes its identifying marker with ${padding} bytes of piped backlog`,
    { timeout: 10000 },
    async (t) => {
      const script = `import { emitCrashAndExit } from ${JSON.stringify(moduleUrl)};
      process.stdout.write('x'.repeat(${padding}));
      await emitCrashAndExit('call:0:after-submit');`;
      const child = spawn(process.execPath, ['--input-type=module', '--eval', script], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      t.after(() => {
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      });
      const done = new Promise((resolve, reject) => {
        child.once('error', reject);
        child.once('close', (code, signal) => resolve({ code, signal }));
      });
      child.stderr.resume();
      /** @type {Buffer[]} */ const chunks = [];
      child.stdout.on('data', (chunk) => chunks.push(chunk));
      child.stdout.pause();
      // A delayed reader forces the large write to exceed pipe capacity. Install
      // the collector first: Node may auto-drain stdio when a short child exits.
      await delay(40);
      child.stdout.resume();
      assert.deepEqual(await done, { code: 86, signal: null });
      assert.equal(
        Buffer.concat(chunks).toString(),
        'x'.repeat(padding) + 'PASSPORT_LIVE {"crash":"call:0:after-submit"}\n',
      );
    },
  );
}
