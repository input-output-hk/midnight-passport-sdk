// Real software JubJub/key recipes and generated ACC execution; no native proof or provider.
import assert from 'node:assert/strict';
import { createPassportAccounts, issueJubjubGrantCall } from '../../packages/account/dist/index.js';
import { PassportConnectorError } from '../../packages/account/dist/errors.js';
import { pureCircuits } from '../../packages/contract/generated/acc-s3r1.1/index.js';
import { jubjub } from '@noble/curves/misc.js';
import { x25519 } from '@noble/curves/ed25519.js';
import { generatedGrantAccount } from './generated-grant-account.mjs';

/** @typedef {import('../../packages/account/dist/ports/index.js').Authoriser} Authoriser */
/** @typedef {import('../../packages/account/dist/ports/index.js').AccountViewingKey} Keyring */
/** @typedef {import('../../packages/account/dist/jubjub-grant-publication.js').PublishJubjubGrantPorts} Ports */

function publicationState() {
  return {
    trace: /** @type {string[]} */ ([]),
    calls: /** @type {import('../../packages/account/dist/ports/index.js').CallRequest[]} */ ([]),
    receipts: /** @type {import('../../packages/account/dist/ports/index.js').TxResult[]} */ ([]),
    signatures:
      /** @type {import('../../packages/account/dist/ports/index.js').AuthorisationRequest[]} */ ([]),
    sessions:
      /** @type {(import('../../packages/account/dist/ports/index.js').FlowDescriptor | undefined)[]} */ ([]),
    events: /** @type {import('../../packages/protocol/dist/index.js').PassportEvent[]} */ ([]),
    sleeps: /** @type {number[]} */ ([]),
    fault: { boundary: '', seals: '', signature: '', observation: '', active: true, record: false },
    marked: false,
    unknown: new PassportConnectorError(
      'MutationUnsettled',
      'original synthetic publication append unknown',
    ),
  };
}
/** @param {Authoriser} original @param {ReturnType<typeof publicationState>} state */
function publicationAuthoriser(original, state) {
  /** @type {Authoriser} */
  const authoriser = {
    ...original,
    async withKeySession(work, descriptor) {
      assert.equal(this, authoriser);
      state.sessions.push(descriptor);
      state.trace.push('session');
      assert.ok(original.withKeySession);
      return original.withKeySession(work, descriptor);
    },
    async devicePublicKey() {
      assert.equal(this, authoriser);
      state.trace.push('device');
      return original.devicePublicKey();
    },
    async authorise(request) {
      assert.equal(this, authoriser);
      state.trace.push('sign');
      state.signatures.push(request);
      const signed = await original.authorise(request);
      assert.equal(signed.scheme, 'jubjub-schnorr');
      if (state.fault.signature === 'counter')
        return { ...signed, useCounter: signed.useCounter + 1n };
      if (state.fault.signature === 'key') return { ...signed, pk: { x: 1n, y: 2n } };
      return signed;
    },
  };
  return authoriser;
}
/** @param {Keyring} original @param {ReturnType<typeof publicationState>} state */
function publicationKeyring(original, state) {
  /** @type {Keyring} */
  const keyring = {
    ...original,
    async sealGrant(...args) {
      assert.equal(this, keyring);
      state.trace.push('seal:bookkeeping');
      const seals = await original.sealGrant(...args);
      if (state.fault.seals === 'empty') return [];
      if (state.fault.seals === 'one') return seals.slice(0, 1);
      if (state.fault.seals === 'short') return [new Uint8Array(191), new Uint8Array(192)];
      return seals;
    },
    async sealView(...args) {
      assert.equal(this, keyring);
      state.trace.push('seal:read');
      assert.ok(original.sealView);
      return original.sealView(...args);
    },
    async openInbox(...args) {
      assert.equal(this, keyring);
      state.trace.push(`open:${args[2].length}`);
      return original.openInbox(...args);
    },
  };
  return keyring;
}

/** @param {import('../../packages/account/dist/ports/index.js').Chain} original @param {ReturnType<typeof publicationState>} state */
function publicationChain(original, state) {
  /** @type {import('../../packages/account/dist/ports/index.js').Chain} */
  const chain = {
    async readAccount(...args) {
      assert.equal(this, chain);
      state.trace.push('read');
      const view = await original.readAccount(...args);
      if (!view || !state.calls.length) return view;
      const last = state.calls.at(-1);
      if (state.fault.observation === 'entry-only')
        return { ...view, authNonce: state.signatures.at(-1)?.authNonce ?? view.authNonce };
      const sent = last?.args[0];
      if (state.fault.observation === 'nonce-only' && sent instanceof Uint8Array)
        return {
          ...view,
          inboxEntries:
            view.inboxEntries?.filter((entry) => !Buffer.from(entry).equals(sent)) ?? [],
        };
      return view;
    },
    async call(request) {
      assert.equal(this, chain);
      const index = state.calls.push(request);
      state.trace.push(`append:${index}`);
      if (state.fault.boundary === `${index}:before`) throw state.unknown;
      const receipt = await original.call(request);
      state.receipts.push(receipt);
      if (state.fault.boundary === `${index}:after`) throw state.unknown;
      return receipt;
    },
  };
  return chain;
}

