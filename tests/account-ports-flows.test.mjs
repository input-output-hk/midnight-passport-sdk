// createPassportAccounts over plain port objects, with no seams: the flows, the lazy ports and the
// arm checks. The deprecated createPassportConnector runs the same flows through its bridge, and
// account-connector*.test.mjs hold it to the prototype's behaviour unchanged.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const a = await import(new URL('../packages/account/dist/index.js', import.meta.url).href);

/**
 * @typedef {import('../packages/account/dist/ports/index.js').AccountHint} AccountHint
 * @typedef {import('../packages/account/dist/ports/index.js').AccountDirectory} AccountDirectory
 * @typedef {import('../packages/account/dist/ports/index.js').AccLedgerView} AccLedgerView
 * @typedef {import('../packages/account/dist/ports/index.js').Chain} Chain
 * @typedef {import('../packages/account/dist/ports/index.js').PassportPorts} PassportPorts
 * @typedef {import('../packages/account/dist/ports/index.js').P256PublicKey} P256PublicKey
 * @typedef {import('../packages/account/dist/ports/index.js').WebAuthnPolicy} WebAuthnPolicy
 */

/**
 * Plain port objects for one P-256 passkey, with no seams: an in-memory directory and a ledger
 * whose entries are `${pk.x}:${counter}`.
 */
function portsWorld() {
  const enc = (/** @type {string} */ s) => new TextEncoder().encode(s);
  const text = (/** @type {Uint8Array} */ b) => new TextDecoder().decode(b);
  const credentialId = Uint8Array.of(7);
  /** @type {P256PublicKey} */
  const publicKey = { x: 11n, y: 13n, identity: false };
  /** @type {WebAuthnPolicy} */
  const policy = { rp_id_hash: new Uint8Array(32), origin: enc('http://localhost:5173') };
  const ledger = {
    booted: false,
    authNonce: 0n,
    entries: new Set(/** @type {string[]} */ ([])),
    specVersion: 2,
    /** @type {Uint8Array | undefined} */
    encKey: undefined,
  };
  /** @type {Map<string, AccountHint>} */
  const hints = new Map();
  /** @type {unknown[][]} */
  const log = [];
  const loads = { binding: 0, chain: 0 };
  /** @type {Chain} */
  const chain = {
    async call({ circuit, args, onEvent }) {
      log.push(['call', circuit, args]);
      // A chain adapter reports its own steps; the core stamps the flow id on them.
      for (const [i, step] of /** @type {const} */ ([
        'prove',
        'sponsor.balance',
        'sponsor.submit',
        'chain.finality',
      ]).entries()) {
        const base = {
          id: `${circuit}-${i}`,
          flowId: '',
          step,
          clock: /** @type {const} */ ('client'),
        };
        onEvent?.({ ...base, phase: 'start', at: 1 });
        onEvent?.({ ...base, phase: 'end', at: 2, durationMs: 1 });
      }
      if (circuit === 'activate_initial_device_with_p256') {
        ledger.booted = true;
        ledger.entries.add(`${publicKey.x}:0`);
      } else {
        const auth = /** @type {{ use_counter: bigint }} */ (args[1]);
        ledger.entries.delete(`${publicKey.x}:${auth.use_counter}`);
        ledger.entries.add(`${publicKey.x}:${auth.use_counter + 1n}`);
        ledger.authNonce += 1n;
        ledger.encKey = /** @type {Uint8Array} */ (args[0]);
      }
      return { txHash: `tx-${log.length}` };
    },
    async readAccount() {
      /** @type {AccLedgerView} */
      const view = {
        booted: ledger.booted,
        authNonce: ledger.authNonce,
        deviceEpoch: 0n,
        entryCount: ledger.entries.size,
        specVersion: ledger.specVersion,
        ...(ledger.encKey && { encKey: ledger.encKey }),
        hasEntry: (entry) => ledger.entries.has(text(entry)),
      };
      return view;
    },
  };
  /** @type {AccountDirectory} */
  const directory = {
    async get(networkId, key) {
      log.push(['get', networkId, key.kind]);
      return hints.get(text(key.credentialId));
    },
    async put(_networkId, hint) {
      log.push(['put', hint.status, hint.scheme]);
      hints.set(text(hint.credentialId ?? new Uint8Array()), hint);
    },
  };
  /** @type {PassportPorts} */
  const ports = {
    network: {
      networkId: 'undeployed',
      indexerUrl: '',
      indexerWsUrl: '',
      nodeUrl: '',
      artefactUrl: '',
      bindingId: 'acc-test',
      manifestSha256: '00',
    },
    binding: async () => {
      loads.binding++;
      return {
        pureCircuits: {
          derive_boot_commitment_with_p256: (salt) => enc(`boot:${salt.length}`),
          derive_device_entry_with_p256: (_self, pk, _policy, _epoch, counter) =>
            enc(`${pk.x}:${counter}`),
          challenge_rotate_enc_key_with_p256: (_self, _pk, key, nonce) =>
            enc(`rot:${key[0]}:${nonce}`),
        },
      };
    },
    credentials: {
      create: async ({ name }) => {
        log.push(['create', name]);
        return { credentialId };
      },
      identify: async () => ({
        credentialId,
        owns: (key, keyPolicy) => key.x === publicKey.x && keyPolicy === policy,
      }),
    },
    authoriser: {
      scheme: 'p256-webauthn',
      devicePublicKey: async () => ({ x: publicKey.x, y: publicKey.y }),
      deviceBinding: async () => ({ policy, credentialId }),
      async authorise(request) {
        log.push(['authorise', request.circuit, request.credentialId, request.useCounter]);
        assert.ok(request.challenge instanceof Uint8Array);
        return {
          scheme: 'p256-webauthn',
          pk: publicKey,
          useCounter: request.useCounter,
          authenticatorData: new Uint8Array(37),
          sig: { r: 1n, s: 2n },
        };
      },
    },
    encryptionKey: { publicKey: async (networkId) => enc(networkId.padEnd(32, '.')) },
    chain: async () => {
      loads.chain++;
      return chain;
    },
    deployer: {
      async deploy(request) {
        log.push(['deploy', request.retireAuthority, text(request.encKey)]);
        ledger.encKey = request.encKey;
        return { address: 'cd'.repeat(32), txIds: ['t0'] };
      },
    },
    directory,
  };
  return { ports, log, loads, hints, credentialId, ledger };
}

