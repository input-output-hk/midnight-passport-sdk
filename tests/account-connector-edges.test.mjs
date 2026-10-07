// Edges of the account connector that account-connector.test.mjs leaves out: the use-counter
// rescan bound, what the ceremonies and chain calls are handed, finishActivation's refusals, the
// backoff of the deployed registry write, and the error taxonomy on each leg.
import { mock, test } from 'node:test';
import assert from 'node:assert/strict';

const a = await import(new URL('../packages/account/dist/index.js', import.meta.url).href);
const { PASSPORT_CONNECTOR_VERSION } = await import(
  new URL('../packages/protocol/dist/index.js', import.meta.url).href
);

const ADDRESS = 'cd'.repeat(32);
const enc = (/** @type {string} */ s) => new TextEncoder().encode(s);
const text = (/** @type {Uint8Array} */ b) => new TextDecoder().decode(b);

/**
 * @typedef {{ x: bigint; y: bigint; identity: false }} Pk
 * @typedef {{ rp_id_hash: Uint8Array; origin: Uint8Array }} Policy
 * @typedef {{ credentialId: Uint8Array; publicKey: Pk; policy: Policy; address: string; salt: Uint8Array; status: string }} Rec
 * @typedef {{ booted: boolean; authNonce: bigint; deviceEpoch: bigint; entries: Set<string> }} Ledger
 */

/**
 * A world whose ledger holds a set of device entries, named `${epoch}:${counter}` for the world's
 * own passkey. The pure circuit stand-ins record every probe, so the scan's bound is observable.
 * @param {{ ledger?: Partial<Ledger>; onActivate?: (ledger: Ledger) => void }} [options]
 */
