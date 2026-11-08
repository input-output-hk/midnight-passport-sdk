import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { once } from 'node:events';
import { pathToFileURL } from 'node:url';
import { Worker } from 'node:worker_threads';
import { test } from 'node:test';
import ts from 'typescript';
import { typeScriptFences } from '../scripts/docs/snippets.mjs';
import { createBackgroundClient } from '../packages/account/dist/background.js';

const publicRequire = createRequire(
  new URL('../packages/adapter-browser/package.json', import.meta.url),
);

/** Erase TypeScript and resolve only public imports; keep the documented startup body.
 * @param {string} code
 */
function executableWorker(code) {
  const emitted = ts.transpileModule(code, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
    reportDiagnostics: true,
  });
  assert.deepEqual(emitted.diagnostics, []);
  const file = ts.createSourceFile(
    'reader.worker.mjs',
    emitted.outputText,
    ts.ScriptTarget.ES2022,
    true,
  );
  /** @type {{start:number,end:number,value:string}[]} */ const imports = [];
  for (const statement of file.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    const name = statement.moduleSpecifier;
    assert.ok(ts.isStringLiteral(name));
    assert.match(
      name.text,
      /^@input-output-hk\/mn-passport-(?:account|adapter-browser)\/background$/,
    );
    imports.push({
      start: name.getStart(file),
      end: name.getEnd(),
      value: JSON.stringify(pathToFileURL(publicRequire.resolve(name.text)).href),
    });
  }
  let output = emitted.outputText;
  for (const imported of imports.reverse())
    output = output.slice(0, imported.start) + imported.value + output.slice(imported.end);
  return new URL('data:text/javascript;base64,' + Buffer.from(output).toString('base64')).href;
}

/** One owned real Node worker with browser event capabilities, not browser qualification.
 * @param {string} moduleUrl
 */
function documentationWorker(moduleUrl) {
  const harness = `
    import { parentPort } from 'node:worker_threads';
    if (!parentPort) throw new Error('Missing owned worker port');
    const target = new EventTarget();
    globalThis.postMessage = value => parentPort.postMessage(value);
    globalThis.addEventListener = (type, listener) => target.addEventListener(type, listener);
    globalThis.removeEventListener = (type, listener) => target.removeEventListener(type, listener);
    globalThis.close = () => parentPort.close();
    parentPort.on('message', data => target.dispatchEvent(new MessageEvent('message', { data })));
    parentPort.on('messageerror', () => target.dispatchEvent(new Event('messageerror')));
    await import(${JSON.stringify(moduleUrl)});
    parentPort.postMessage({ fixtureReady: true });
  `;
  return new Worker(
    new URL('data:text/javascript;base64,' + Buffer.from(harness).toString('base64')),
  );
}

/** @param {Worker} worker @returns {import('../packages/account/dist/background.js').BackgroundPort} */
function workerPort(worker) {
  return {
    post: (value) => worker.postMessage(value),
    subscribe(receive, fail) {
      worker.on('message', receive);
      worker.on('messageerror', fail);
      worker.on('error', fail);
      worker.on('exit', fail);
      return () => {
        worker.off('message', receive);
        worker.off('messageerror', fail);
        worker.off('error', fail);
        worker.off('exit', fail);
      };
    },
    // The test's finally owns asynchronous termination of this exact worker.
    close: () => {},
  };
}

/** @template T @param {Promise<T>} work @param {number} milliseconds @param {string} label */
async function bounded(work, milliseconds, label) {
  /** @type {ReturnType<typeof setTimeout>|undefined} */ let timer;
  try {
    return await Promise.race([
      work,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(label)), milliseconds);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

test(
  'exact documented worker entry starts and serves validated SDK requests',
  { timeout: 15_000 },
  async () => {
    const guide = readFileSync(new URL('../docs/site/background.md', import.meta.url), 'utf8');
    const workers = typeScriptFences(guide).filter((fence) =>
      fence.code.includes('serveBackgroundTasks'),
    );
    assert.equal(workers.length, 1, 'the guide must identify one complete worker entry');
    const code = workers[0]?.code;
    assert.ok(code);
    const worker = documentationWorker(executableWorker(code));
    /** @type {ReturnType<typeof createBackgroundClient>|undefined} */ let client;
    try {
      const [ready] = await once(worker, 'message', { signal: AbortSignal.timeout(5000) });
      assert.deepEqual(ready, { fixtureReady: true });
      client = createBackgroundClient(workerPort(worker), {
        channel: 'example.reads.v1',
        timeoutMs: 2000,
      });
      assert.equal(await client.request('countAccounts', ['ab'.repeat(32), 'cd'.repeat(32)]), 2);
      await assert.rejects(client.request('countAccounts', ['not-an-account']), {
        code: 'Rejected',
      });
    } finally {
      client?.close();
      await bounded(worker.terminate(), 5000, 'Owned documentation worker did not terminate');
    }
  },
);