test('createPassportAccounts runs create, rotate and open over plain ports, loading lazy ports once', async () => {
  const w = portsWorld();
  const accounts = a.createPassportAccounts(w.ports);
  assert.equal(accounts.networkId, 'undeployed');
  const created = await accounts.createAccount({ userName: 'u', retireAuthority: true });
  assert.equal(created.bindingId, 'acc-test');
  assert.deepEqual(created.credentialId, w.credentialId);
  await created.rotateEncryptionKey(Uint8Array.of(1));
  const opened = await a.createPassportAccounts(w.ports).openAccount();
  assert.equal(opened.address, created.address);
  await opened.rotateEncryptionKey(Uint8Array.of(2));

  assert.deepEqual(
    w.log.map((l) => l.slice(0, 2)),
    [
      ['create', 'u'],
      ['deploy', true],
      ['put', 'deployed'],
      ['call', 'activate_initial_device_with_p256'],
      ['put', 'active'],
      ['authorise', 'rotate_enc_key_with_p256'],
      ['call', 'rotate_enc_key_with_p256'],
      ['get', 'undeployed'],
      ['authorise', 'rotate_enc_key_with_p256'],
      ['call', 'rotate_enc_key_with_p256'],
    ],
  );
  assert.equal(w.log[1]?.[2], 'undeployed'.padEnd(32, '.'), 'the key for this network');
  assert.equal(w.log[2]?.[2], 'p256-webauthn', 'hints name their arm');
  assert.deepEqual(w.log[7]?.[2], 'credential-id');
  // The second rotation scanned the rolled counter, and each ceremony is pinned to the account.
  assert.deepEqual(w.log[8]?.slice(2), [w.credentialId, 1n]);
  // A key given as a bare point reaches the circuits as a P-256 key.
  const activation = /** @type {unknown[]} */ (w.log[3]?.[2]);
  assert.deepEqual(activation[0], { x: 11n, y: 13n, identity: false });
  // One load per connector for each lazy port.
  assert.deepEqual(w.loads, { binding: 2, chain: 2 });
});