function world({ ledger: init = {}, onActivate } = {}) {
  const credential = {
    credentialId: Uint8Array.of(7),
    publicKey: /** @type {Pk} */ ({ x: 11n, y: 13n, identity: false }),
    policy: { rp_id_hash: new Uint8Array(32).fill(1), origin: enc('http://localhost:5173') },
  };
  /** @type {Ledger} */
  const ledger = {
    booted: true,
    authNonce: 5n,
    deviceEpoch: 2n,
    entries: new Set(),
    ...init,
  };
  /** @type {{ self: Uint8Array; epoch: bigint; counter: bigint }[]} */
  const probes = [];
  /** @type {[string, ...unknown[]][]} */
  const log = [];
  /** @type {Map<string, Rec>} */
  const registry = new Map();
  /** @type {Rec | undefined} */
  let planted;
  const key = (/** @type {Uint8Array} */ id) => Buffer.from(id).toString('hex');
  const entryName = (/** @type {bigint} */ epoch, /** @type {bigint} */ counter) =>
    `${epoch}:${counter}`;

  const seams = {
    networkId: 'undeployed',
    bindingId: 'acc-test',
    pureCircuits: {
      derive_boot_commitment_with_p256: (/** @type {Uint8Array} */ salt) => enc(`boot:${salt[0]}`),
      derive_device_entry_with_p256: (
        /** @type {{ bytes: Uint8Array }} */ self,
        /** @type {Pk} */ _pk,
        /** @type {Policy} */ _policy,
        /** @type {bigint} */ epoch,
        /** @type {bigint} */ counter,
      ) => {
        probes.push({ self: self.bytes, epoch, counter });
        return enc(entryName(epoch, counter));
      },
      challenge_rotate_enc_key_with_p256: (
        /** @type {unknown} */ _self,
        /** @type {Pk} */ _pk,
        /** @type {Uint8Array} */ newKey,
        /** @type {bigint} */ nonce,
      ) => enc(`rot:${newKey[0]}:${nonce}`),
    },
    passkey: {
      create: async () => credential,
      identify: async () => ({ credentialId: credential.credentialId, owns: () => true }),
      sign: async (/** @type {unknown} */ _c, /** @type {Uint8Array} */ challenge) => {
        log.push(['sign', text(challenge)]);
        return { authenticator_data: new Uint8Array(37), sig: { r: 1n, s: 2n } };
      },
    },
    chain: {
      deploy: async (/** @type {{ boot: Uint8Array; encKey: Uint8Array }} */ args) => {
        log.push(['deploy', args]);
        return { address: ADDRESS, txHashes: ['t0'] };
      },
      readLedger: async (/** @type {string} */ address) => {
        log.push(['readLedger', address]);
        if (address !== ADDRESS) return undefined;
        return {
          booted: ledger.booted,
          authNonce: ledger.authNonce,
          deviceEpoch: ledger.deviceEpoch,
          entryCount: ledger.entries.size,
          specVersion: 3,
          hasEntry: (/** @type {Uint8Array} */ e) => ledger.entries.has(text(e)),
        };
      },
      call: async (
        /** @type {string} */ _address,
        /** @type {string} */ circuit,
        /** @type {readonly unknown[]} */ args,
      ) => {
        log.push([circuit, args]);
        if (circuit === 'activate_initial_device_with_p256') {
          ledger.booted = true;
          if (onActivate) onActivate(ledger);
          else ledger.entries.add(entryName(ledger.deviceEpoch, 0n));
        }
        return { txHash: `tx-${log.length}` };
      },
    },
    registry: {
      put: async (/** @type {string} */ _n, /** @type {Rec} */ r) => {
        log.push(['put', r.status]);
        registry.set(key(r.credentialId), r);
      },
      get: async (/** @type {string} */ n, /** @type {Uint8Array} */ id) => {
        log.push(['get', n, id]);
        return planted ?? registry.get(key(id));
      },
    },
    random: (/** @type {number} */ n) => new Uint8Array(n).fill(9),
    encryptionKey: async (/** @type {unknown} */ _c) => new Uint8Array(32).fill(4),
  };
  /** Files a record for the world's passkey, as the registry would hold it. @param {string} status */
  const plant = (status) => {
    planted = { ...credential, address: ADDRESS, salt: new Uint8Array(32).fill(9), status };
  };
  const calls = (/** @type {string} */ name) => log.filter((l) => l[0] === name);
  return { seams, credential, ledger, probes, log, registry, plant, calls, entryName };
}

/** Opens the world's account through the connector, from an active record. @param {ReturnType<typeof world>} w */
async function openActive(w) {
  w.plant('active');
  return a.createPassportConnector(w.seams).openAccount();
}

test('the connector reports its API version and the network it is bound to', () => {
  const w = world();
  const connector = a.createPassportConnector(w.seams);
  assert.equal(connector.apiVersion, PASSPORT_CONNECTOR_VERSION);
  assert.equal(connector.networkId, 'undeployed');
});

test('the rescan covers use counters 0..63: an entry at 63 is found, one at 64 is not', async () => {
  assert.equal(a.RESCAN_LIMIT, 64);
  const w = world();
  w.ledger.entries.add(w.entryName(2n, 63n));
  const account = await openActive(w);
  await account.rotateEncryptionKey(Uint8Array.of(1));
  const [, auth] = /** @type {[Uint8Array, { use_counter: bigint }]} */ (
    w.calls('rotate_enc_key_with_p256')[0]?.[1]
  );
  assert.equal(auth.use_counter, 63n);

  // The 64th rotation moved the entry to counter 64: past the bound, so the passkey is not found.
  const beyond = world();
  beyond.ledger.entries.add(beyond.entryName(2n, 64n));
  beyond.plant('active');
  await assert.rejects(a.createPassportConnector(beyond.seams).openAccount(), {
    code: 'AccountNotFound',
    message: /does not hold this passkey/,
  });
  const counters = beyond.probes.map((p) => p.counter);
  assert.equal(counters.length, 64);
  assert.equal(counters[0], 0n);
  assert.equal(counters.at(-1), 63n);
});

