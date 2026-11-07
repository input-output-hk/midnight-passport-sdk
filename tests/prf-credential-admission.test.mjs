import assert from 'node:assert/strict';
import test from 'node:test';
import { passkeyPrf } from '../packages/adapter-webauthn/dist/index.js';
import { softwareAuthenticator, ID, RP } from './fixtures/software-authenticator.mjs';

for (const representation of ['Buffer', 'Uint8Array']) {
  test(`${representation} credential admission owns its pinned ID before asynchronous ceremony review`, async () => {
    const expected = Uint8Array.from(ID);
    for (const returned of ['original', 'mutated']) {
      const auth = softwareAuthenticator();
      const input = representation === 'Buffer' ? Buffer.from(ID) : Uint8Array.from(ID);
      /** @type {{authoriser: Uint8Array; root: Uint8Array} | undefined} */
      let provider;
      const credentials = {
        ...auth.container,
        async get(/** @type {Parameters<typeof auth.container.get>[0]} */ request) {
          const credential = await auth.container.get(request);
          assert.ok(credential);
          const results = credential.getClientExtensionResults().prf?.results;
          assert.ok(results?.first && results.second);
          provider = {
            authoriser: new Uint8Array(results.first),
            root: new Uint8Array(results.second),
          };
          return {
            ...credential,
            rawId: returned === 'original' ? credential.rawId : Uint8Array.from(input).buffer,
          };
        },
      };
      const operation = passkeyPrf({
        rpId: RP,
        credentialId: input,
        credentials,
        async beforeCeremony({ purpose }) {
          assert.equal(purpose, 'derive-keys');
          input.fill(9);
          await Promise.resolve();
        },
      });
      if (returned === 'original') {
        const outputs = await operation;
        try {
          assert.equal(outputs.authoriser.length, 32);
          assert.equal(outputs.root.length, 32);
          assert.ok(outputs.authoriser.some((byte) => byte !== 0));
          assert.ok(outputs.root.some((byte) => byte !== 0));
        } finally {
          outputs.authoriser.fill(0);
          outputs.root.fill(0);
        }
        assert.ok(outputs.authoriser.every((byte) => byte === 0));
        assert.ok(outputs.root.every((byte) => byte === 0));
      } else {
        await assert.rejects(operation, {
          code: 'AccountNotFound',
          message: /not the passkey this account was created with/,
        });
      }
      assert.equal(auth.gets.length, 1, 'a selection is never retried or repinned after review');
      assert.deepEqual(auth.gets[0]?.allowCredentials?.[0]?.id, expected);
      assert.ok(provider);
      assert.ok(
        provider.authoriser.some((byte) => byte !== 0),
        'provider-owned output stays untouched',
      );
      assert.ok(
        provider.root.some((byte) => byte !== 0),
        'provider-owned output stays untouched',
      );
      provider.authoriser.fill(0);
      provider.root.fill(0);
    }
  });
}