test('createPassportAccounts refuses an arm this release cannot drive, before any prompt', () => {
  const w = portsWorld();
  const { deviceBinding: _binding, ...unbound } = w.ports.authoriser;
  for (const authoriser of [{ ...w.ports.authoriser, scheme: 'jubjub-schnorr' }, unbound]) {
    assert.throws(() => a.createPassportAccounts({ ...w.ports, authoriser }), {
      code: 'BindingUnsupported',
    });
  }
  assert.equal(w.log.length, 0);
});

test('a directory hint of another arm does not belong to the picked passkey', async () => {
  const w = portsWorld();
  await a.createPassportAccounts(w.ports).createAccount({ userName: 'u', retireAuthority: true });
  const [key, hint] = [...w.hints][0] ?? [];
  w.hints.set(/** @type {string} */ (key), {
    .../** @type {AccountHint} */ (hint),
    scheme: 'jubjub-schnorr',
  });
  await assert.rejects(a.createPassportAccounts(w.ports).openAccount(), {
    code: 'AccountNotFound',
    message: /does not belong to this passkey/,
  });
});

test('a failed lazy load is retried on the next use', async () => {
  const w = portsWorld();
  const load = w.ports.chain;
  let failures = 1;
  const accounts = a.createPassportAccounts({
    ...w.ports,
    chain: async () => {
      if (failures-- > 0) throw new Error('chunk failed to load');
      return typeof load === 'function' ? load() : load;
    },
  });
  await assert.rejects(accounts.createAccount({ userName: 'u', retireAuthority: true }), {
    message: /chunk failed/,
  });
  // The deploy ran before the chain was needed; a retry of the flow loads the chain again.
  const opened = await accounts.openAccount();
  assert.equal((await opened.state()).booted, true);
});

// ---- Progress events (design §3.4), signal and errors (design §3.3)

/** @typedef {import('../packages/protocol/dist/index.js').PassportEvent} PassportEvent */

/** Collects a flow's events. */
function events() {
  /** @type {PassportEvent[]} */
  const seen = [];
  return {
    seen,
    onEvent: (/** @type {PassportEvent} */ e) => seen.push(e),
    /** `step:phase` in order. */
    trace: () => seen.map((e) => `${e.step}:${e.phase}`),
  };
}

/**
 * Every start has exactly one end or error with the same id, after it, in one flow; ends carry a
 * duration and every event a timestamp.
 * @param {PassportEvent[]} seen
 */
function assertPaired(seen) {
  const flows = new Set(seen.map((e) => e.flowId));
  assert.equal(flows.size, 1, 'one flow id');
  assert.match([...flows][0] ?? '', /^[0-9a-f]{16}$/);
  for (const [i, e] of seen.entries()) {
    assert.equal(typeof e.at, 'number');
    if (e.phase === 'start') {
      const closes = seen.filter((x) => x.id === e.id && x.phase !== 'start');
      assert.equal(closes.length, 1, `${e.step} closes once`);
      assert.ok(
        seen.indexOf(/** @type {PassportEvent} */ (closes[0])) > i,
        `${e.step} closes after`,
      );
      assert.equal(closes[0]?.step, e.step);
    } else {
      assert.equal(typeof e.durationMs, 'number', `${e.step} ${e.phase} has a duration`);
      assert.ok(
        seen.some((x) => x.id === e.id && x.phase === 'start'),
        `${e.step} was started`,
      );
    }
  }
}

const CHAIN_STEPS = ['prove', 'sponsor.balance', 'sponsor.submit', 'chain.finality'].flatMap(
  (s) => [`${s}:start`, `${s}:end`],
);

