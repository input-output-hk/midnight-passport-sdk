import assert from 'node:assert/strict';
import { test } from 'node:test';
import { webauthnPolicy } from '@input-output-hk/mn-passport-adapter-webauthn';
import { parseDeviceHandoff } from '../src/device-handoff.ts';
import { prepareDeviceHandoff } from '../src/device-handoff.ts';
import { createMockCredentials } from '../src/dev/mock-passkey.ts';

const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString('hex');
const expected = {
  accountAddress: 'ab'.repeat(32),
  networkId: 'undeployed',
  bindingId: 'acc-s3r1.1',
  rpId: 'localhost',
  origin: 'http://localhost:5173',
  arm: 'p256' as const,
};
const policy = webauthnPolicy(expected.rpId, expected.origin);
const body = {
  kind: 'mn-passport-device-handoff-v1' as const,
  accountAddress: expected.accountAddress,
  networkId: expected.networkId,
  bindingId: expected.bindingId,
  readerPublicKey: 'cd'.repeat(32),
  devicePublicKey: `02${'ef'.repeat(32)}`,
  scheme: 'p256-webauthn' as const,
  policy: { rpIdHash: hex(policy.rp_id_hash), origin: hex(policy.origin) },
};
const fingerprint = async (value: typeof body) =>
  hex(
    new Uint8Array(
      await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value))),
    ),
  );

test('public device handoff validates the exact account, network, binding and policy', async () => {
  const handoff = { ...body, fingerprint: await fingerprint(body) };
  const parsed = await parseDeviceHandoff(JSON.stringify(handoff), expected);
  assert.equal(parsed.handoff.fingerprint, handoff.fingerprint);
  assert.ok('scheme' in parsed.reader);
  assert.equal(parsed.reader.scheme, 'p256-webauthn');
  await assert.rejects(
    parseDeviceHandoff(JSON.stringify(handoff), { ...expected, networkId: 'preview' }),
    /does not match/,
  );
  await assert.rejects(
    parseDeviceHandoff(JSON.stringify(handoff), { ...expected, accountAddress: 'ac'.repeat(32) }),
    /does not match/,
  );
  await assert.rejects(
    parseDeviceHandoff(JSON.stringify(handoff), { ...expected, origin: 'http://localhost:9999' }),
    /different origin/,
  );
});

test('changed keys, extra private fields and unsupported arm are refused', async () => {
  const handoff = { ...body, fingerprint: await fingerprint(body) };
  await assert.rejects(
    parseDeviceHandoff(
      JSON.stringify({ ...handoff, devicePublicKey: `03${'ef'.repeat(32)}` }),
      expected,
    ),
    /fingerprint/,
  );
  await assert.rejects(
    parseDeviceHandoff(JSON.stringify({ ...handoff, privateKey: 'secret' }), expected),
    /unexpected field/,
  );
  await assert.rejects(
    parseDeviceHandoff(JSON.stringify(handoff), { ...expected, arm: 'jubjub' }),
    /does not match/,
  );
});

test('a mock joining browser exports only public P-256 and JubJub handoff metadata', async () => {
  const memory = new Map<string, string>();
  const credentials = createMockCredentials({
    storage: {
      getItem: (key) => memory.get(key) ?? null,
      setItem: (key, value) => void memory.set(key, value),
    },
    origin: expected.origin,
  });
  const generated = await prepareDeviceHandoff(
    expected.accountAddress,
    expected.networkId,
    'p256',
    {
      bindingId: expected.bindingId,
      rpId: expected.rpId,
      origin: expected.origin,
      credentials,
    },
  );
  assert.deepEqual(Object.keys(generated).sort(), [
    'accountAddress',
    'bindingId',
    'devicePublicKey',
    'fingerprint',
    'kind',
    'networkId',
    'policy',
    'readerPublicKey',
    'scheme',
  ]);
  assert.equal(
    (await parseDeviceHandoff(JSON.stringify(generated), expected)).handoff.fingerprint,
    generated.fingerprint,
  );
  const jubjub = await prepareDeviceHandoff(expected.accountAddress, expected.networkId, 'jubjub', {
    bindingId: expected.bindingId,
    rpId: expected.rpId,
    origin: expected.origin,
    credentials,
  });
  assert.equal(jubjub.scheme, 'jubjub-schnorr');
  assert.equal(jubjub.policy, undefined);
  assert.equal(
    (await parseDeviceHandoff(JSON.stringify(jubjub), { ...expected, arm: 'jubjub' })).handoff
      .fingerprint,
    jubjub.fingerprint,
  );
});