test('rotation with no live entry within the bound is AccountNotFound, before any prompt or call', async () => {
  const w = world();
  w.ledger.entries.add(w.entryName(2n, 5n));
  const account = await openActive(w);
  // The entry leaves the ledger (the device was removed) after the account was opened.
  w.ledger.entries.clear();
  await assert.rejects(account.rotateEncryptionKey(Uint8Array.of(1)), {
    code: 'AccountNotFound',
    message: /no live entry/,
  });
  assert.equal(w.calls('sign').length, 0, 'no passkey prompt');
  assert.equal(w.calls('rotate_enc_key_with_p256').length, 0, 'no transaction');
});

test('the scan stops at the first live counter and probes with the ledger epoch and the account address', async () => {
  const w = world();
  w.ledger.entries.add(w.entryName(2n, 5n));
  const account = await openActive(w);
  w.probes.length = 0;
  await account.rotateEncryptionKey(Uint8Array.of(1));
  assert.deepEqual(
    w.probes.map((p) => p.counter),
    [0n, 1n, 2n, 3n, 4n, 5n],
  );
  for (const p of w.probes) {
    assert.equal(p.epoch, 2n, "the ledger's device epoch");
    assert.equal(Buffer.from(p.self).toString('hex'), ADDRESS);
  }
});

test('rotation signs the challenge of the ledger auth nonce and submits the key, key and counter', async () => {
  const w = world();
  w.ledger.entries.add(w.entryName(2n, 3n));
  const account = await openActive(w);
  const result = await account.rotateEncryptionKey(Uint8Array.of(8));
  assert.deepEqual(w.calls('sign'), [['sign', 'rot:8:5']], 'nonce 5, key 8');
  const [newKey, auth] = /** @type {[Uint8Array, Record<string, unknown>]} */ (
    w.calls('rotate_enc_key_with_p256')[0]?.[1]
  );
  assert.deepEqual(newKey, Uint8Array.of(8));
  assert.deepEqual(Object.keys(auth).sort(), [
    'authenticator_data',
    'pk',
    'policy',
    'sig',
    'use_counter',
  ]);
  assert.equal(auth.pk, w.credential.publicKey);
  assert.equal(auth.policy, w.credential.policy);
  assert.equal(auth.use_counter, 3n);
  assert.match(result.txHash, /^tx-/);
});

test('rotation maps a cancelled prompt to UserCancelled, and a chain failure to InternalError with its cause', async () => {
  const w = world();
  w.ledger.entries.add(w.entryName(2n, 0n));
  const account = await openActive(w);

  w.seams.passkey.sign = async () => {
    throw Object.assign(new Error('dismissed'), { name: 'NotAllowedError' });
  };
  await assert.rejects(account.rotateEncryptionKey(Uint8Array.of(1)), { code: 'UserCancelled' });
  assert.equal(w.calls('rotate_enc_key_with_p256').length, 0, 'nothing was submitted');

  w.seams.passkey.sign = async () => ({
    authenticator_data: new Uint8Array(37),
    sig: { r: 1n, s: 2n },
  });
  const boom = new Error('node refused');
  w.seams.chain.call = async () => {
    throw boom;
  };
  await assert.rejects(account.rotateEncryptionKey(Uint8Array.of(1)), (e) => {
    assert.equal(/** @type {{ code: string }} */ (e).code, 'InternalError');
    assert.equal(/** @type {Error} */ (e).message, 'node refused');
    assert.equal(/** @type {Error} */ (e).cause, boom);
    return true;
  });

  // A connector error from a lower layer is not re-wrapped.
  const rejected = new a.PassportConnectorError('SponsorRejected', 'policy');
  w.seams.chain.call = async () => {
    throw rejected;
  };
  await assert.rejects(account.rotateEncryptionKey(Uint8Array.of(1)), (e) => e === rejected);
});

