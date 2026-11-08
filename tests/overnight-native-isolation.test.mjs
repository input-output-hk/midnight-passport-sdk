import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, readFileSync, existsSync, symlinkSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  claimIsolationLease,
  releaseIsolationLease,
  saveIsolationReceipt,
} from '../scripts/qualification/native-isolation-files.mjs';
import {
  isolationProfile,
  admitIsolationProfile,
  isolationDigest,
  isolationEnvironment,
  assertIsolationOverrides,
} from '../scripts/qualification/native-isolation-profile.mjs';
import { isolatedStack, isolatedImages } from '../scripts/qualification/native-isolated-stack.mjs';
import { runNativeHostJobs } from '../scripts/qualification/live-host-jobs.mjs';
import { hostJobExecution } from '../scripts/qualification/native-host-job-execution.mjs';
import {
  isolationDeadline,
  isolatedProcesses,
} from '../scripts/qualification/native-isolation-control.mjs';
import { fakeIsolationDocker } from './fixtures/overnight-native-isolation.mjs';
const profile = isolationProfile('123456789abcdef0', '/private/qualification-owned-new');
function setup() {
  const fake = fakeIsolationDocker(profile);
  let saves = 0,
    aborted = false;
  const stack = isolatedStack(
    profile,
    fake.command,
    () => {
      saves++;
    },
    () => assert.equal(aborted, false),
  );
  return {
    fake,
    stack,
    saves: () => saves,
    abort: () => {
      aborted = true;
    },
  };
}
test('isolated lifecycle model is closed, canonical and immutable', () => {
  assert.deepEqual(admitIsolationProfile(JSON.parse(JSON.stringify(profile))), profile);
  assert.equal(isolationDigest(profile), isolationDigest(admitIsolationProfile({ ...profile })));
  assert.ok(
    Object.isFrozen(profile) &&
      Object.isFrozen(profile.endpoints) &&
      Object.isFrozen(profile.service),
  );
  /** @type {Array<(value:{schema:number,kind?:string,runId:string,project:string,outputRoot:string,endpoints:{nodeUrl:string,indexerUrl:string,indexerWsUrl:string,proverUrl:string},service:{port:number,host:string},extra?:boolean})=>void>} */
  const edits = [
    (value) => {
      value.schema = 2;
    },
    (value) => {
      value.extra = true;
    },
    (value) => {
      delete value.kind;
    },
    (value) => {
      value.runId = '../retained';
    },
    (value) => {
      value.project = 'mn-passport-qual-20261023';
    },
    (value) => {
      value.endpoints.nodeUrl = 'http://127.0.0.1:19954';
    },
    (value) => {
      value.endpoints.indexerUrl = 'http://localhost:18108/api/v4/graphql';
    },
    (value) => {
      value.endpoints.indexerWsUrl = 'ws://127.0.0.1:18098/api/v4/graphql/ws';
    },
    (value) => {
      value.endpoints.proverUrl = 'http://127.0.0.1:16310';
    },
    (value) => {
      value.service.port = 18797;
    },
    (value) => {
      value.service.host = '0.0.0.0';
    },
    (value) => {
      value.outputRoot = '/private/../qualification';
    },
  ];
  for (const edit of edits) {
    const changed = JSON.parse(JSON.stringify(profile));
    edit(changed);
    assert.throws(() => admitIsolationProfile(changed));
  }
  const env = isolationEnvironment(profile);
  assert.equal(env.PASSPORT_SERVICE_PORT, '18798');
  assert.equal(env.MN_NODE_URL, profile.endpoints.nodeUrl);
  assert.equal(env.PASSPORT_NATIVE_ISOLATION_FILE, profile.outputRoot + '/isolation.json');
  assertIsolationOverrides(env);
  for (const name of [
    'NODE_OPTIONS',
    'NODE_PATH',
    'DYLD_LIBRARY_PATH',
    'LD_PRELOAD',
    'WALLET_SEED',
    'WALLET_SEED_FILE',
    'PASSPORT_SPONSOR_SEED_FILE',
    'PASSPORT_PUBLIC_NODE_URL',
    'PASSPORT_HOST_JOB_DIR',
    'PASSPORT_NATIVE_JOB_IMAGE',
    'MN_NODE_PORT',
  ])
    assert.throws(() => assertIsolationOverrides({ ...env, [name]: 'forbidden' }));
});
test('cached immutable images and fresh resources retain identity and volumes', () => {
  const { fake, stack, saves } = setup();
  const images = isolatedImages(fake.command, 'arm64');
  assert.deepEqual(images, fake.images);
  stack.create(images);
  assert.equal(stack.inventory.containers.length, 3);
  assert.equal(stack.inventory.volumes.length, 2);
  assert.ok(saves() > 6);
  for (const c of stack.inventory.containers) stack.transition('start', c);
  const cleanup = stack.cleanup();
  assert.equal(cleanup.incomplete, false);
  assert.equal(cleanup.stopped.length, 3);
  assert.equal(fake.volumes.size, 2);
  assert.ok(
    !fake.commands.some(
      (args) => args.includes('rm') || args.includes('prune') || args.includes('--pull=always'),
    ),
  );
  const mutations = fake.commands.filter((args) => ['start', 'stop'].includes(args[0] ?? ''));
  assert.ok(
    mutations.every((args) => stack.inventory.containers.some((c) => c.id === args.at(-1))),
  );
});
test('exact recorded ID, image, endpoint, mount and network ownership is rechecked before effects', () => {
  for (const field of ['id', 'image', 'port', 'mount', 'network', 'environment', 'volume']) {
    const { fake, stack } = setup();
    stack.create(fake.images);
    const owned = stack.find('indexer'),
      current = fake.containers.get(owned.id);
    assert.ok(current);
    if (field === 'id') current.Id = 'f'.repeat(64);
    if (field === 'image') current.Image = 'sha256:' + 'f'.repeat(64);
    if (field === 'port')
      current.HostConfig.PortBindings['8088/tcp'] = [{ HostIp: '127.0.0.1', HostPort: '18098' }];
    if (field === 'mount') {
      const mount = current.Mounts[0];
      assert.ok(mount);
      mount.Name = 'retained-private-data';
    }
    if (field === 'network')
      Object.defineProperty(fake.network.Containers, 'unowned', { value: {}, enumerable: true });
    if (field === 'environment')
      current.Config.Env.push('APP__INFRA__NODE__URL=ws://retained:9944');
    if (field === 'volume') {
      const volume = fake.volumes.values().next().value;
      assert.ok(volume);
      volume.CreatedAt = 'different';
    }
    const before = fake.commands.filter((args) => args[0] === 'start').length;
    assert.throws(() => stack.transition('start', owned));
    assert.equal(fake.commands.filter((args) => args[0] === 'start').length, before);
  }
});
test('aborted start, unowned control and unknown partial Docker creation cannot be promoted to clean', () => {
  const a = setup();
  a.stack.create(a.fake.images);
  a.abort();
  assert.throws(() => a.stack.transition('start', a.stack.find('node')));
  assert.throws(() => a.stack.control(['start', 'retained-container']));
  assert.throws(() => a.stack.control(['kill', '--signal', 'KILL', a.stack.find('node').id]));
  const b = setup();
  b.fake.unknownCreate();
  assert.throws(() => b.stack.create(b.fake.images));
  assert.equal(b.stack.cleanup().incomplete, true);
  assert.match(b.stack.inventory.pending, /container-create/);
});
test('isolated execution binds all endpoint joins and cannot enter image or creation routes', async () => {
  const { fake, stack } = setup();
  stack.create(fake.images);
  let registered = 0;
  const context = {
    profile,
    env: isolationEnvironment(profile),
    ids: stack.inventory.containers.map((c) => c.id),
    docker: stack.control,
    check: () => {},
    remaining: (/** @type {number} */ ms) => ms,
    wait: async () => {},
    register: () => {
      registered++;
    },
    kill: () => {},
    beforeHost: async () => {},
  };
  const retained = {
    docker: () => {
      throw new Error('legacy command');
    },
    wait: async () => {},
    indexerReady: async () => false,
  };
  const execution = hostJobExecution('source', 'lifecycle', context, retained);
  assert.deepEqual(execution.endpoints, profile.endpoints);
  assert.equal(execution.serviceUrl, 'http://127.0.0.1:18798');
  assert.equal(
    execution.containers('retained', () => {
      throw new Error('legacy ownership');
    }).ids.length,
    3,
  );
  assert.throws(() => hostJobExecution('image', 'lifecycle', context, retained));
  assert.throws(() => hostJobExecution('source', 'creation', context, retained));
  assert.equal(registered, 0);
});
test('one absolute work deadline clamps stages and never resets on a new arm', async () => {
  let now = 0;
  const deadline = isolationDeadline(0, () => now);
  assert.equal(deadline.remaining(30 * 60000), 30 * 60000);
  now = 159 * 60000;
  assert.equal(deadline.remaining(30 * 60000), 60000);
  now = 160 * 60000;
  assert.throws(deadline.check);
  await assert.rejects(deadline.aborted);
  assert.equal(deadline.cleanupRemaining(), 15 * 60000);
  now = 175 * 60000;
  assert.equal(deadline.cleanupRemaining(), 0);
  deadline.clear();
});
test('owned detached process cleanup escalates and never signals a closed or unregistered group', async () => {
  const child = spawn(
    process.execPath,
    ['-e', "process.on('SIGTERM',()=>{});process.stdout.write('ready');setInterval(()=>{},1000)"],
    { detached: true, stdio: ['ignore', 'pipe', 'ignore'] },
  );
  /** @type {Array<{pid:number,signal:NodeJS.Signals}>} */ const sent = [];
  const processes = isolatedProcesses((pid, signal) => {
    sent.push({ pid, signal });
    process.kill(pid, signal);
  });
  processes.register(child);
  assert.ok(child.stdout);
  await once(child.stdout, 'data');
  try {
    const cleanup = await processes.stop(7000);
    assert.equal(cleanup.incomplete, false);
    assert.deepEqual(
      sent.map((item) => item.signal),
      ['SIGTERM', 'SIGKILL'],
    );
    assert.ok(sent.every((item) => item.pid === -Number(child.pid)));
    processes.send(child, 'SIGKILL');
    assert.equal(sent.length, 2);
  } finally {
    if (child.pid && child.exitCode === null && child.signalCode === null)
      process.kill(-child.pid, 'SIGKILL');
  }
});