/** Build a new staged third grant without publishing it. @param {boolean} [read] */
export async function jubjubPublicationFixture(read = false) {
  const base = await generatedGrantAccount('jubjub');
  const initial = base.initial;
  assert.ok(
    initial.records &&
      initial.grants &&
      initial.directory &&
      initial.viewingKey &&
      initial.grantJournal &&
      initial.grantCommitments,
  );
  const identity = await initial.credentials.identify();
  const hint = await initial.directory.get(initial.network.networkId, {
    kind: 'credential-id',
    credentialId: identity.credentialId,
  });
  assert.ok(hint);
  const account = await createPassportAccounts(initial).openAccount();
  assert.ok(account.rotateViewingKey);
  const rotate = account.rotateViewingKey.bind(account);
  const scope = {
    grantee: {
      scheme: /** @type {const} */ ('jubjub-schnorr'),
      publicKey: Buffer.from(
        jubjub.Point.fromAffine(pureCircuits.compute_public_point_with_jubjub(17n)).toBytes(),
      ).toString('hex'),
    },
    operations: /** @type {'withdraw-unshielded'[]} */ (['withdraw-unshielded']),
    color: '34'.repeat(32),
    recipient: { kind: /** @type {const} */ ('any') },
    maxCoinValue: '100',
    perCallCap: '10',
    cap: '100',
    expiresAt: null,
    ...(read && {
      read: true,
      rpId: 'localhost',
      readPublicKey: Buffer.from(x25519.getPublicKey(new Uint8Array(32).fill(23))).toString('hex'),
    }),
  };
  const issued = await issueJubjubGrantCall(
    { hint, origin: 'localhost', scope },
    {
      bindingId: 'acc-s3r1.1',
      pure: pureCircuits,
      chain: base.chain,
      authoriser: initial.authoriser,
      records: initial.records,
      grants: initial.grants,
      journal: initial.grantJournal,
      rotateBeforeIssue: () => rotate(),
    },
  );
  const state = publicationState();
  const authoriser = publicationAuthoriser(initial.authoriser, state);
  const viewingKey = publicationKeyring(initial.viewingKey, state);
  const chain = publicationChain(base.chain, state);
  const records = initial.records,
    journal = initial.grantJournal,
    commitments = initial.grantCommitments;
  /** @type {Ports} */
  const ports = {
    bindingId: 'acc-s3r1.1',
    networkId: initial.network.networkId,
    pure: pureCircuits,
    authoriser,
    viewingKey,
    chain,
    random: (length) => new Uint8Array(length).fill(7),
    attempts: 3,
    sleep: async (ms) => {
      state.sleeps.push(ms);
    },
    records: {
      async exists() {
        state.trace.push('record:exists');
        return records.exists();
      },
      async read() {
        state.trace.push('record:read');
        return records.read();
      },
      async write(record) {
        state.trace.push('record:write');
        if (state.fault.record) throw state.unknown;
        return records.write(record);
      },
    },
    grants: {
      async readActiveGrantIds() {
        state.trace.push('active');
        return state.fault.active
          ? ((await initial.grants?.readActiveGrantSnapshot(hint.address))?.ids ?? [])
          : [];
      },
    },
    commitments: {
      async readGrantCommitment(...args) {
        state.trace.push('commitment');
        return commitments.readGrantCommitment(...args);
      },
    },
    journal: {
      stage: journal.stage,
      async load(...args) {
        state.trace.push('load');
        return journal.load(...args);
      },
      async markPublished(...args) {
        state.trace.push('mark');
        await journal.markPublished(...args);
        state.marked = true;
      },
    },
  };
  const controller = new AbortController();
  const input = {
    hint,
    grantId: issued.grantId,
    signal: controller.signal,
    onEvent: (/** @type {typeof state.events[number]} */ event) => state.events.push(event),
  };
  return {
    base,
    ports,
    authoriser,
    viewingKey,
    chain,
    input,
    controller,
    issued,
    ...state,
    marked: () => state.marked,
  };
}
