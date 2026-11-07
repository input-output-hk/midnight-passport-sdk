// Phase contracts use actual ACC pure helpers and synthetic custody/chain/signature ports.
// Existing account-jubjub tests additionally exercise public connector wiring and real key recipes.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { jubjub } from '@noble/curves/misc.js';
import { pureCircuits as pure } from '../packages/contract/generated/acc-s3r1.1/index.js';
import { createJubjubViewingRotation } from '../packages/account/dist/jubjub-viewing-rotation.js';
import { PassportConnectorError } from '../packages/account/dist/errors.js';
import { startFlow } from '../packages/account/dist/flow.js';
import { createPassportAccounts } from '../packages/account/dist/index.js';

const account = '12'.repeat(32);
const grantId = 'af'.repeat(32);
const survivorGrantId = 'bf'.repeat(32);
const hex = (/** @type {Uint8Array} */ value) => Buffer.from(value).toString('hex');
function entry(/** @type {number} */ kind, /** @type {number} */ id) {
  const value = new Uint8Array(192);
  value[0] = kind;
  value[1] = 1;
  value[2] = id;
  return value;
}

/** @param {'rotate'|'remove'|'enroll'|'revoke'|'revoke-all'} [kind] */
function fixture(kind = 'rotate') {
  const trace = /** @type {string[]} */ ([]);
  const dispatched =
    /** @type {import('../packages/account/dist/ports/index.js').CallRequest[]} */ ([]);
  const sessions =
    /** @type {Array<import('../packages/account/dist/ports/index.js').FlowDescriptor|undefined>} */ ([]);
  const events = /** @type {import('../packages/protocol/dist/index.js').PassportEvent[]} */ ([]);
  const owner = pure.compute_public_point_with_jubjub(7n);
  const remote = pure.compute_public_point_with_jubjub(9n);
  const ownerHex = hex(jubjub.Point.fromAffine(owner).toBytes());
  const remoteHex = hex(jubjub.Point.fromAffine(remote).toBytes());
  const remoteEntry = pure.derive_device_entry_with_jubjub(
    { bytes: Buffer.from(account, 'hex') },
    remote,
    0n,
    0n,
  );
  const ownerRegistration = entry(0xd2, 1);
  const coin = entry(0xc1, 1);
  const inbox = /** @type {Uint8Array[]} */ ([ownerRegistration, coin]);
  const remoteEntries = kind === 'remove' ? [remoteEntry] : [];
  if (kind === 'remove') inbox.push(entry(0xd2, 2));
  let counter = 0n,
    nonce = 0n,
    key = new Uint8Array(32).fill(3),
    active = true;
  let appendCount = 0;
  let dropDuplicate = false,
    addDuplicate = false,
    duplicateRoster = false,
    lockAfterSwitch = false,
    locked = false;
  /** @type {PassportConnectorError | undefined} */
  let switchFailure;
  let failPublication = false;
  let failAfterObservation = false;
  let noHoldings = false;
  let publicMode = false;
  const targets =
    kind === 'revoke' || kind === 'revoke-all'
      ? [
          { grantId, readPublicKey: 'aa'.repeat(32) },
          { grantId: survivorGrantId, readPublicKey: 'bb'.repeat(32) },
        ]
      : [];
  const controller = new AbortController();
  const options = {
    signal: controller.signal,
    onEvent: (/** @type {import('../packages/protocol/dist/index.js').PassportEvent} */ event) =>
      events.push(event),
  };
  /** @type {import('../packages/account/dist/flow.js').Flow | undefined} */
  let usedFlow;
  const snapshot = () => {
    const own = pure.derive_device_entry_with_jubjub(
      { bytes: Buffer.from(account, 'hex') },
      owner,
      0n,
      counter,
    );
    const devices = [own, ...remoteEntries, ...(duplicateRoster ? remoteEntries : [])];
    return {
      booted: true,
      authNonce: nonce,
      deviceEpoch: 0n,
      entryCount: devices.length,
      specVersion: 3,
      encKey: key,
      inboxEntries: [...inbox],
      deviceEntries: devices,
      hasEntry: (/** @type {Uint8Array} */ candidate) =>
        devices.some((value) => hex(value) === hex(candidate)),
    };
  };
  /** @type {import('../packages/account/dist/jubjub-rotation-types.js').JubjubHint} */
  const record = {
    address: account,
    scheme: 'jubjub-schnorr',
    credentialId: Uint8Array.of(1),
    publicKey: owner,
    status: 'active',
  };
  /** @type {import('../packages/account/dist/ports/index.js').AccountViewingKey} */
  const viewingKey = {
    decodeDevicePublicKey: (value) =>
      value === ownerHex ? owner : value === remoteHex ? remote : undefined,
    readerPublicKey: async () => new Uint8Array(32).fill(1),
    async createKeys(_network, request) {
      trace.push('prepare-keys');
      assert.equal(request.rotateRoster, kind === 'remove' || kind === 'enroll' ? true : undefined);
      if (kind === 'remove') assert.equal(request.removed?.devicePublicKey, remoteHex);
      return {
        encKey: new Uint8Array(32).fill(8),
        envelopes: [entry(0xd1, 4)],
        registrations: [entry(0xd2, 3)],
      };
    },
    sealToDevice: async () => {
      throw Error('Unexpected separate delivery');
    },
    async openInbox(_network, keyring, entries) {
      return entries.map((value) => {
        if (value[0] === 0xd2)
          return {
            kind: 'device',
            device: {
              readerPublicKey: (value[2] === 2 ? '02' : '01').repeat(32),
              devicePublicKey: value[2] === 2 ? remoteHex : ownerHex,
            },
          };
        if (value[0] === 0xc1)
          return {
            kind: 'coin',
            coin: { nonce: new Uint8Array(32), color: new Uint8Array(32), value: 1n },
          };
        if (value[0] === 0xd3)
          return {
            kind: 'grant',
            record: {
              part: 'view',
              grantId: survivorGrantId,
              encKeyPrefix: hex(keyring.encKey).slice(0, 6),
              seal: '09'.repeat(94),
            },
          };
        return null;
      });
    },
    sealGrant: async () => {
      throw Error('Unexpected grant issue');
    },
    async reencryptInbox(_network, _rotation, entries) {
      trace.push('prepare-holdings');
      return entries.map((_value, index) => entry(0xc1, index + 5));
    },
    async sealView(_network, _keyring, request) {
      trace.push(`seal:${request.grantId}`);
      assert.equal(request.grantId, survivorGrantId);
      return { seal: new Uint8Array(94).fill(9), entry: entry(0xd3, 9) };
    },
  };
  /** @type {import('../packages/account/dist/jubjub-rotation-types.js').JubjubRotationContext} */
  const context = {
    ports: {
      network: {
        networkId: 'undeployed',
        bindingId: 'acc-s3r1.1',
        manifestSha256: '00'.repeat(32),
        indexerUrl: '',
        indexerWsUrl: '',
        nodeUrl: '',
        artefactUrl: '',
      },
      holdings: { selectHeldEntries: async () => (noHoldings ? [] : [1]) },
      readGrants: {
        async readActiveReadGrantTargets() {
          trace.push('read-grants');
          return {
            authNonce: nonce,
            targets: targets.filter((target) => active || target.grantId !== grantId),
          };
        },
      },
      records: {
        exists: async () => true,
        read: async () => ({
          address: account,
          bindingId: 'acc-s3r1.1',
          scheme: 'jubjub-schnorr',
          credentialId: record.credentialId,
          localUseCounter: counter,
        }),
        write: async () => {
          trace.push('record-counter');
        },
      },
      grantDetails: { readGrant: async () => ({ active, read: true, authNonce: nonce }) },
    },
    authoriser: {
      scheme: 'jubjub-schnorr',
      devicePublicKey: async () => owner,
      async authorise(request) {
        if (locked) throw Error('Owner locked');
        trace.push(`sign:${request.circuit}`);
        assert.equal(request.account, account);
        assert.equal(request.useCounter, counter);
        assert.equal(request.authNonce, nonce);
        assert.equal(typeof request.challenge, 'function');
        if (typeof request.challenge === 'function')
          assert.equal(request.challenge(owner, 0n).length, 32);
        return {
          scheme: 'jubjub-schnorr',
          pk: owner,
          useCounter: counter,
          sigR: owner,
          sigS: 1n,
          grindNonce: 0n,
        };
      },
    },
    viewingKey,
    async withOwnerSession(work, descriptor) {
      sessions.push(descriptor);
      return work();
    },
    ownerPublicKeyHex: async () => ownerHex,
    resolveBinding: async () => ({ binding: { pureCircuits: pure }, pure }),
    revocationPure: async () => pure,
    async read() {
      trace.push('read');
      return snapshot();
    },
    chain: async () => ({
      readAccount: async () => snapshot(),
      async call(request) {
        if (!publicMode) assert.ok(usedFlow);
        assert.equal(request.signal, options.signal);
        if (usedFlow) assert.equal(request.onEvent, usedFlow.ports.onEvent);
        dispatched.push(request);
        trace.push(`call:${request.circuit}`);
        assert.equal(request.args[2], counter);
        if (request.circuit === 'rotate_enc_key_with_jubjub') {
          assert.ok(request.args[0] instanceof Uint8Array);
          key = Uint8Array.from(request.args[0]);
          if (lockAfterSwitch) locked = true;
        } else if (request.circuit === 'append_inbox_with_jubjub') {
          assert.ok(request.args[0] instanceof Uint8Array);
          inbox.push(request.args[0]);
        } else if (request.circuit === 'remove_device_with_jubjub') remoteEntries.length = 0;
        else if (request.circuit === 'revoke_grant_with_jubjub') active = false;
        counter++;
        nonce++;
        if (switchFailure) throw switchFailure;
        return { txHash: `original:${request.circuit}` };
      },
    }),
    findCounter: () => counter,
    keyring: async () => {
      trace.push('authenticate-keyring');
    },
    async append(flow, _record, value) {
      assert.equal(flow, usedFlow);
      flow.checkpoint();
      trace.push(value[0] === 0xc1 ? 'append-holding' : 'append-key-material');
      if (failPublication)
        throw new PassportConnectorError('MutationUnsettled', 'original append request is unknown');
      if (failAfterObservation && value[0] === 0xc1)
        throw new PassportConnectorError(
          'MutationUnsettled',
          'original holding request is unknown',
        );
      inbox.push(value);
      counter++;
      nonce++;
      appendCount++;
      if (appendCount === 1 && dropDuplicate) inbox.splice(1, 1);
      if (appendCount === 1 && addDuplicate) inbox.push(ownerRegistration);
      return snapshot();
    },
    async advanced() {
      trace.push('observe');
      return snapshot();
    },
    async completeEnrollment(flow, _record, _pure, _view, _reader, joining, grants) {
      assert.equal(flow, usedFlow);
      trace.push('complete-enrollment');
      assert.deepEqual(grants, targets);
      return {
        txHash: 'original:enrollment',
        commitmentHex: hex(joining),
        nextUseCounter: counter + 1n,
      };
    },
    conflictsWithReader: () => false,
    async run(input, work) {
      trace.push('run');
      usedFlow = startFlow(input, (length) => new Uint8Array(length).fill(3));
      try {
        return await work(usedFlow);
      } catch (error) {
        throw usedFlow.fail(error);
      }
    },
    random: (length) => new Uint8Array(length).fill(7),
    sleep: async () => {},
  };
  const rotate = createJubjubViewingRotation(context);
  const invoke = (existing = false, inOwnerSession = false) => {
    const initial = snapshot();
    const enrollment =
      kind === 'enroll'
        ? {
            reader: { readerPublicKey: '03'.repeat(32), devicePublicKey: remoteHex },
            entry: remoteEntry,
            initial,
            grants: targets,
          }
        : undefined;
    if (existing) usedFlow = startFlow(options, (length) => new Uint8Array(length).fill(5));
    return rotate(
      record,
      options,
      kind === 'remove' ? hex(remoteEntry) : undefined,
      enrollment,
      existing ? usedFlow : undefined,
      kind === 'revoke' ? grantId : undefined,
      kind === 'revoke-all',
      inOwnerSession,
    );
  };
  return {
    context,
    invoke,
    trace,
    dispatched,
    sessions,
    events,
    controller,
    snapshot,
    failPublication() {
      failPublication = true;
    },
    failAfterObservation() {
      failAfterObservation = true;
    },
    unknownSwitch(/** @type {PassportConnectorError} */ error) {
      switchFailure = error;
    },
    lockAfterSwitch() {
      lockAfterSwitch = true;
      noHoldings = true;
    },
    duplicateInbox() {
      inbox.push(coin);
    },
    loseDuplicate() {
      dropDuplicate = true;
    },
    gainDuplicate() {
      addDuplicate = true;
    },
    duplicateRoster() {
      duplicateRoster = true;
    },
    async publicAccount() {
      publicMode = true;
      const authoriser = {
        ...context.authoriser,
        withKeySession: context.withOwnerSession,
        devicePublicKeyHex: context.ownerPublicKeyHex,
      };
      const chain = await context.chain();
      const api = createPassportAccounts({
        ...context.ports,
        authoriser,
        viewingKey,
        binding: { pureCircuits: pure },
        chain,
        credentials: {
          create: async () => {
            throw Error('Unexpected creation');
          },
          identify: async () => ({ credentialId: record.credentialId, owns: () => true }),
        },
        directory: { get: async () => record, put: async () => {} },
        encryptionKey: { publicKey: async () => key },
        deployer: {
          deploy: async () => {
            throw Error('Unexpected deployment');
          },
        },
        random: context.random,
      });
      return { account: await api.openAccount(options), authoriser, options };
    },
  };
}

