// Fresh-process synthetic host. Executes the actual pinned contract, without proofs or funds.
// Its atomic local transport can prove not-submitted; a real remote host MUST supply its own
// durable submission receipt source. Never copy this fixture's absence rule into an adapter.
import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { createConstructorContext } from '@midnight-ntwrk/compact-runtime';
import {
  createPassportAccounts,
  createDurablePassportMutations,
  encodeMutationValue,
  decodeMutationValue,
} from '../../packages/account/dist/index.js';
import {
  createFakePorts,
  fakeAuthoriser,
  fakeCredentials,
} from '../../packages/account/dist/testing/index.js';
import {
  encryptedMutationJournal,
  recipeDeviceKeyring,
  recipeJubjubAuthoriser,
} from '../../packages/keys/dist/index.js';
import { fileMutationByteStore } from '../../packages/service/dist/index.js';
import * as binding from '../../packages/contract/generated/acc-s3r1.1/index.js';
import { AccSimulator } from './acc-simulator.mjs';

const [root = '', arm = '', operation = '', mode = 'run', crash = 'none', outcomeMode = 'known'] =
  process.argv.slice(2);
if (
  !root ||
  !['p256', 'jubjub'].includes(arm) ||
  !['create', 'rotate', 'add-device', 'remove-device'].includes(operation)
)
  throw new Error('Invalid synthetic mutation worker input.');
await mkdir(root, { recursive: true, mode: 0o700 });
const path = join(root, 'world.json'),
  id = '91'.repeat(16),
  address = 'ab'.repeat(32);
const from = (/** @type {string} */ value) => new Uint8Array(Buffer.from(value, 'hex'));
const hex = (/** @type {Uint8Array} */ value) => Buffer.from(value).toString('hex');
/** @type {any} */
let world;
try {
  world = decodeMutationValue(JSON.parse(await readFile(path, 'utf8')));
} catch (/** @type {any} */ error) {
  if (error.code !== 'ENOENT') throw error;
  world = {
    effects: [],
    events: [],
    created: 0,
    consents: [],
    sessions: [],
    record: undefined,
    hint: undefined,
  };
}
const save = async () => {
  const tmp = path + '.tmp';
  await writeFile(tmp, JSON.stringify(encodeMutationValue(world)), { mode: 0o600 });
  await rename(tmp, path);
};
const fault = async (/** @type {string} */ label) => {
  if (mode === 'prepare') return;
  world.events.push(label);
  await save();
  if (crash === label) process.exit(86);
};
const source = (value = 7) => ({
  withSession: async (/** @type {()=>Promise<any>} */ work) => work(),
  deviceSecret: async () => new Uint8Array(32).fill(value),
  deriveSecret: async (/** @type {{domain:string,context:string,length?:number}} */ p) =>
    new Uint8Array(createHash('sha256').update(`${value}|${p.domain}|${p.context}`).digest()).slice(
      0,
      p.length ?? 32,
    ),
});
const keySource = source();
const keyring = recipeDeviceKeyring(keySource);
const fake = createFakePorts();
const authoriser =
  arm === 'p256' ? fakeAuthoriser() : recipeJubjubAuthoriser(keySource, binding.pureCircuits);
