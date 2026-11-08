import assert from 'node:assert/strict';
import { test } from 'node:test';
import { x25519 } from '@noble/curves/ed25519.js';
import { p256 } from '@noble/curves/nist.js';
import { recipeDeviceKeyring, sealInboxCoin, openGrantView } from '../packages/keys/dist/index.js';
import {
  openDeviceEnvelope,
  openDeviceRegistration,
} from '../packages/keys/dist/device-envelope.js';
import { openInboxCoin } from '../packages/keys/dist/inbox-coin.js';
import { openGrantRecord } from '../packages/keys/dist/grant-record.js';
import {
  keyringFixture,
  reader,
  hex,
  account,
  devicePublicKey,
  controlledSource,
} from './fixtures/overnight-keys-ownership-fixture.mjs';

/** @param {import('../packages/keys/dist/device-envelope.js').AccountSecrets | null} value */
const erase = (value) => {
  value?.secret.fill(0);
  value?.rosterKey.fill(0);
};
/** @param {import('../packages/account/dist/ports/index.js').ShieldedCoin | null} value */
const eraseCoin = (value) => {
  value?.nonce.fill(0);
  value?.color.fill(0);
};

test('delivery pins recipient, registration policy and keyring Buffer bytes before the key session', async () => {
  const f = await keyringFixture();
  try {
    const firstSecret = f.bytes(32, 7),
      replacementSecret = f.bytes(32, 8);
    const joining = {
      ...reader(7),
      scheme: /** @type {'p256-webauthn'} */ ('p256-webauthn'),
      devicePublicKey: hex(p256.Point.BASE.toBytes(true)),
      policy: { rp_id_hash: f.bytes(32, 3), origin: f.bytes(21, 4) },
    };
    const expected = structuredClone(joining);
    f.control.pause();
    const pending = f.owner.sealToDevice('undeployed', f.ring, joining);
    joining.readerPublicKey = reader(8).readerPublicKey;
    joining.devicePublicKey = hex(p256.Point.BASE.multiply(2n).toBytes(true));
    joining.policy.rp_id_hash.fill(5);
    joining.policy.origin.fill(6);
    f.ring.encKey.fill(0);
    f.ring.envelopes[0]?.fill(0);
    f.ring.envelopes.push(Buffer.alloc(192));
    f.control.release();
    const delivered = await pending;
    const opened = await openDeviceEnvelope(firstSecret, delivered.envelope);
    try {
      assert.ok(opened);
      assert.equal(await openDeviceEnvelope(replacementSecret, delivered.envelope), null);
      const registration = await openDeviceRegistration(opened.rosterKey, delivered.registration);
      assert.deepEqual(registration, {
        readerPublicKey: expected.readerPublicKey,
        devicePublicKey: expected.devicePublicKey,
        scheme: expected.scheme,
        policy: expected.policy,
      });
      assert.ok(
        joining.policy.rp_id_hash.every((v) => v === 5),
        'caller policy bytes are not cleared',
      );
    } finally {
      erase(opened);
    }
  } finally {
    f.close();
  }
});

test('coin resealing pins destination Buffer, ciphertext bytes and input array before awaiting', async () => {
  const f = await keyringFixture();
  try {
    const coin = { nonce: f.bytes(32, 1), color: f.bytes(32, 2), value: 7n };
    const ciphertext = Buffer.from(await sealInboxCoin(f.ring.encKey, coin));
    const entries = [ciphertext];
    const firstSecret = f.bytes(32, 12),
      replacementSecret = f.bytes(32, 13);
    const destination = Buffer.from(x25519.getPublicKey(firstSecret));
    f.control.pause();
    const pending = f.owner.reencryptCoins(
      'undeployed',
      { keyring: f.ring, to: destination },
      entries,
    );
    destination.set(x25519.getPublicKey(replacementSecret));
    ciphertext.fill(0);
    entries.push(Buffer.alloc(0));
    f.control.release();
    const resealed = await pending;
    assert.equal(resealed.length, 1);
    assert.ok(resealed[0]);
    const opened = await openInboxCoin(firstSecret, resealed[0]);
    try {
      assert.deepEqual(opened, structuredClone(coin));
      assert.equal(await openInboxCoin(replacementSecret, resealed[0]), null);
    } finally {
      eraseCoin(opened);
    }
    assert.deepEqual(
      destination,
      Buffer.from(x25519.getPublicKey(replacementSecret)),
      'caller destination is never zeroed',
    );
    assert.ok(coin.nonce.every((v) => v === 1));
    assert.ok(coin.color.every((v) => v === 2));
  } finally {
    f.close();
  }
});

