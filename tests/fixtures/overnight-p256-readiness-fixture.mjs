// Actual WebAuthn/ES256, key recipes and generated challenges; synthetic chain only.
import assert from 'node:assert/strict';
import { createPassportAccounts } from '../../packages/account/dist/index.js';
import { PassportConnectorError } from '../../packages/account/dist/errors.js';
import { isP256, isSealedP256 } from '../../packages/account/dist/p256-device.js';
import { createFakePorts } from '../../packages/account/dist/testing/index.js';
import { webauthnPasskey } from '../../packages/adapter-webauthn/dist/index.js';
import { recipeDeviceKeyring } from '../../packages/keys/dist/index.js';
import { pureCircuits } from '../../packages/contract/generated/acc-s3r1.1/index.js';
import { softwareAuthenticator, ORIGIN, RP } from './software-authenticator.mjs';

/** @typedef {import('../../packages/account/dist/ports/index.js').PassportPorts} Ports */
/** @typedef {import('../../packages/account/dist/ports/index.js').CallRequest} Call */
/** @typedef {import('../../packages/account/dist/p256-readiness-types.js').P256ReadinessHost} Host */

/** @param {ReturnType<typeof webauthnPasskey>} selected
 * @param {string[]} trace
 * @param {import('../../packages/account/dist/ports/index.js').FlowDescriptor[]} sessions
 * @param {{signature:string}} fault
 */
function readinessAuthoriser(selected, trace, sessions, fault) {
  /** @type {Ports['authoriser']} */
  const authoriser = {
    ...selected.p256,
    async withKeySession(work, descriptor) {
      assert.equal(this, authoriser);
      if (descriptor) sessions.push(descriptor);
      trace.push(`session:${descriptor?.kind}`);
      assert.ok(selected.p256.withKeySession);
      return selected.p256.withKeySession(work, descriptor);
    },
    async authorise(request) {
      assert.equal(this, authoriser);
      trace.push(`sign:${request.useCounter}:${request.authNonce}`);
      const signed = await selected.p256.authorise(request);
      assert.equal(signed.scheme, 'p256-webauthn');
      if (fault.signature === 'counter') return { ...signed, useCounter: signed.useCounter + 1n };
      if (fault.signature === 'key') return { ...signed, pk: { x: 1n, y: 2n } };
      return signed;
    },
  };
  return authoriser;
}