const baseCredentials = fakeCredentials({ authoriser });
const credentials = {
  ...baseCredentials,
  create: async (/** @type {{name:string}} */ user) => {
    await fault('credential:before');
    world.enrolled = (world.enrolled ?? 0) + 1;
    await save();
    const result = await baseCredentials.create(user);
    await fault('credential:after');
    return result;
  },
};
const sim = new AccSimulator(binding);
sim.address = address;
sim.self = { bytes: from(address) };
sim.coin = { bytes: new Uint8Array(32).fill(2) };
const rebuild = async () => {
  const deployed = world.effects.find((/** @type {any} */ e) => e.kind === 'deploy');
  if (!deployed) return;
  const init = await sim.contract.initialState(
    createConstructorContext({}, sim.coin),
    deployed.request.boot,
    deployed.request.encKey,
    sim.recovery.pk,
    new Uint8Array(64),
    60n,
  );
  sim.state = init.currentContractState.data;
  for (const effect of world.effects)
    if (effect.kind === 'call') await sim.call(effect.request.circuit, ...effect.request.args);
};
await rebuild();
const readAccount = async () => {
  if (!sim.state) return undefined;
  const l = sim.ledger();
  const entries = [...l.devices];
  return {
    booted: l.booted,
    authNonce: l.auth_nonce,
    deviceEpoch: l.device_epoch,
    specVersion: Number(l.spec_version),
    entryCount: entries.length,
    deviceEntries: entries,
    encKey: l.enc_key,
    inboxEntries: [...l.inbox].sort(([a], [b]) => (a < b ? -1 : 1)).map(([, v]) => v),
    hasEntry: (/** @type {Uint8Array} */ e) => entries.some((v) => hex(v) === hex(e)),
  };
};
const ports = {
  ...fake,
  network: {
    ...fake.network,
    bindingId: 'acc-s3r1.1',
    manifestSha256: '77fb9c17b0d59047456c43115d9a58f5cb99a226ee73b6b974fd724930c3153f',
  },
  binding,
  credentials,
  authoriser: {
    ...authoriser,
    withKeySession: async (/** @type {()=>Promise<any>} */ work, /** @type {any} */ descriptor) => {
      world.sessions.push(descriptor);
      await save();
      return work();
    },
  },
  viewingKey: {
    ...keyring,
    createKeys: async (/** @type {any[]} */ ...args) => {
      await fault('material:before');
      world.created++;
      await save();
      const result = await /** @type {any} */ (keyring.createKeys)(...args);
      await fault('material:after');
      return result;
    },
  },
  holdings: { selectHeldEntries: async () => [] },
  readGrants: {
    readActiveReadGrantTargets: async () => ({ authNonce: sim.ledger().auth_nonce, targets: [] }),
  },
  directory: {
    get: async () => world.hint,
    put: async (/** @type {string} */ _network, /** @type {any} */ hint) => {
      world.hint = hint;
      await save();
    },
  },
  records: {
    read: async () => world.record,
    exists: async () => !!world.record,
    write: async (/** @type {any} */ record) => {
      world.record = record;
      await save();
    },
  },
  chain: {
    readAccount,
    call: async (/** @type {any} */ request) => {
      const key = request.mutation?.requestId ?? `legacy-${world.effects.length}`;
      await fault(`submit:${request.circuit}:${key}:before`);
      await sim.call(request.circuit, ...request.args);
      const result = { txHash: `synthetic-${world.effects.length}` };
      world.effects.push({
        kind: 'call',
        request: {
          address: request.address,
          circuit: request.circuit,
          args: request.args,
          mutation: request.mutation,
        },
        result,
      });
      await save();
      await fault(`submit:${request.circuit}:${key}:after`);
      return result;
    },
  },
  deployer: {
    deploy: async (/** @type {any} */ request) => {
      await fault('deploy:before');
      if (sim.state) throw new Error('duplicate deployment');
      const result = { address, txIds: ['synthetic-deploy', 'synthetic-wave', 'synthetic-retire'] };
      world.effects.push({
        kind: 'deploy',
        request: {
          boot: request.boot,
          encKey: request.encKey,
          retireAuthority: request.retireAuthority,
          firstArm: request.firstArm,
          mutation: request.mutation,
        },
        result,
      });
      await save();
      await rebuild();
      await fault('deploy:after');
      return result;
    },
  },
};
for (const method of ['sealToDevice', 'reencryptInbox', 'sealView', 'sealGrant']) {
  const original = /** @type {any} */ (keyring)[method];
  if (original)
    /** @type {any} */ (ports.viewingKey)[method] = async (/** @type {any[]} */ ...args) => {
      await fault(`material:${method}:before`);
      const result = await original(...args);
      await fault(`material:${method}:after`);
      return result;
    };
}
const survivorSource = source(13),
  survivorKeyring = recipeDeviceKeyring(survivorSource),
  survivorAuthoriser = recipeJubjubAuthoriser(survivorSource, binding.pureCircuits);
const survivor = {
  readerPublicKey: hex(await survivorKeyring.readerPublicKey('undeployed')),
  devicePublicKey: await survivorAuthoriser.devicePublicKeyHex(),
};
const readerSource = source(11),
  readerKeyring = recipeDeviceKeyring(readerSource),
  readerAuthoriser = recipeJubjubAuthoriser(readerSource, binding.pureCircuits);