test('public connector uses a host owner wrapper replaced after account opening, with its original receiver', async () => {
  const f = fixture();
  const host = await f.publicAccount();
  let sessions = 0,
    keyReads = 0;
  const read = host.authoriser.devicePublicKeyHex;
  host.authoriser.withKeySession = async function (work, descriptor) {
    assert.equal(this, host.authoriser);
    assert.equal(descriptor?.kind, 'rotate-encryption-key');
    sessions++;
    return work();
  };
  host.authoriser.devicePublicKeyHex = async function () {
    assert.equal(this, host.authoriser);
    keyReads++;
    return read();
  };
  assert.ok(host.account.rotateViewingKey);
  await host.account.rotateViewingKey(host.options);
  assert.equal(sessions, 1);
  assert.equal(keyReads, 1);
});

for (const kind of /** @type {const} */ (['rotate', 'remove', 'enroll', 'revoke', 'revoke-all'])) {
  test(`JubJub ${kind} publishes and rechecks before switching, observes before holdings and authority completion`, async () => {
    const f = fixture(kind);
    const result = await f.invoke();
    const switched = f.trace.indexOf('call:rotate_enc_key_with_jubjub');
    const lastPublication = f.trace.lastIndexOf('append-key-material');
    const observed = f.trace.indexOf('observe');
    const holding = f.trace.indexOf('append-holding');
    assert.ok(lastPublication >= 0 && lastPublication < switched);
    assert.ok(f.trace.slice(lastPublication + 1, switched).includes('read'));
    assert.ok(f.trace.slice(lastPublication + 1, switched).includes('read-grants'));
    assert.ok(switched < observed && observed < holding);
    assert.equal(f.sessions.length, 1);
    const phase = f.sessions[0];
    assert.equal(
      phase?.kind,
      {
        rotate: 'rotate-encryption-key',
        remove: 'remove-device',
        enroll: 'add-device',
        revoke: 'revoke-grant',
        'revoke-all': 'revoke-all-grants',
      }[kind],
    );
    assert.ok(result.txHash.startsWith('original:'));
    if (kind === 'enroll') assert.ok(holding < f.trace.indexOf('complete-enrollment'));
    if (kind === 'remove' || kind === 'revoke') {
      const circuit = kind === 'remove' ? 'remove_device_with_jubjub' : 'revoke_grant_with_jubjub';
      assert.ok(holding < f.trace.indexOf(`call:${circuit}`));
      assert.equal(result.txHash, `original:${circuit}`);
    }
    if (kind === 'revoke')
      assert.deepEqual(
        f.trace.filter((value) => value.startsWith('seal:')),
        [`seal:${survivorGrantId}`],
      );
    if (kind === 'revoke-all')
      assert.deepEqual(
        f.trace.filter((value) => value.startsWith('seal:')),
        [],
      );
    assert.ok(new Set(f.events.map((event) => event.flowId)).size === 1);
  });
}