test('fresh resource collisions and every unknown creation retain evidence without adopting resources', () => {
  for (const type of ['network', 'volume', 'ps']) {
    const { fake, stack } = setup();
    fake.collide(type);
    assert.throws(() => stack.create(fake.images));
    assert.equal(
      fake.commands.filter((args) => args[0] === 'create' || args[1] === 'create').length,
      0,
    );
  }
  for (const phase of ['network', 'volume', 'node', 'indexer', 'proof-server']) {
    const { fake, stack } = setup();
    fake.unknownCreate(phase);
    assert.throws(() => stack.create(fake.images));
    assert.notEqual(stack.inventory.pending, '');
    assert.equal(stack.cleanup().incomplete, true);
    assert.ok(!fake.commands.some((args) => args[0] === 'rm' || args.includes('prune')));
  }
});
test('stable lease refuses overlap, stale ownership, symlinks and unresolved cleanup', () => {
  const root = mkdtempSync(join(tmpdir(), 'passport-native-lease-test-')),
    path = join(root, 'stable.lock');
  const owner = { runId: profile.runId, pid: process.pid, project: profile.project, root };
  try {
    claimIsolationLease(path, owner);
    const before = readFileSync(path, 'utf8');
    assert.throws(() => claimIsolationLease(path, { ...owner, runId: 'f'.repeat(16) }));
    assert.throws(() => releaseIsolationLease(path, owner, false));
    assert.throws(() => releaseIsolationLease(path, { ...owner, pid: owner.pid + 1 }, true));
    assert.equal(readFileSync(path, 'utf8'), before);
    releaseIsolationLease(path, owner, true);
    assert.equal(existsSync(path), false);
    const target = join(root, 'retained.lock');
    claimIsolationLease(target, owner);
    symlinkSync(target, path);
    assert.throws(() => releaseIsolationLease(path, owner, true));
    assert.equal(readFileSync(target, 'utf8'), before);
    saveIsolationReceipt(join(root, 'receipt.private.json'), {
      verdict: 'FAIL',
      original: 'retained',
    });
    saveIsolationReceipt(join(root, 'receipt.private.json'), {
      verdict: 'FAIL',
      original: 'retained',
      cleanup: false,
    });
    assert.deepEqual(JSON.parse(readFileSync(join(root, 'receipt.private.json'), 'utf8')), {
      verdict: 'FAIL',
      original: 'retained',
      cleanup: false,
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
test('late continuations cannot control Docker or spawn after finalization latches', async () => {
  const { fake, stack, abort } = setup();
  stack.create(fake.images);
  const pending = Promise.resolve().then(() => stack.control(['start', stack.find('node').id]));
  abort();
  await assert.rejects(pending);
  assert.ok(!fake.commands.some((args) => args[0] === 'start'));
  const registry = isolatedProcesses(() => {
    throw new Error('unowned signal');
  });
  await registry.stop(1);
  assert.throws(registry.check);
});

test('inner host-job admission consumes the canonical supplied route environment before Docker', async () => {
  const scratch = mkdtempSync(join(tmpdir(), 'passport-native-route-test-'));
  const absentContract = join(scratch, 'missing-contract');
  let commands = 0;
  const context = {
    profile,
    env: {
      ...isolationEnvironment(profile),
      IN_NIX_SHELL: '1',
      PASSPORT_RC_LOCALNET: '1',
      MN_NETWORK_ID: 'undeployed',
      PASSPORT_LIVE_ROOT: profile.outputRoot,
      PASSPORT_CONTRACT_DIR: absentContract,
    },
    ids: ['4'.repeat(64), '5'.repeat(64), '6'.repeat(64)],
    docker: () => {
      commands++;
      throw new Error('No Docker during admission');
    },
    check: () => {},
    remaining: (/** @type {number} */ ms) => ms,
    wait: async () => {},
    register: () => {},
    kill: () => {},
    beforeHost: async () => {},
  };
  try {
    await assert.rejects(runNativeHostJobs('source', 'lifecycle', context), {
      code: 'ENOENT',
      path: absentContract,
    });
    assert.equal(commands, 0);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});