test('state() projects the ledger view, and a vanished contract is AccountNotFound', async () => {
  const w = world();
  w.ledger.entries.add(w.entryName(2n, 0n));
  const account = await openActive(w);
  assert.deepEqual(await account.state(), {
    booted: true,
    authNonce: 5n,
    deviceEpoch: 2n,
    entryCount: 1,
    specVersion: 3,
  });
  w.seams.chain.readLedger = async () => undefined;
  await assert.rejects(account.state(), { code: 'AccountNotFound', message: /No contract at/ });
});

test('an active record opens without activating or rewriting the registry', async () => {
  const w = world();
  w.ledger.entries.add(w.entryName(2n, 0n));
  const account = await openActive(w);
  assert.equal(account.address, ADDRESS);
  assert.equal(account.networkId, 'undeployed');
  assert.equal(account.bindingId, 'acc-test');
  assert.equal(w.calls('activate_initial_device_with_p256').length, 0);
  assert.equal(w.calls('put').length, 0);
});

test('finishActivation activates an unbooted ledger with the record key, salt and policy, then marks it active', async () => {
  const w = world({ ledger: { booted: false } });
  w.plant('deployed');
  const account = await a.createPassportConnector(w.seams).openAccount();
  const [pk, salt, policy] = /** @type {unknown[]} */ (
    w.calls('activate_initial_device_with_p256')[0]?.[1]
  );
  assert.equal(pk, w.credential.publicKey);
  assert.deepEqual(salt, new Uint8Array(32).fill(9));
  assert.equal(policy, w.credential.policy);
  assert.deepEqual(
    w.log.filter((l) => l[0] === 'put' || l[0].startsWith('activate')).map((l) => l[0]),
    ['activate_initial_device_with_p256', 'put'],
    'on-chain first, registry after',
  );
  assert.equal(w.registry.get('07')?.status, 'active');
  assert.equal((await account.state()).booted, true);
});

test('finishActivation refuses a ledger that, once activated, does not hold this passkey, and keeps the record deployed', async () => {
  // A ledger activated with another account's key: its entry is not this passkey's.
  const w = world({
    ledger: { booted: false },
    onActivate: (ledger) => ledger.entries.add('someone-else'),
  });
  w.plant('deployed');
  await assert.rejects(a.createPassportConnector(w.seams).openAccount(), {
    code: 'AccountNotFound',
    message: /does not hold this passkey/,
  });
  assert.equal(w.calls('put').length, 0, 'the registry never says active');
});

test('finishActivation passes an activation failure through the taxonomy and leaves the record deployed', async () => {
  const w = world({ ledger: { booted: false } });
  w.plant('deployed');
  w.seams.chain.call = async () => {
    throw new a.PassportConnectorError('SponsorRejected', 'sponsor policy refused');
  };
  await assert.rejects(a.createPassportConnector(w.seams).openAccount(), {
    code: 'SponsorRejected',
  });
  assert.equal(w.calls('put').length, 0);
});

test('openAccount maps a cancelled picker to UserCancelled and a registry outage to InternalError', async () => {
  const w = world();
  w.seams.passkey.identify = async () => {
    throw Object.assign(new Error('x'), { name: 'AbortError' });
  };
  await assert.rejects(a.createPassportConnector(w.seams).openAccount(), { code: 'UserCancelled' });
  assert.equal(w.calls('get').length, 0, 'the registry is not asked');

  const down = world();
  down.seams.registry.get = async () => {
    throw new Error('registry GET failed: 503');
  };
  await assert.rejects(a.createPassportConnector(down.seams).openAccount(), {
    code: 'InternalError',
    message: 'registry GET failed: 503',
  });
});

test('openAccount looks the record up under the network and the picked credential id', async () => {
  const w = world();
  await assert.rejects(a.createPassportConnector(w.seams).openAccount(), {
    code: 'AccountNotFound',
  });
  assert.deepEqual(w.calls('get')[0]?.slice(1), ['undeployed', Uint8Array.of(7)]);
});