test('existing flow and owner scope are reused without new wrappers or sessions', async () => {
  const f = fixture();
  await f.invoke(true, true);
  assert.equal(f.trace.includes('run'), false);
  assert.equal(f.sessions.length, 0);
  assert.equal(new Set(f.events.map((event) => event.flowId)).size, 1);
});

test('duplicate ciphertext occurrences are retained, and losing or adding one refuses the key switch', async () => {
  const valid = fixture();
  valid.duplicateInbox();
  await valid.invoke();
  for (const change of ['lost', 'added']) {
    const f = fixture();
    f.duplicateInbox();
    if (change === 'lost') f.loseDuplicate();
    else f.gainDuplicate();
    await assert.rejects(f.invoke(), {
      code: 'InternalError',
      message:
        change === 'lost'
          ? 'The ACC inbox lost an expected entry.'
          : 'The ACC inbox changed during rotation.',
    });
    assert.equal(f.dispatched.length, 0);
  }
});

test('duplicate live device commitments refuse before fresh keys or chain submission', async () => {
  const f = fixture('remove');
  f.duplicateRoster();
  await assert.rejects(f.invoke(), /duplicate live device entry/);
  assert.equal(f.trace.includes('prepare-keys'), false);
  assert.equal(f.dispatched.length, 0);
});

