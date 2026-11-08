import assert from 'node:assert/strict';
import { test } from 'node:test';
import { durableCredentials } from '../packages/account/dist/durable-credentials.js';

test('durable credential wrapper forwards prototype login scope on its original receiver', async () => {
  const credentialId = Uint8Array.of(1, 2);
  class Credentials {
    active = false;
    scopes = 0;
    /** @template T @param {()=>Promise<T>} work */
    async withLoginSession(work) {
      assert.equal(this, source);
      assert.equal(this.active, false);
      this.active = true;
      this.scopes++;
      try {
        return await work();
      } finally {
        this.active = false;
      }
    }
    async create() {
      return { credentialId };
    }
    async identify() {
      assert.equal(this, source);
      assert.equal(this.active, true, 'identity remains inside the original login scope');
      return { credentialId, owns: () => true };
    }
  }
  const source = new Credentials();
  /** @type {Array<{name:string,verify:boolean}>} */ const traces = [];
  const wrapped = durableCredentials(source, async (name, _input, work, verify = false) => {
    traces.push({ name, verify });
    return work();
  });
  assert.ok(wrapped.withLoginSession);
  const login = wrapped.withLoginSession.bind(wrapped);
  await login(async () => {
    const identity = await wrapped.identify();
    assert.equal(identity.owns({ x: 1n, y: 2n }), true);
  });
  assert.equal(source.scopes, 1);
  assert.equal(source.active, false);
  assert.deepEqual(traces, [{ name: 'credential.identify', verify: true }]);
  await assert.rejects(
    login(async () => {
      throw Error('failed open');
    }),
    /failed open/,
  );
  assert.equal(source.active, false);
});

test('durable wrapper does not invent an optional login capability for legacy credentials', () => {
  const source = {
    create: async () => ({ credentialId: Uint8Array.of(1) }),
    identify: async () => ({ credentialId: Uint8Array.of(1), owns: () => true }),
  };
  const wrapped = durableCredentials(source, async (_name, _input, work) => work());
  assert.equal(wrapped.withLoginSession, undefined);
});