test('createAccount: a cancelled passkey prompt deploys nothing and records nothing', async () => {
  const w = world();
  w.seams.passkey.create = async () => {
    throw Object.assign(new Error('x'), { name: 'NotAllowedError' });
  };
  /** @type {string[]} */
  const steps = [];
  await assert.rejects(
    a
      .createPassportConnector(w.seams)
      .createAccount({ userName: 'u', onProgress: (/** @type {string} */ s) => steps.push(s) }),
    { code: 'UserCancelled' },
  );
  assert.deepEqual(steps, []);
  assert.equal(w.calls('deploy').length, 0);
  assert.equal(w.registry.size, 0);
});

test('createAccount: a failed deploy records nothing, and a sponsor refusal keeps its code', async () => {
  const w = world();
  w.seams.chain.deploy = async () => {
    throw new a.PassportConnectorError('SponsorRejected', 'deployment cap reached');
  };
  /** @type {string[]} */
  const steps = [];
  await assert.rejects(
    a
      .createPassportConnector(w.seams)
      .createAccount({ userName: 'u', onProgress: (/** @type {string} */ s) => steps.push(s) }),
    { code: 'SponsorRejected', message: 'deployment cap reached' },
  );
  assert.deepEqual(steps, ['passkey-created', 'deploying']);
  assert.equal(w.registry.size, 0, 'no address, so no record');
});

test('createAccount: a failed activation reports no active step and leaves a deployed record with the salt', async () => {
  const w = world();
  w.seams.chain.call = async () => {
    throw new Error('sponsor down');
  };
  /** @type {string[]} */
  const steps = [];
  await assert.rejects(
    a
      .createPassportConnector(w.seams)
      .createAccount({ userName: 'u', onProgress: (/** @type {string} */ s) => steps.push(s) }),
    { code: 'InternalError', message: 'sponsor down' },
  );
  assert.deepEqual(steps, ['passkey-created', 'deploying', 'deployed', 'activating']);
  const record = w.registry.get('07');
  assert.equal(record?.status, 'deployed');
  assert.deepEqual(
    record?.salt,
    new Uint8Array(32).fill(9),
    'the salt that opens the boot commitment',
  );
  assert.equal(record?.address, ADDRESS);
});

test('createAccount deploys the boot commitment of the random salt and the derived encryption key', async () => {
  const w = world();
  await a.createPassportConnector(w.seams).createAccount({ userName: 'u' });
  const args = /** @type {{ boot: Uint8Array; encKey: Uint8Array }} */ (w.calls('deploy')[0]?.[1]);
  assert.equal(text(args.boot), 'boot:9');
  assert.deepEqual(args.encKey, new Uint8Array(32).fill(4));
});

test('the deployed registry write backs off 200, 400 and 800 ms, and a final failure keeps its cause', async () => {
  /** @type {number[]} */
  const delays = [];
  const sleep = mock.method(
    globalThis,
    'setTimeout',
    (/** @type {() => void} */ run, /** @type {number} */ ms) => {
      delays.push(ms);
      run();
      return 0;
    },
  );
  try {
    const w = world();
    const cause = 'registry down';
    w.seams.registry.put = async () => {
      throw cause; // a thrown string, not an Error: its text still reaches the message
    };
    await assert.rejects(
      a.createPassportConnector(w.seams).createAccount({ userName: 'u' }),
      (e) => {
        assert.equal(/** @type {{ code: string }} */ (e).code, 'InternalError');
        assert.match(/** @type {Error} */ (e).message, /after 4 attempts: registry down$/);
        assert.equal(/** @type {Error} */ (e).cause, cause);
        return true;
      },
    );
    assert.deepEqual(
      delays,
      [200, 400, 800],
      'three waits between four attempts, none after the last',
    );
    assert.equal(a.DEPLOYED_PUT_RETRIES, 3);
  } finally {
    sleep.mock.restore();
  }
});
