import assert from 'node:assert/strict';
import { getEventListeners, once } from 'node:events';
import { spawn } from 'node:child_process';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import {
  remoteV1Deployer,
  remoteHostMutationPorts,
} from '../packages/adapter-service/dist/index.js';

/** @typedef {import('../packages/account/dist/ports/index.js').FetchLike} FetchLike */
/** @type {import('../packages/account/dist/ports/index.js').MutationPins} */
const pins = {
  networkId: 'undeployed',
  bindingId: 'acc-s3r1.1',
  manifestSha256: '77fb9c17b0d59047456c43115d9a58f5cb99a226ee73b6b974fd724930c3153f',
  scheme: 'jubjub-schnorr',
};
const mutation = { requestId: '34'.repeat(16) + ':0', intentSha256: '56'.repeat(32) };
const confirmed = { address: 'ab'.repeat(32), txIds: ['cd'.repeat(32)] };
const privateCleanup = 'SYNTHETIC_PRIVATE_CLEANUP_DIAGNOSTIC';
/** @param {boolean} [detach] @param {boolean} [registrationThrows] @param {'sync'|'async'|'pending'} [cleanup] */
function signalFixture(detach = true, registrationThrows = false, cleanup = 'sync') {
  const controller = new AbortController(),
    registrationError = Error('Original registration failure');
  let removed = 0;
  /** @type {Set<()=>void>} */ const installed = new Set();
  return {
    controller,
    registrationError,
    signal: {
      get aborted() {
        return controller.signal.aborted;
      },
      addEventListener(/** @type {'abort'} */ type, /** @type {()=>void} */ listener) {
        controller.signal.addEventListener(type, listener);
        installed.add(listener);
        if (registrationThrows) throw registrationError;
      },
      removeEventListener(/** @type {'abort'} */ type, /** @type {()=>void} */ listener) {
        removed++;
        if (detach) {
          controller.signal.removeEventListener(type, listener);
          installed.delete(listener);
        }
        if (cleanup === 'async') return Promise.reject(Error(privateCleanup));
        if (cleanup === 'pending') return new Promise(() => {});
        throw Error(privateCleanup);
      },
    },
    removed: () => removed,
    listeners: () => getEventListeners(controller.signal, 'abort').length,
    drop() {
      for (const listener of installed) controller.signal.removeEventListener('abort', listener);
    },
  };
}
/** @param {unknown} value @param {number} [status] */
const json = (value, status = 200) => ({ ok: status < 400, status, json: async () => value });
/** @param {string} protocol @param {FetchLike} fetch @param {number} timeoutMs */
function deployer(protocol, fetch, timeoutMs) {
  return protocol === 'v1'
    ? remoteV1Deployer('http://injected.invalid', { fetch, timeoutMs, pollIntervalMs: 0 })
    : remoteHostMutationPorts('http://injected.invalid', {
        pins,
        token: '12'.repeat(32),
        fetch,
        timeoutMs,
        pollIntervalMs: 0,
      }).deployer;
}
/** @param {ReturnType<typeof signalFixture>} selected */
const request = (selected) => ({
  boot: new Uint8Array(32),
  encKey: new Uint8Array(32),
  retireAuthority: true,
  mutation,
  signal: selected.signal,
});
/** @param {unknown} error @param {string} code */
function primaryError(error, code) {
  assert.ok(error instanceof Error && 'code' in error);
  assert.equal(error.code, code);
  assert.equal(error.message.includes(privateCleanup), false);
  return true;
}