test('create, rotate and open each report their steps, every start paired with its end', async () => {
  const w = portsWorld();
  const create = events();
  /** @type {string[]} */
  const progress = [];
  const created = await a.createPassportAccounts(w.ports).createAccount({
    userName: 'u',
    retireAuthority: true,
    onEvent: create.onEvent,
    onProgress: (/** @type {string} */ s) => progress.push(s),
  });
  assert.deepEqual(create.trace(), [
    'passkey.create:start',
    'passkey.create:end',
    'passkey.prf:start',
    'passkey.prf:end',
    'deploy:start',
    'deploy:end',
    'directory.write:start',
    'directory.write:end',
    'activate:start',
    ...CHAIN_STEPS,
    'activate:end',
    'directory.write:start',
    'directory.write:end',
  ]);
  assertPaired(create.seen);
  assert.ok(create.seen.every((e) => e.clock === 'client' && !('error' in e)));
  // The deprecated onProgress still fires its five steps, derived from the events.
  assert.deepEqual(progress, ['passkey-created', 'deploying', 'deployed', 'activating', 'active']);

  const rotate = events();
  await created.rotateEncryptionKey(Uint8Array.of(1), { onEvent: rotate.onEvent });
  assert.deepEqual(rotate.trace(), [
    'chain.read:start',
    'chain.read:end',
    'counter.scan:start',
    'counter.scan:end',
    'passkey.sign:start',
    'passkey.sign:end',
    ...CHAIN_STEPS,
  ]);
  assertPaired(rotate.seen);
  assert.notEqual(rotate.seen[0]?.flowId, create.seen[0]?.flowId, 'each flow has its own id');

  const open = events();
  await a.createPassportAccounts(w.ports).openAccount({ onEvent: open.onEvent });
  assert.deepEqual(open.trace(), [
    'passkey.identify:start',
    'passkey.identify:end',
    'directory.read:start',
    'directory.read:end',
    'chain.read:start',
    'chain.read:end',
    'counter.scan:start',
    'counter.scan:end',
  ]);
  assertPaired(open.seen);
});

test('an error mid-deploy ends the deploy step with its error, names the wave and records nothing', async () => {
  const w = portsWorld();
  w.ports = {
    ...w.ports,
    deployer: {
      async deploy({ onEvent }) {
        const wave = (/** @type {number} */ n) => ({
          id: `w${n}`,
          flowId: '',
          step: /** @type {const} */ ('deploy.wave'),
          clock: /** @type {const} */ ('service'),
          detail: { wave: n, of: 2 },
        });
        onEvent?.({ ...wave(1), phase: 'start', at: 1 });
        onEvent?.({ ...wave(1), phase: 'end', at: 2, durationMs: 1 });
        onEvent?.({ ...wave(2), phase: 'start', at: 3 });
        const refused = new a.PassportConnectorError('SponsorRejected', 'budget spent', {
          retryable: true,
        });
        onEvent?.({
          ...wave(2),
          phase: 'error',
          at: 4,
          durationMs: 1,
          error: { code: refused.code, message: refused.message },
        });
        throw refused;
      },
    },
  };
  const e = events();
  await assert.rejects(
    a
      .createPassportAccounts(w.ports)
      .createAccount({ userName: 'u', retireAuthority: true, onEvent: e.onEvent }),
    { code: 'SponsorRejected', step: 'deploy.wave', retryable: true, message: 'budget spent' },
  );
  assert.deepEqual(e.trace().slice(4), [
    'deploy:start',
    'deploy.wave:start',
    'deploy.wave:end',
    'deploy.wave:start',
    'deploy.wave:error',
    'deploy:error',
  ]);
  assertPaired(e.seen);
  assert.deepEqual(e.seen.at(-1)?.error, { code: 'SponsorRejected', message: 'budget spent' });
  assert.equal(e.seen.find((x) => x.step === 'deploy.wave')?.clock, 'service');
  assert.equal(w.hints.size, 0, 'nothing recorded');
});

test('an abort between steps stops the flow with Aborted, which is retryable', async () => {
  const w = portsWorld();
  const controller = new AbortController();
  const e = events();
  await assert.rejects(
    a.createPassportAccounts(w.ports).createAccount({
      userName: 'u',
      retireAuthority: true,
      signal: controller.signal,
      onEvent: (/** @type {PassportEvent} */ event) => {
        e.onEvent(event);
        if (event.step === 'passkey.prf' && event.phase === 'end') controller.abort();
      },
    }),
    (/** @type {{ code: string; retryable: boolean; step?: string }} */ err) => {
      assert.ok(err instanceof a.PassportConnectorError);
      assert.deepEqual([err.code, err.retryable, err.step], ['Aborted', true, undefined]);
      return true;
    },
  );
  assert.equal(e.trace().at(-1), 'passkey.prf:end', 'the deploy never started');
  assert.ok(!w.log.some((l) => l[0] === 'deploy'));
  assertPaired(e.seen);

  // Aborted before the flow starts: no prompt at all.
  await assert.rejects(
    a.createPassportAccounts(w.ports).openAccount({ signal: AbortSignal.abort() }),
    { code: 'Aborted' },
  );
  assert.ok(!w.log.some((l) => l[0] === 'get'));
});

