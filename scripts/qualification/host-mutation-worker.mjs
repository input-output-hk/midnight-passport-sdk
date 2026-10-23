// Synthetic remote transport crash worker. No node, provider account or wallet state.
import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import {
  createHostMutationExecutor,
  encryptedHostMutationStore,
} from '../../packages/service/dist/index.js';
const [root = '', arm = 'p256', retire = 'true', fault = 'none', mode = 'execute'] =
  process.argv.slice(2);
if (!root || !['p256', 'jubjub'].includes(arm) || !['true', 'false'].includes(retire))
  throw new Error('Invalid worker arguments.');
await mkdir(root, { mode: 0o700, recursive: true });
const path = join(root, 'transport.json');
/** @type {any} */ let world;
try {
  world = JSON.parse(await readFile(path, 'utf8'));
} catch (/** @type {any} */ e) {
  if (e.code !== 'ENOENT') throw e;
  world = { events: [], plans: 0, prepared: 0, sent: [], counter: 0 };
}
const save = async () => {
  await writeFile(path + '.tmp', JSON.stringify(world), { mode: 0o600 });
  await rename(path + '.tmp', path);
};
const checkpoint = async (/** @type {string} */ label) => {
  world.events.push(label);
  await save();
  if (label === fault) process.exit(86);
};
const hash = (/** @type {string} */ text) => createHash('sha256').update(text).digest('hex');
const identity = {
  pins: {
    networkId: 'undeployed',
    bindingId: 'acc-s3r1.1',
    manifestSha256: '77fb9c17b0d59047456c43115d9a58f5cb99a226ee73b6b974fd724930c3153f',
    scheme: /** @type {'p256-webauthn'|'jubjub-schnorr'} */ (
      arm === 'p256' ? 'p256-webauthn' : 'jubjub-schnorr'
    ),
  },
  requestId: '45'.repeat(16) + ':0',
  intentSha256: '67'.repeat(32),
  kind: /** @type {const} */ ('deploy'),
};
const store = encryptedHostMutationStore(join(root, 'journal'), new Uint8Array(32).fill(9));
const traced = {
  read: store.read,
  compareAndSwap: async (
    /** @type {number|undefined} */ previous,
    /** @type {import('../../packages/service/dist/index.js').HostMutationRecord} */ record,
  ) => {
    const last = record.steps.at(-1),
      label =
        record.phase === 'preparing'
          ? 'plan-reservation'
          : record.phase === 'complete'
            ? 'complete'
            : last
              ? `step-${record.steps.length}-${last.phase}`
              : 'plan-committed';
    await checkpoint(label + ':before');
    const saved = await store.compareAndSwap(previous, record);
    await checkpoint(label + ':after');
    return saved;
  },
};
const engine = createHostMutationExecutor(traced, {
  prepare: async () => {
    await checkpoint('constructor:before');
    world.plans++;
    await save();
    const plan = {
      address: hash(randomUUID()),
      steps: 3,
      context: { syntheticAuthority: randomUUID(), arm, retireAuthority: retire === 'true' },
    };
    await checkpoint('constructor:after');
    return plan;
  },
  prepareStep: async (record, index) => {
    world.prepared++;
    await save();
    const tx = Buffer.from(
      JSON.stringify({ address: record.plan?.address, index, arm, retire, nonce: randomUUID() }),
    ).toString('hex');
    return { tx, identifiers: [hash(tx)] };
  },
  submit: async (transaction) => {
    const payload = JSON.parse(Buffer.from(transaction.tx, 'hex').toString('utf8'));
    await checkpoint(`submit-${payload.index + 1}:before`);
    if (world.sent.some((/** @type {any} */ r) => r.id === transaction.identifiers[0]))
      throw new Error('duplicate send');
    world.sent.push({
      id: transaction.identifiers[0],
      tx: transaction.tx,
      address: payload.address,
    });
    world.counter++;
    await save();
    await checkpoint(`submit-${payload.index + 1}:after`);
    return /** @type {string} */ (transaction.identifiers[0]);
  },
  lookup: async (transaction) => {
    const found = world.sent.find((/** @type {any} */ r) => r.id === transaction.identifiers[0]);
    return found
      ? { identifier: found.id, txHash: hash(found.tx + 'included'), succeeded: true }
      : undefined;
  },
  check: async (_record, index) => world.counter === index,
});
try {
  const result =
    mode === 'inspect'
      ? undefined
      : mode === 'resume'
        ? await engine.resume(identity)
        : await engine.execute(identity, { arm, retireAuthority: retire === 'true' });
  const record = await store.read(identity);
  console.log(
    JSON.stringify({
      result,
      audit: await engine.inspect(identity),
      plans: world.plans,
      sends: world.sent.length,
      planHash: record?.plan ? hash(JSON.stringify(record.plan)) : undefined,
      retireChoice: /** @type {any} */ (record?.plan?.context)?.retireAuthority,
      bytes: record?.steps.map((s) => hash(s.tx)),
    }),
  );
} finally {
  store.close();
}
