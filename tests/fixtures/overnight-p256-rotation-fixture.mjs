// Real public P-256 connector, software ES256, actual key recipes and the existing fake ledger.
import assert from 'node:assert/strict';
import { createPassportAccounts } from '../../packages/account/dist/index.js';
import { createFakePorts } from '../../packages/account/dist/testing/index.js';
import { createP256ViewingRotation } from '../../packages/account/dist/p256-viewing-rotation.js';
import { PassportConnectorError } from '../../packages/account/dist/errors.js';
import { startFlow } from '../../packages/account/dist/flow.js';
import {
  recipeDeviceKeyring,
  recipeJubjubAuthoriser,
  sealInboxCoin,
} from '../../packages/keys/dist/index.js';
import { pureCircuits as pure } from '../../packages/contract/generated/acc-s3r1.1/index.js';
import { x25519 } from '@noble/curves/ed25519.js';

export const hex = (/** @type {Uint8Array} */ value) => Buffer.from(value).toString('hex');
export const grantId = 'aa'.repeat(32);
const keyring = (value = 9) =>
  recipeDeviceKeyring({
    withSession: (work) => work(),
    deviceSecret: async () => new Uint8Array(32).fill(value),
    deriveSecret: async () => new Uint8Array(32).fill(value),
  });

export async function fixture() {
  const fake = createFakePorts({ binding: { pureCircuits: pure } });
  const baseKeyring = keyring();
  const trace = /** @type {string[]} */ ([]);
  const calls =
    /** @type {import('../../packages/account/dist/ports/index.js').CallRequest[]} */ ([]);
  const signed =
    /** @type {import('../../packages/account/dist/ports/index.js').AuthorisationRequest[]} */ ([]);
  const sessions =
    /** @type {Array<import('../../packages/account/dist/ports/index.js').FlowDescriptor|undefined>} */ ([]);
  const materials =
    /** @type {import('../../packages/account/dist/ports/index.js').AccountKeys[]} */ ([]);
  const keyRequests =
    /** @type {import('../../packages/account/dist/ports/index.js').CreateAccountKeys[]} */ ([]);
  const receipts =
    /** @type {import('../../packages/protocol/dist/index.js').PassportTxResult[]} */ ([]);
  const fault = {
    boundary: '',
    state: '',
    signature: '',
    settle: '',
    noHoldings: false,
    abort: false,
    lock: false,
    locked: false,
  };
  const unknown = new PassportConnectorError(
    'MutationUnsettled',
    'original rotation request 012345 is unknown',
    { step: 'sponsor.submit' },
  );
  let recording = false,
    switched = false,
    removed = false,
    appendCount = 0,
    sealCount = 0,
    readsAfterRemove = 0;
  const controller = new AbortController();
  const options = {
    signal: controller.signal,
    onEvent: () => {},
  };
  const ledger = () => {
    const held = [...fake.ledger.values()][0];
    assert.ok(held);
    return held;
  };
  const originalBinding = fake.authoriser.deviceBinding;
  assert.ok(originalBinding);
  /** @type {import('../../packages/account/dist/ports/index.js').Authoriser} */
  const authoriser = {
    ...fake.authoriser,
    async withKeySession(work, scope) {
      assert.equal(this, authoriser);
      if (recording) sessions.push(scope);
      return work();
    },
    async deviceBinding() {
      assert.equal(this, authoriser);
      const selected = await originalBinding.call(fake.authoriser);
      return selected;
    },
    async authorise(request) {
      if (fault.locked) throw new PassportConnectorError('NotAuthorised', 'owner locked');
      if (recording) {
        signed.push(request);
        trace.push(`sign:${request.circuit}`);
      }
      const result = await fake.authoriser.authorise(request);
      if (recording && request.circuit === 'rotate_enc_key_with_p256') {
        if (fault.abort) controller.abort();
        if (fault.signature === 'counter') return { ...result, useCounter: result.useCounter + 1n };
        if (fault.signature === 'key') return { ...result, pk: { x: 1n, y: 2n } };
        if (fault.signature === 'scheme')
          return {
            scheme: 'jubjub-schnorr',
            pk: result.pk,
            useCounter: result.useCounter,
            sigR: result.pk,
            sigS: 0n,
            grindNonce: 0n,
          };
      }
      return result;
    },
  };
  /** @type {import('../../packages/account/dist/ports/index.js').AccountViewingKey} */
  const viewingKey = {
    ...baseKeyring,
    async createKeys(network, request) {
      const keys = await baseKeyring.createKeys(network, request);
      if (recording) {
        materials.push(keys);
        keyRequests.push(request);
        trace.push('fresh-keys');
      }
      return keys;
    },
    async sealView(network, ring, request) {
      assert.ok(baseKeyring.sealView);
      const delivery = await baseKeyring.sealView(network, ring, request);
      if (recording) {
        sealCount++;
        trace.push('grant-seal');
      }
      return delivery;
    },
  };
  const expectedAppends = () => {
    const material = materials.at(-1);
    return material ? material.envelopes.length + material.registrations.length + sealCount : 0;
  };
  let target = '';
  const coin = { nonce: new Uint8Array(32).fill(4), color: new Uint8Array(32).fill(5), value: 7n };
  let coinIndex = 0;
  /** @type {import('../../packages/account/dist/ports/index.js').ActiveReadGrantTarget[]} */
  let targets = [{ grantId, readPublicKey: hex(x25519.getPublicKey(new Uint8Array(32).fill(10))) }];
  /** @type {import('../../packages/account/dist/ports/index.js').Chain} */
  const chain = {
    async readAccount(address, input = {}) {
      const view = await fake.chain.readAccount(address, input);
      if (!recording || !view) return view;
      trace.push(`read:${input.includeDevices ? 'devices' : 'inbox'}:${switched ? 'new' : 'old'}`);
      if (
        materials.length > 0 &&
        appendCount >= expectedAppends() &&
        !switched &&
        input.includeDevices &&
        fault.state
      ) {
        if (fault.state === 'key') return { ...view, encKey: new Uint8Array(32) };
        if (fault.state === 'epoch') return { ...view, deviceEpoch: view.deviceEpoch + 1n };
        if (fault.state === 'nonce') return { ...view, authNonce: view.authNonce + 1n };
        if (fault.state === 'roster')
          return { ...view, deviceEntries: [...(view.deviceEntries ?? []), new Uint8Array(32)] };
        const inbox = [...(view.inboxEntries ?? [])];
        if (fault.state === 'drop-inbox') inbox.splice(coinIndex, 1);
        if (fault.state === 'extra-inbox') {
          const duplicate = inbox[coinIndex];
          assert.ok(duplicate);
          inbox.push(duplicate);
        }
        return { ...view, inboxEntries: inbox };
      }
      if (removed && input.includeDevices) {
        readsAfterRemove++;
        if (readsAfterRemove === 1 && fault.settle === 'nonce-only')
          return {
            ...view,
            deviceEntries: [...(view.deviceEntries ?? []), Buffer.from(target, 'hex')],
          };
        if (readsAfterRemove === 1 && fault.settle === 'target-only') {
          const last = signed.at(-1);
          assert.ok(last);
          return { ...view, authNonce: last.authNonce };
        }
      }
      return view;
    },
    async call(request) {
      const holding = switched && request.circuit === 'append_inbox_with_p256';
      if (recording) {
        calls.push(request);
        trace.push(`call:${request.circuit}${holding ? ':holding' : ''}`);
      }
      const receipt = await fake.chain.call(request);
      if (!recording) return receipt;
      receipts.push(receipt);
      if (request.circuit === 'append_inbox_with_p256' && !holding) appendCount++;
      if (request.circuit === 'rotate_enc_key_with_p256') {
        switched = true;
        if (fault.lock) fault.locked = true;
      }
      if (request.circuit === 'remove_device_with_p256') removed = true;
      if (
        (fault.boundary === 'first' && appendCount === 1) ||
        (fault.boundary === 'late' && appendCount === expectedAppends()) ||
        (fault.boundary === 'switch' && request.circuit === 'rotate_enc_key_with_p256') ||
        (fault.boundary === 'holding' && holding) ||
        (fault.boundary === 'remove' && removed)
      )
        throw unknown;
      return receipt;
    },
  };
  /** @type {import('../../packages/account/dist/ports/index.js').PassportPorts} */
  const ports = {
    ...fake,
    authoriser,
    viewingKey,
    chain,
    holdings: { selectHeldEntries: async () => (fault.noHoldings ? [] : [coinIndex]) },
    readGrants: {
      async readActiveReadGrantTargets() {
        if (recording) trace.push('grant-roster');
        const latest = appendCount >= expectedAppends() && materials.length > 0;
        return {
          authNonce: ledger().authNonce + (latest && fault.state === 'grant-nonce' ? 1n : 0n),
          targets: !recording
            ? []
            : targets.map((entry) => ({
                ...entry,
                ...(latest && fault.state === 'grant-id' && { grantId: 'bb'.repeat(32) }),
                ...(latest && fault.state === 'grant-key' && { readPublicKey: 'cc'.repeat(32) }),
              })),
        };
      },
    },
  };
  const account = await createPassportAccounts(ports).createAccount({
    userName: 'owner',
    retireAuthority: true,
  });
  ledger().specVersion = 3;
  const joining = recipeJubjubAuthoriser(
    {
      withSession: (work) => work(),
      deviceSecret: async () => new Uint8Array(32).fill(11),
      deriveSecret: async () => new Uint8Array(32).fill(7),
    },
    pure,
  );
  const reader = {
    devicePublicKey: await joining.devicePublicKeyHex(),
    readerPublicKey: hex(await keyring(7).readerPublicKey('undeployed')),
  };
  assert.ok(account.addDevice);
  target = (await account.addDevice(reader)).commitmentHex;
  coinIndex = ledger().inboxEntries.length;
  const ciphertext = await sealInboxCoin(ledger().encKey, coin);
  ledger().inboxEntries.push(ciphertext, ciphertext);
  const hint = [...fake.directory.hints.values()][0];
  assert.ok(hint?.credentialId && hint.policy);
  const record = { ...hint, credentialId: hint.credentialId, policy: hint.policy };
  const scan = async (
    /** @type {import('../../packages/account/dist/ports/index.js').AccLedgerView} */ view,
  ) => {
    for (let counter = 0n; counter < 4096n; counter++)
      if (
        view.hasEntry(
          pure.derive_device_entry_with_p256(
            { bytes: Buffer.from(account.address, 'hex') },
            { ...record.publicKey, identity: false },
            record.policy,
            view.deviceEpoch,
            counter,
          ),
        )
      )
        return counter;
    return undefined;
  };
  const read = async () => {
    const view = await chain.readAccount(account.address, { includeInbox: true });
    assert.ok(view);
    return view;
  };
  /** @type {import('../../packages/account/dist/p256-rotation-types.js').P256RotationContext} */
  const context = {
    ports,
    binding: async () => fake.binding,
    chain: async () => chain,
    async run(input, body) {
      const flow = startFlow(input, fake.random);
      try {
        return await body(flow);
      } catch (error) {
        throw flow.fail(error);
      }
    },
    findCounter: async (_flow, _record, view) => scan(view),
    notHeld: () => new PassportConnectorError('AccountNotFound', 'owner no longer live'),
    sealedKeyring: async () => {},
    async appendP256(flow, _record, entry, view) {
      const counter = await scan(view);
      assert.ok(counter !== undefined);
      const request = {
        account: record.address,
        circuit: 'append_inbox_with_p256',
        args: [entry],
        witnessValues: [],
        authNonce: view.authNonce,
        useCounter: counter,
        challenge: pure.challenge_append_inbox_with_p256(
          { bytes: Buffer.from(record.address, 'hex') },
          { ...record.publicKey, identity: false },
          entry,
          view.authNonce,
        ),
        credentialId: record.credentialId,
      };
      const signature = await flow.step('passkey.sign', () => authoriser.authorise(request));
      assert.equal(signature.scheme, 'p256-webauthn');
      assert.ok('authenticatorData' in signature);
      await chain.call({
        address: record.address,
        circuit: request.circuit,
        args: [
          entry,
          {
            pk: { ...record.publicKey, identity: false },
            policy: record.policy,
            authenticator_data: signature.authenticatorData,
            sig: signature.sig,
            use_counter: counter,
          },
        ],
        ...flow.ports,
      });
      return read();
    },
    async awaitSealedView(_record, ready) {
      const view = await read();
      assert.ok(ready(view));
      return view;
    },
    random: fake.random,
    sleep: async () => {
      trace.push('sleep');
    },
  };
  const rotate = createP256ViewingRotation(context);
  recording = true;
  return {
    account,
    ports,
    authoriser,
    options,
    fault,
    unknown,
    trace,
    calls,
    signed,
    sessions,
    materials,
    keyRequests,
    receipts,
    ledger,
    target,
    readsAfterRemove: () => readsAfterRemove,
    setTargets: (/** @type {typeof targets} */ next) => {
      targets = next;
    },
    internal: (
      /** @type {string|undefined} */ removal,
      /** @type {string|undefined} */ excluded,
      /** @type {import('../../packages/account/dist/p256-rotation-types.js').RotationCallback|undefined} */ callback,
    ) => rotate(record, options, removal, excluded, callback),
  };
}
