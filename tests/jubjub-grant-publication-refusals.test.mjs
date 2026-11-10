// Generated ACC validates actual JubJub signatures and key recipes; no native acceptance claim.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { publishJubjubGrantBookkeeping } from '../packages/account/dist/index.js';
import { jubjubPublicationFixture } from './fixtures/jubjub-publication-fixture.mjs';

for (const seals of ['empty', 'one', 'short']) {
  test(`malformed ${seals} required bookkeeping seals refuse before any signature or send`, async () => {
    const f = await jubjubPublicationFixture();
    f.fault.seals = seals;
    await assert.rejects(publishJubjubGrantBookkeeping(f.input, f.ports), {
      code: 'InternalError',
      message: 'Viewing key returned invalid grant seals.',
    });
    assert.equal(f.signatures.length, 0);
    assert.equal(f.calls.length, 0);
    assert.equal(f.marked(), false);
    assert.ok(await f.ports.journal.load(f.input.hint.address, f.input.grantId));
  });
}

for (const signature of ['key', 'counter']) {
  test(`wrong ${signature} signature refuses before dispatch`, async () => {
    const f = await jubjubPublicationFixture();
    f.fault.signature = signature;
    await assert.rejects(publishJubjubGrantBookkeeping(f.input, f.ports), {
      code: 'NotAuthorised',
      message: 'The signature names another device.',
    });
    assert.equal(f.calls.length, 0);
    assert.equal(f.marked(), false);
  });
}

test('abort during signing refuses dispatch while retaining the original staged grant', async () => {
  const f = await jubjubPublicationFixture();
  const sign = f.authoriser.authorise;
  f.authoriser.authorise = async function (request) {
    const signed = await sign.call(this, request);
    f.controller.abort('signed but caller closed');
    return signed;
  };
  await assert.rejects(publishJubjubGrantBookkeeping(f.input, f.ports), { code: 'Aborted' });
  assert.equal(f.signatures.length, 1);
  assert.equal(f.calls.length, 0);
  assert.equal(f.marked(), false);
});