test('publication failure preserves the unknown request and prevents switch or authority completion', async () => {
  const f = fixture('enroll');
  f.failPublication();
  await assert.rejects(f.invoke(), {
    code: 'MutationUnsettled',
    message: 'original append request is unknown',
  });
  assert.equal(f.dispatched.length, 0);
  assert.equal(f.trace.includes('complete-enrollment'), false);
  assert.equal(f.trace.filter((value) => value === 'append-key-material').length, 1);
});

test('unknown switch retains the original transport error and never repeats or completes the mutation', async () => {
  const f = fixture('remove');
  const unknown = new PassportConnectorError(
    'MutationUnsettled',
    'original request 012345 is unknown',
  );
  f.unknownSwitch(unknown);
  await assert.rejects(f.invoke(), (error) => error === unknown);
  assert.equal(f.dispatched.length, 1);
  assert.equal(f.dispatched[0]?.circuit, 'rotate_enc_key_with_jubjub');
  assert.equal(f.trace.includes('observe'), false);
  assert.equal(f.trace.includes('append-holding'), false);
});

test('failure after key observation stops before final authority mutation and retains the original failure', async () => {
  const f = fixture('remove');
  f.failAfterObservation();
  await assert.rejects(f.invoke(), {
    code: 'MutationUnsettled',
    message: 'original holding request is unknown',
  });
  assert.equal(f.dispatched.length, 1);
  assert.equal(f.trace.includes('observe'), true);
  assert.equal(f.trace.includes('call:remove_device_with_jubjub'), false);
});

test('a late successful switch acknowledgement survives local owner lock', async () => {
  const f = fixture();
  f.lockAfterSwitch();
  const result = await f.invoke();
  assert.equal(result.txHash, 'original:rotate_enc_key_with_jubjub');
  assert.equal(f.dispatched.length, 1);
});

test('abort at the final switch signature checkpoint prevents a new chain dispatch', async () => {
  const f = fixture();
  const sign = f.context.authoriser.authorise;
  f.context.authoriser.authorise = async (request) => {
    const result = await sign(request);
    if (request.circuit === 'rotate_enc_key_with_jubjub') f.controller.abort();
    return result;
  };
  await assert.rejects(f.invoke(), { code: 'Aborted' });
  assert.equal(f.dispatched.length, 0);
});