for (const method of /** @type {const} */ (['openCoins', 'openInbox'])) {
  test(`${method} processes its admitted count even when the caller grows past 4096`, async () => {
    const f = await keyringFixture();
    try {
      /** @type {Uint8Array[]} */ const entries = [];
      f.control.pause();
      const pending = f.owner[method]('undeployed', f.ring, entries);
      entries.push(...Array.from({ length: 4097 }, () => new Uint8Array(0)));
      f.control.release();
      assert.deepEqual(await pending, []);
    } finally {
      f.close();
    }
  });
}

test('openInbox pins the account and mixed ciphertext records before the key session', async () => {
  const f = await keyringFixture();
  try {
    const grant = {
      grantId: 'cd'.repeat(32),
      slot: 0,
      scopeSalt: 'ef'.repeat(32),
      granteePublicKey: reader(7).readerPublicKey,
      object: {
        color: '01'.repeat(32),
        recipient: { kind: /** @type {'any'} */ ('any') },
        maxCoinValue: '0',
      },
    };
    const grantEntries = await f.owner.sealGrant('undeployed', account, grant);
    const entries = grantEntries.map((entry) => Buffer.from(entry));
    f.control.pause();
    const pending = f.owner.openInbox('undeployed', f.ring, entries);
    f.ring.account = 'ff'.repeat(32);
    entries.forEach((entry) => entry.fill(0));
    entries.length = 0;
    f.control.release();
    const opened = await pending;
    assert.equal(opened.length, 2);
    assert.equal(opened[0]?.kind, 'grant');
    assert.equal(opened[1]?.kind, 'grant');
  } finally {
    f.close();
  }
});

test('creation pins its self identity and P-256 policy before the first session', async () => {
  const control = controlledSource();
  const owner = recipeDeviceKeyring(control.source);
  const policy = { rp_id_hash: Buffer.alloc(32, 4), origin: Buffer.alloc(21, 5) };
  const request = {
    devicePublicKey: hex(p256.Point.BASE.toBytes(true)),
    scheme: /** @type {'p256-webauthn'} */ ('p256-webauthn'),
    policy,
  };
  const expected = structuredClone(request);
  control.pause();
  const pending = owner.createKeys('undeployed', request);
  request.devicePublicKey = hex(p256.Point.BASE.multiply(2n).toBytes(true));
  policy.rp_id_hash.fill(6);
  policy.origin.fill(7);
  control.release();
  const created = await pending;
  assert.ok(created.envelopes[0] && created.registrations[0]);
  const ownSecret = Buffer.alloc(32, 9);
  const opened = await openDeviceEnvelope(ownSecret, created.envelopes[0]);
  ownSecret.fill(0);
  try {
    assert.ok(opened);
    const registration = await openDeviceRegistration(opened.rosterKey, created.registrations[0]);
    assert.deepEqual(registration?.policy, expected.policy);
    assert.equal(registration?.devicePublicKey, expected.devicePublicKey);
    assert.ok(policy.rp_id_hash.every((v) => v === 6));
    assert.ok(control.outputs.every((v) => v.every((byte) => byte === 0)));
  } finally {
    erase(opened);
    policy.rp_id_hash.fill(0);
    policy.origin.fill(0);
  }
});