export function readinessFixture() {
  const fake = createFakePorts({ binding: { pureCircuits } });
  const auth = softwareAuthenticator({ atCreate: 'results' });
  /** @type {string[]} */ const trace = [];
  /** @type {Call[]} */ const calls = [];
  /** @type {import('../../packages/account/dist/ports/index.js').FlowDescriptor[]} */ const sessions =
    [];
  /** @type {import('../../packages/account/dist/ports/index.js').AccountKeys[]} */ const materials =
    [];
  /** @type {import('../../packages/protocol/dist/index.js').PassportEvent[]} */ const events = [];
  const fault = { boundary: '', signature: '', abortDeploy: false, directoryFailures: 0 };
  const controller = new AbortController();
  const unknown = new PassportConnectorError(
    'MutationUnsettled',
    'original readiness call is unknown',
  );
  const selected = webauthnPasskey({
    rpId: RP,
    origin: ORIGIN,
    credentials: auth.container,
    beforeCeremony: ({ purpose }) => {
      trace.push(`ceremony:${purpose}`);
    },
  });
  const authoriser = readinessAuthoriser(selected, trace, sessions, fault);
  const originalKeyring = recipeDeviceKeyring(selected.prf);
  /** @type {NonNullable<Ports['viewingKey']>} */
  const viewingKey = {
    ...originalKeyring,
    async createKeys(network, request) {
      assert.equal(this, viewingKey);
      trace.push('material');
      const keys = await originalKeyring.createKeys(network, request);
      materials.push(keys);
      return keys;
    },
    async openInbox(network, ring, entries) {
      assert.equal(this, viewingKey);
      trace.push(`authenticate:${entries.length}`);
      return originalKeyring.openInbox(network, ring, entries);
    },
  };
  /** @type {NonNullable<Ports['directory']>} */
  const directory = {
    async get(network, key) {
      assert.equal(this, directory);
      trace.push('directory:get');
      return fake.directory.get(network, key);
    },
    async put(network, record) {
      assert.equal(this, directory);
      trace.push(`directory:${record.status}`);
      if (fault.directoryFailures-- > 0) throw new Error('registry unavailable');
      return fake.directory.put(network, record);
    },
  };
  /** @type {Ports['chain'] & import('../../packages/account/dist/ports/index.js').Chain} */
  const chain = {
    async readAccount(address, options) {
      assert.equal(this, chain);
      trace.push('read');
      return fake.chain.readAccount(address, options);
    },
    async call(request) {
      assert.equal(this, chain);
      calls.push(request);
      const index = calls.filter((call) => call.circuit === 'append_inbox_with_p256').length;
      const boundary =
        request.circuit === 'activate_initial_device_with_p256' ? 'activate' : `append${index}`;
      trace.push(`call:${boundary}`);
      if (fault.boundary === `${boundary}:before`) throw unknown;
      const receipt = await fake.chain.call(request);
      if (fault.boundary === `${boundary}:after`) throw unknown;
      return receipt;
    },
  };
  /** @type {Ports} */
  const ports = {
    ...fake,
    credentials: selected.credentials,
    authoriser,
    viewingKey,
    directory,
    chain,
    deployer: {
      async deploy(request) {
        trace.push('deploy');
        const receipt = await fake.deployer.deploy(request);
        if (fault.abortDeploy) controller.abort('after acknowledged deploy');
        return receipt;
      },
    },
    records: {
      ...fake.records,
      async write(record) {
        trace.push('record:write');
        return fake.records.write(record);
      },
    },
  };
  const options = {
    signal: controller.signal,
    onEvent: (/** @type {typeof events[number]} */ event) => events.push(event),
  };
  const create = () =>
    createPassportAccounts(ports).createAccount({
      userName: 'readiness',
      retireAuthority: true,
      ...options,
    });
  const hint = () => {
    const record = [...fake.directory.hints.values()][0];
    assert.ok(record && isP256(record) && isSealedP256(record));
    return record;
  };
  const ledger = () => {
    const value = [...fake.ledger.values()][0];
    assert.ok(value);
    return value;
  };
  return {
    fake,
    auth,
    selected,
    trace,
    calls,
    sessions,
    materials,
    events,
    fault,
    controller,
    unknown,
    ports,
    authoriser,
    viewingKey,
    directory,
    chain,
    options,
    create,
    hint,
    ledger,
  };
}

/** Internal host tests inject time without changing public ports or global timers.
 * @param {ReturnType<typeof readinessFixture>} fixture
 * @returns {Host & { sleeps: number[] }}
 */
export function readinessHost(fixture) {
  const { ports } = fixture;
  /** @type {number[]} */ const sleeps = [];
  return {
    ports,
    authoriser: ports.authoriser,
    credentials: ports.credentials,
    directory: ports.directory,
    encryptionKey: ports.encryptionKey,
    viewingKey: ports.viewingKey,
    network: ports.network,
    networkId: ports.network.networkId,
    binding: async () => fixture.fake.binding,
    chain: async () => fixture.chain,
    readView: (flow, record) =>
      flow.step('chain.read', async () => {
        const view = await fixture.chain.readAccount(record.address, { includeInbox: true });
        assert.ok(view);
        return view;
      }),
    findCounter: (flow, record, view) =>
      flow.step('counter.scan', async () => {
        for (let counter = 0n; counter < 64n; counter++)
          if (
            view.hasEntry(
              pureCircuits.derive_device_entry_with_p256(
                { bytes: Buffer.from(record.address, 'hex') },
                { ...record.publicKey, identity: false },
                record.policy,
                view.deviceEpoch,
                counter,
              ),
            )
          )
            return counter;
        return undefined;
      }),
    notHeld: () => new PassportConnectorError('AccountNotFound', 'owner absent'),
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    sleeps,
  };
}