test('an abort during the deploy still records the deployed account, and stops before activation', async () => {
  const w = portsWorld();
  const controller = new AbortController();
  const deploy = w.ports.deployer.deploy;
  /** @type {unknown} */
  let signalSeen;
  w.ports = {
    ...w.ports,
    deployer: {
      async deploy(request) {
        signalSeen = request.signal;
        controller.abort(); // too late: this deployer had already submitted
        return deploy(request);
      },
    },
  };
  const e = events();
  await assert.rejects(
    a.createPassportAccounts(w.ports).createAccount({
      userName: 'u',
      retireAuthority: true,
      signal: controller.signal,
      onEvent: e.onEvent,
    }),
    { code: 'Aborted', retryable: true },
  );
  assert.equal(signalSeen, controller.signal, 'the deployer was handed the signal');
  assert.deepEqual(e.trace().slice(-4), [
    'deploy:start',
    'deploy:end',
    'directory.write:start',
    'directory.write:end',
  ]);
  assert.deepEqual(
    [...w.hints.values()].map((h) => [h.status, h.salt?.length]),
    [['deployed', 32]],
    'the salt is recorded, so openAccount can finish the account',
  );
  assert.ok(!w.log.some((l) => l[1] === 'activate_initial_device_with_p256'));
  const opened = await a.createPassportAccounts(w.ports).openAccount();
  assert.equal((await opened.state()).booted, true);
  assert.equal(w.hints.values().next().value?.status, 'active');
});

test('a failure inside the chain call names the step the chain reported, with the retry flag', async () => {
  const w = portsWorld();
  const created = await a
    .createPassportAccounts(w.ports)
    .createAccount({ userName: 'u', retireAuthority: true });
  const chain = typeof w.ports.chain === 'function' ? await w.ports.chain() : w.ports.chain;
  /** @type {Chain} */
  const failing = {
    readAccount: (address) => chain.readAccount(address),
    async call({ onEvent }) {
      const base = {
        id: 'p',
        flowId: '',
        step: /** @type {const} */ ('prove'),
        clock: /** @type {const} */ ('client'),
      };
      onEvent?.({ ...base, phase: 'start', at: 1 });
      onEvent?.({
        ...base,
        phase: 'error',
        at: 2,
        durationMs: 1,
        error: { code: 'ProverUnavailable', message: 'busy' },
      });
      throw new a.PassportConnectorError('ProverUnavailable', 'busy');
    },
  };
  w.ports = { ...w.ports, chain: failing };
  const reopened = await a.createPassportAccounts(w.ports).openAccount();
  assert.equal(reopened.address, created.address);
  const e = events();
  await assert.rejects(reopened.rotateEncryptionKey(Uint8Array.of(9), { onEvent: e.onEvent }), {
    code: 'ProverUnavailable',
    step: 'prove',
    retryable: true,
  });
  assertPaired(e.seen);

  // A core step that fails names itself; a thrown non-Error is InternalError, not retryable.
  w.ports = {
    ...w.ports,
    authoriser: {
      ...w.ports.authoriser,
      authorise: async () => {
        throw 'pad lost';
      },
    },
  };
  const signing = events();
  const again = await a.createPassportAccounts(w.ports).openAccount();
  await assert.rejects(again.rotateEncryptionKey(Uint8Array.of(9), { onEvent: signing.onEvent }), {
    code: 'InternalError',
    step: 'passkey.sign',
    retryable: false,
    message: 'pad lost',
  });
  assert.deepEqual(signing.seen.at(-1)?.error, { code: 'InternalError', message: 'pad lost' });
  assertPaired(signing.seen);
});

test('a listener that throws never fails the flow', async () => {
  const w = portsWorld();
  const created = await a.createPassportAccounts(w.ports).createAccount({
    userName: 'u',
    retireAuthority: true,
    onEvent: () => {
      throw new Error('listener bug');
    },
  });
  assert.equal(typeof created.address, 'string');
});