test('rotation pins live readers, registration ciphertexts and removal intent', async () => {
  const f = await keyringFixture();
  try {
    const joining = reader(7);
    const delivery = await f.owner.sealToDevice('undeployed', f.ring, joining);
    const request = {
      devicePublicKey,
      keyring: f.ring,
      readers: [joining],
      registrations: [Buffer.from(delivery.registration)],
      rotateRoster: true,
      removed: { devicePublicKey: reader(8).devicePublicKey, epoch: 0n, counter: 0n },
    };
    f.control.pause();
    const pending = f.owner.createKeys('undeployed', request);
    joining.readerPublicKey = reader(8).readerPublicKey;
    joining.devicePublicKey = reader(8).devicePublicKey;
    request.removed.devicePublicKey = reader(7).devicePublicKey;
    request.registrations[0]?.fill(0);
    request.readers.length = 0;
    f.control.release();
    const created = await pending;
    assert.equal(created.envelopes.length, 2);
    assert.ok(created.envelopes[1]);
    const firstSecret = f.bytes(32, 7),
      secondSecret = f.bytes(32, 8);
    const opened = await openDeviceEnvelope(firstSecret, created.envelopes[1]);
    try {
      assert.ok(opened);
      assert.equal(await openDeviceEnvelope(secondSecret, created.envelopes[1]), null);
    } finally {
      erase(opened);
    }
  } finally {
    f.close();
  }
});

test('grant sealing captures both bookkeeping parts including nested recipient before the session', async () => {
  const f = await keyringFixture();
  try {
    const grant = {
      grantId: 'cd'.repeat(32),
      slot: 3,
      scopeSalt: 'ef'.repeat(32),
      granteePublicKey: reader(7).readerPublicKey,
      readPublicKey: reader(8).readerPublicKey,
      object: {
        color: '01'.repeat(32),
        recipient: {
          kind: /** @type {'coin-public-key'} */ ('coin-public-key'),
          value: '02'.repeat(32),
        },
        maxCoinValue: '0007',
      },
    };
    const expected = structuredClone(grant);
    f.control.pause();
    const pending = f.owner.sealGrant('undeployed', account, grant);
    grant.grantId = 'ff'.repeat(32);
    grant.slot = 4;
    grant.scopeSalt = 'ee'.repeat(32);
    grant.granteePublicKey = reader(8).readerPublicKey;
    grant.object.color = '03'.repeat(32);
    grant.object.recipient.value = '04'.repeat(32);
    grant.object.maxCoinValue = '8';
    f.control.release();
    const sealed = await pending;
    assert.ok(sealed[0] && sealed[1]);
    const raw = f.bytes(32, 9);
    assert.deepEqual(await openGrantRecord(raw, account, sealed[0]), {
      part: 'grant',
      grantId: expected.grantId,
      slot: expected.slot,
      scopeSalt: expected.scopeSalt,
      granteePublicKey: expected.granteePublicKey,
      readPublicKey: expected.readPublicKey,
    });
    assert.deepEqual(await openGrantRecord(raw, account, sealed[1]), {
      part: 'object',
      grantId: expected.grantId,
      object: { ...expected.object, maxCoinValue: '7' },
    });
  } finally {
    f.close();
  }
});

test('read-grant delivery captures context, destination and bookkeeping from one request', async () => {
  const f = await keyringFixture();
  try {
    const readSecret = f.bytes(32, 7),
      replacement = f.bytes(32, 8);
    const request = {
      grantId: 'cd'.repeat(32),
      account,
      readPublicKey: hex(x25519.getPublicKey(readSecret)),
    };
    const expectedEncKey = Buffer.from(f.ring.encKey);
    f.control.pause();
    assert.ok(f.owner.sealView);
    const pending = f.owner.sealView('undeployed', f.ring, request);
    request.grantId = 'ef'.repeat(32);
    request.account = 'ff'.repeat(32);
    request.readPublicKey = hex(x25519.getPublicKey(replacement));
    f.ring.encKey.fill(0);
    f.control.release();
    const delivery = await pending;
    const opened = await openGrantView(readSecret, {
      grantId: 'cd'.repeat(32),
      account,
      seal: delivery.seal,
      expectedEncKey,
    });
    try {
      assert.deepEqual(opened, f.secrets.secret);
      const record = await openGrantRecord(f.bytes(32, 9), account, delivery.entry);
      assert.deepEqual(record, {
        part: 'view',
        grantId: 'cd'.repeat(32),
        encKeyPrefix: hex(expectedEncKey.subarray(0, 3)),
        seal: hex(delivery.seal),
      });
    } finally {
      opened?.fill(0);
    }
  } finally {
    f.close();
  }
});