for (const protocol of ['v1', 'raw']) {
  for (const cleanup of /** @type {const} */ (['sync', 'async', 'pending'])) {
    for (const detaches of [true, false]) {
      test(`${cleanup} ${protocol} confirmed receipt survives throwing cleanup, actual detach=${detaches}`, async () => {
        const selected = signalFixture(detaches, false, cleanup);
        /** @type {string[]} */ const methods = [];
        /** @type {import('../packages/account/dist/ports/index.js').FetchAbortSignal|undefined} */ let wire;
        /** @type {FetchLike} */ const fetch = async (_url, init) => {
          methods.push(init?.method ?? 'GET');
          wire = init?.signal;
          if (protocol === 'v1' && init?.method === 'POST') return json({ jobId: 'original' }, 202);
          return json(
            protocol === 'v1'
              ? { state: 'done', cursor: '0', events: [], result: confirmed }
              : { kind: 'confirmed', digest: mutation.intentSha256, result: confirmed },
          );
        };
        try {
          const result = await deployer(protocol, fetch, 2_147_483_647).deploy(request(selected));
          assert.deepEqual(result, confirmed);
          assert.equal(selected.removed(), 1);
          assert.equal(
            selected.listeners(),
            detaches ? 0 : 1,
            'Observe actual native listener ownership, not only removal calls',
          );
          selected.controller.abort();
          await delay(5);
          assert.deepEqual(result, confirmed);
          assert.equal(wire?.aborted, false, 'A retained caller listener is inert after close');
          assert.equal(methods.filter((method) => method === 'POST').length, 1);
          assert.equal(methods.length, protocol === 'v1' ? 2 : 1);
        } finally {
          selected.drop();
        }
      });
    }
  }
  for (const cleanup of /** @type {const} */ (['sync', 'async'])) {
    for (const outcome of ['timeout', 'abort', 'malformed']) {
      test(`${cleanup} ${protocol} ${outcome} primary error survives throwing cleanup`, async () => {
        const selected = signalFixture(true, false, cleanup);
        let calls = 0;
        /** @type {FetchLike} */ const fetch = async () => {
          calls++;
          if (outcome === 'malformed')
            return json({ invalid: true }, protocol === 'v1' ? 202 : 200);
          return {
            ok: true,
            status: protocol === 'v1' ? 202 : 200,
            json: () => new Promise(() => {}),
          };
        };
        try {
          const task = deployer(protocol, fetch, outcome === 'timeout' ? 20 : 1000).deploy(
            request(selected),
          );
          if (outcome === 'abort') selected.controller.abort();
          await assert.rejects(task, (error) =>
            primaryError(
              error,
              protocol === 'raw'
                ? 'MutationUnsettled'
                : outcome === 'timeout'
                  ? 'SponsorRejected'
                  : outcome === 'abort'
                    ? 'Aborted'
                    : 'InternalError',
            ),
          );
          assert.equal(calls, 1);
          assert.equal(selected.listeners(), 0);
          assert.equal(selected.removed(), 1);
          selected.controller.abort();
          await delay(5);
          assert.equal(calls, 1);
        } finally {
          selected.drop();
        }
      });
    }
    test(`${cleanup} ${protocol} registration and cleanup throws preserve original error before dispatch`, async () => {
      const selected = signalFixture(true, true, cleanup);
      let calls = 0;
      try {
        await assert.rejects(
          deployer(
            protocol,
            async () => {
              calls++;
              return json({});
            },
            2_147_483_647,
          ).deploy(request(selected)),
          (error) => {
            if (protocol === 'raw') return primaryError(error, 'MutationUnsettled');
            assert.equal(error, selected.registrationError);
            return true;
          },
        );
        assert.equal(calls, 0);
        assert.equal(selected.listeners(), 0);
        assert.equal(selected.removed(), 1);
        selected.controller.abort();
        await delay(5);
        assert.equal(calls, 0);
      } finally {
        selected.drop();
      }
    });
  }
}

for (const constructionThrows of [false, true]) {
  test(`lifetime clears its long timer despite cleanup throw; constructionThrows=${constructionThrows}`, async () => {
    const module = new URL(
      '../packages/adapter-service/dist/transport-lifetime.js',
      import.meta.url,
    ).href;
    const source = `import assert from 'node:assert/strict';import {getEventListeners}from'node:events';import{transportLifetime}from ${JSON.stringify(module)};
      const controller=new AbortController();const primary=Error('primary');let removed=0;
      const signal={get aborted(){return controller.signal.aborted},addEventListener(type,listener){controller.signal.addEventListener(type,listener);if(${constructionThrows})throw primary},removeEventListener(type,listener){removed++;controller.signal.removeEventListener(type,listener);throw Error('private cleanup')}};
      if(${constructionThrows})assert.throws(()=>transportLifetime(performance.now()+2147483647,signal),error=>error===primary);
      else{const lifetime=transportLifetime(performance.now()+2147483647,signal);lifetime.close();}
      assert.equal(removed,1);assert.equal(getEventListeners(controller.signal,'abort').length,0);controller.abort();console.log('closed');`;
    const child = spawn(process.execPath, ['--input-type=module', '-e', source], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', (chunk) => {
      output += String(chunk);
    });
    /** @type {ReturnType<typeof setTimeout>|undefined} */ let timer;
    let finished = false;
    const closed = once(child, 'close');
    try {
      const result = await Promise.race([
        closed,
        new Promise((_, reject) => {
          timer = setTimeout(
            () => reject(Error('Owned cleanup probe retained a live timer')),
            3000,
          );
        }),
      ]);
      finished = true;
      assert.deepEqual(result, [0, null]);
      assert.equal(output.trim(), 'closed');
    } finally {
      clearTimeout(timer);
      if (!finished) {
        child.kill('SIGKILL');
        await Promise.race([closed, delay(1000)]);
      }
    }
  });
}