const reader = {
  readerPublicKey: hex(await readerKeyring.readerPublicKey('undeployed')),
  devicePublicKey: await readerAuthoriser.devicePublicKeyHex(),
};
if (mode === 'prepare') {
  if (operation !== 'create') {
    const account = await createPassportAccounts(ports).createAccount({
      userName: 'synthetic',
      retireAuthority: true,
    });
    if (operation === 'remove-device' || operation === 'rotate') {
      if (!account.addDevice) throw new Error('missing enrolment');
      const added = await account.addDevice(reader);
      if (operation === 'remove-device') {
        world.removal = added.commitmentHex;
        await account.addDevice(survivor);
      }
    }
  }
  world.events = [];
  await save();
  process.exit(0);
}
const pins = {
  networkId: ports.network.networkId,
  bindingId: ports.network.bindingId,
  manifestSha256: ports.network.manifestSha256,
  scheme: ports.authoriser.scheme,
};
const journal = encryptedMutationJournal(
  pins,
  keySource,
  fileMutationByteStore(join(root, 'journal')),
);
const tracedJournal = {
  read: journal.read,
  compareAndSwap: async (
    /** @type {string} */ key,
    /** @type {number|undefined} */ previous,
    /** @type {any} */ next,
  ) => {
    const last = next.entries.at(-1),
      label =
        last?.effect && last.phase === 'done'
          ? `receipt:${last.effect.key}`
          : last?.name === 'viewing.createKeys' && last.phase === 'done'
            ? 'material:committed'
            : (last?.name?.startsWith('viewing.') || last?.name === 'credential.create') &&
                last.phase === 'done'
              ? `output:${last.name}:committed`
              : next.phase === 'complete'
                ? 'complete'
                : undefined;
    if (label) await fault(`${label}:before`);
    const ok = await journal.compareAndSwap(key, previous, next);
    if (label) await fault(`${label}:after`);
    return ok;
  },
};
const api = createDurablePassportMutations({
  ports,
  journal: tracedJournal,
  consent: {
    approve: async (input) => {
      world.consents.push(input);
      await save();
    },
  },
  outcomes: {
    reconcile: async (_pins, effect) => {
      if (outcomeMode === 'unknown') return { kind: 'unknown' };
      const receipt = world.effects.find(
        (/** @type {any} */ e) => e.request.mutation?.requestId === effect.key,
      );
      return receipt
        ? {
            kind: 'confirmed',
            digest: receipt.request.mutation.intentSha256,
            result: receipt.result,
          }
        : { kind: 'not-submitted', digest: effect.digest, fenced: true };
    },
  },
});
/** @type {any} */ const intent =
  operation === 'create'
    ? { kind: 'create', userName: 'synthetic', retireAuthority: true }
    : operation === 'add-device'
      ? { kind: operation, account: address, reader }
      : operation === 'remove-device'
        ? { kind: operation, account: address, commitmentHex: world.removal }
        : { kind: 'rotate', account: address };
try {
  if (mode === 'cancel') {
    console.log(JSON.stringify({ status: 'cancelled', audit: await api.cancel(id) }));
    process.exit(0);
  }
  const result = mode.startsWith('resume')
    ? await api.resume({ id, ...(mode === 'resume-cancelled' && { resumeCancelled: true }) })
    : await api.run(intent, { id });
  const view = await readAccount();
  if (!view) throw new Error('no completed ledger');
  await keyring.openInbox(
    'undeployed',
    { account: address, encKey: view.encKey, envelopes: view.inboxEntries },
    view.inboxEntries,
  );
  if (operation === 'add-device' || operation === 'rotate')
    await readerKeyring.openInbox(
      'undeployed',
      { account: address, encKey: view.encKey, envelopes: view.inboxEntries },
      view.inboxEntries,
    );
  if (operation === 'remove-device') {
    await survivorKeyring.openInbox(
      'undeployed',
      { account: address, encKey: view.encKey, envelopes: view.inboxEntries },
      view.inboxEntries,
    );
    if (view.hasEntry(from(world.removal))) throw new Error('removal not settled');
    let denied = false;
    try {
      await readerKeyring.openInbox(
        'undeployed',
        { account: address, encKey: view.encKey, envelopes: view.inboxEntries },
        view.inboxEntries,
      );
    } catch {
      denied = true;
    }
    if (!denied) throw new Error('removed reader still opens current key');
  }
  console.log(
    JSON.stringify({
      status: 'complete',
      result: encodeMutationValue(result),
      audit: await api.inspect(id),
      effects: world.effects.length,
      created: world.created,
    }),
  );
} catch (/** @type {any} */ error) {
  console.log(
    JSON.stringify({
      status: 'refused',
      code: error.code ?? 'Error',
      message: error.message,
      effects: world.effects.length,
      created: world.created,
    }),
  );
  process.exitCode = 2;
}