test('owned entry bounds admit 4096 noise items and reject 4097 before a session', async () => {
  const f = await keyringFixture();
  try {
    const noise = Array.from({ length: 4096 }, () => new Uint8Array(0));
    const opened = await f.owner.openCoins('undeployed', f.ring, noise);
    assert.equal(opened.length, 4096);
    assert.ok(opened.every((v) => v === null));
    const sessions = f.control.sessions();
    noise.push(new Uint8Array(0));
    assert.throws(() => f.owner.openCoins('undeployed', f.ring, noise), /too many inbox entries/);
    assert.throws(() => f.owner.openInbox('undeployed', f.ring, noise), /too many inbox entries/);
    assert.throws(
      () => f.owner.reencryptCoins('undeployed', { keyring: f.ring, to: f.ring.encKey }, noise),
      /too many inbox entries/,
    );
    await assert.rejects(
      f.owner.openCoins('undeployed', { ...f.ring, envelopes: noise }, []),
      /too many device envelopes/,
    );
    assert.equal(f.control.sessions(), sessions);
  } finally {
    f.close();
  }
});

test('malformed public identity, policy, keys and decimal text refuse before a credential scope', async () => {
  const f = await keyringFixture();
  try {
    const sessions = f.control.sessions();
    await assert.rejects(
      f.owner.sealToDevice('undeployed', f.ring, { ...reader(7), readerPublicKey: 'bad' }),
      /device keys/,
    );
    await assert.rejects(
      f.owner.createKeys('undeployed', {
        devicePublicKey: hex(p256.Point.BASE.toBytes(true)),
        scheme: 'p256-webauthn',
        policy: { rp_id_hash: Buffer.alloc(33), origin: Buffer.alloc(21) },
      }),
      /P-256 registration policy/,
    );
    await assert.rejects(
      f.owner.openCoins('undeployed', { ...f.ring, encKey: Buffer.alloc(33) }, []),
      /ACC enc_key/,
    );
    assert.throws(
      () => f.owner.reencryptCoins('undeployed', { keyring: f.ring, to: Buffer.alloc(31) }, []),
      /new ACC enc_key/,
    );
    await assert.rejects(
      f.owner.sealGrant('undeployed', account, {
        grantId: 'cd'.repeat(32),
        slot: 0,
        scopeSalt: 'ef'.repeat(32),
        granteePublicKey: reader(7).readerPublicKey,
        object: {
          color: '01'.repeat(32),
          recipient: { kind: 'any' },
          maxCoinValue: '9'.repeat(10000),
        },
      }),
      /uint128 decimal/,
    );
    assert.equal(f.control.sessions(), sessions);
  } finally {
    f.close();
  }
});

test('creation copies the same policy byte fields that passed admission', async () => {
  const control = controlledSource();
  const owner = recipeDeviceKeyring(control.source);
  const rp = Buffer.alloc(32, 4),
    origin = Buffer.alloc(21, 5);
  let rpReads = 0,
    originReads = 0;
  const created = await owner.createKeys('undeployed', {
    devicePublicKey: hex(p256.Point.BASE.toBytes(true)),
    scheme: 'p256-webauthn',
    policy: {
      get rp_id_hash() {
        return ++rpReads === 1 ? rp : new Uint8Array(1024 * 1024);
      },
      get origin() {
        return ++originReads === 1 ? origin : new Uint8Array(1024 * 1024);
      },
    },
  });
  const envelope = created.envelopes[0],
    registration = created.registrations?.[0];
  assert.ok(envelope && registration);
  const readerSecret = Buffer.alloc(32, 9);
  const opened = await openDeviceEnvelope(readerSecret, envelope);
  try {
    assert.ok(opened);
    const result = await openDeviceRegistration(opened.rosterKey, registration);
    assert.ok(result?.policy);
    assert.deepEqual(result.policy.rp_id_hash, new Uint8Array(rp));
    assert.deepEqual(result.policy.origin, new Uint8Array(origin));
    assert.equal(rpReads, 1);
    assert.equal(originReads, 1);
  } finally {
    readerSecret.fill(0);
    erase(opened);
    rp.fill(0);
    origin.fill(0);
  }
});