test('lace-platform errors arrive under their v1 codes; anything else is InternalError', () => {
  /** @type {[unknown, string, boolean][]} */
  const cases = [
    [{ code: 'ceremony-cancelled', message: 'closed' }, 'UserCancelled', true],
    [
      Object.assign(new Error('no prf'), { code: 'prf-unsupported' }),
      'UnsupportedAuthenticator',
      false,
    ],
    [{ code: 'account-contract-missing' }, 'AccountNotFound', false],
    [{ code: 'encryption-key-mismatch' }, 'EncryptionKeyMismatch', false],
    [{ code: 'sponsor-exhausted' }, 'SponsorRejected', false],
    [{ code: 'proof-server' }, 'ProverUnavailable', true],
    [
      Object.assign(new Error('other'), { name: 'PasskeyCredentialMismatchError' }),
      'WrongPasskey',
      true,
    ],
    [{ code: 'some-new-lace-code' }, 'InternalError', false],
    [Object.assign(new Error('refused'), { code: 'ECONNREFUSED' }), 'InternalError', false],
    [{ code: 'UserCancelled' }, 'InternalError', false],
  ];
  for (const [thrown, code, retryable] of cases) {
    const e = a.toPassportError(thrown, 'prove');
    assert.deepEqual([e.code, e.retryable, e.step, e.cause], [code, retryable, 'prove', thrown]);
  }
  assert.equal(
    a.toPassportError({ code: 'ceremony-cancelled', message: 'closed' }).message,
    'closed',
  );
});

// ---- The account API v1: retireAuthority from the caller, and the open-time enc_key check

test('the account API v1: its version and binding, and the account names its arm', async () => {
  const w = portsWorld();
  const accounts = a.createPassportAccounts(w.ports);
  assert.deepEqual(
    [accounts.apiVersion, accounts.networkId, accounts.bindingId],
    ['1.0.0-pre.0', 'undeployed', 'acc-test'],
  );
  const created = await accounts.createAccount({ userName: 'u', retireAuthority: true });
  assert.equal(created.scheme, 'p256-webauthn');
});

test('retireAuthority reaches the deployer as the caller chose it, and is never defaulted', async () => {
  for (const retireAuthority of [false, true]) {
    const w = portsWorld();
    await a.createPassportAccounts(w.ports).createAccount({ userName: 'u', retireAuthority });
    assert.deepEqual(w.log.find((l) => l[0] === 'deploy')?.slice(0, 2), [
      'deploy',
      retireAuthority,
    ]);
  }
  const w = portsWorld();
  for (const retireAuthority of [undefined, 'yes', 1]) {
    await assert.rejects(
      a.createPassportAccounts(w.ports).createAccount({ userName: 'u', retireAuthority }),
      { code: 'InternalError', message: /retireAuthority must be a boolean/ },
    );
  }
  assert.equal(w.log.length, 0, 'refused before any prompt');
});

test("open compares the derived encryption key with the ledger's while no gated call has run", async () => {
  const w = portsWorld();
  await a.createPassportAccounts(w.ports).createAccount({ userName: 'u', retireAuthority: true });
  const e = events();
  await a.createPassportAccounts(w.ports).openAccount({ onEvent: e.onEvent });
  assert.deepEqual(e.trace().slice(-2), ['passkey.prf:start', 'passkey.prf:end']);

  // The ledger's key is not the one this passkey derives on this network.
  w.ledger.encKey = new Uint8Array(32).fill(1);
  const mismatch = events();
  await assert.rejects(
    a.createPassportAccounts(w.ports).openAccount({ onEvent: mismatch.onEvent }),
    { code: 'EncryptionKeyMismatch', retryable: false, message: /does not derive/ },
  );
  assertPaired(mismatch.seen);
});

test('open skips the enc_key check once a gated call may have rotated the key, or the ledger cannot say', async () => {
  const w = portsWorld();
  const created = await a
    .createPassportAccounts(w.ports)
    .createAccount({ userName: 'u', retireAuthority: true });
  /** @param {string} why */
  const opensWithoutPrf = async (why) => {
    const e = events();
    await a.createPassportAccounts(w.ports).openAccount({ onEvent: e.onEvent });
    assert.ok(!e.trace().includes('passkey.prf:start'), why);
  };
  // A rotation to a key the passkey does not derive: auth_nonce is past 0.
  await created.rotateEncryptionKey(Uint8Array.of(42));
  await opensWithoutPrf('rotated');
  // A spec_version whose rules this release does not know, at auth_nonce 0.
  w.ledger.authNonce = 0n;
  w.ledger.specVersion = 3;
  await opensWithoutPrf('unknown spec_version');
  // A reader that does not report enc_key.
  w.ledger.specVersion = 2;
  w.ledger.encKey = undefined;
  await opensWithoutPrf('no enc_key');
});
