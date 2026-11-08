// Source-lifecycle-only owned Docker resources. No command runs until explicitly called.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { assertNativeContainer } from './native-container-shape.mjs';
import {
  isolationObject,
  admitIsolationProfile,
  ISOLATED_PORTS,
} from './native-isolation-profile.mjs';
/** @typedef {import('./native-container-shape.mjs').NativeRole} NativeRole */
/** @typedef {{service:NativeRole,image:string,id:string}} OwnedContainer */
/** @typedef {(args:string[])=>string} DockerCommand */
/** @type {readonly {service:NativeRole,tag:string}[]} */
export const ISOLATED_IMAGES = Object.freeze([
  { service: 'node', tag: 'midnightntwrk/midnight-node:2.1.0-rc.4' },
  { service: 'indexer', tag: 'ghcr.io/midnightntwrk/indexer-standalone:4.4.0-rc.6-b5e6c809' },
  { service: 'proof-server', tag: 'midnightntwrk/proof-server:9.0.0-rc.8' },
]);
/** @param {string} encoded */
function inspected(encoded) {
  const result = JSON.parse(encoded);
  assert.ok(Array.isArray(result) && result.length === 1);
  return isolationObject(result[0]);
}
/** @param {DockerCommand} docker @param {string} arch */
export function isolatedImages(docker, arch) {
  assert.ok(['arm64', 'amd64'].includes(arch));
  return ISOLATED_IMAGES.map(({ service, tag }) => {
    const image = inspected(docker(['image', 'inspect', tag]));
    assert.match(String(image.Id), /^sha256:[a-f0-9]{64}$/);
    assert.equal(image.Os, 'linux');
    assert.equal(image.Architecture, arch);
    assert.ok(service === 'node' || service === 'indexer' || service === 'proof-server');
    return { service, tag, id: String(image.Id), arch };
  });
}
/** @param {import('./native-isolation-profile.mjs').IsolationProfile} profile
 * @param {NativeRole} service @param {string} image */
export function isolatedContainerArguments(profile, service, image) {
  const p = admitIsolationProfile(profile),
    port =
      service === 'node'
        ? ISOLATED_PORTS.node
        : service === 'indexer'
          ? ISOLATED_PORTS.indexer
          : ISOLATED_PORTS.prover;
  const inner = service === 'node' ? 9944 : service === 'indexer' ? 8088 : 6300;
  const args = [
    'create',
    '--pull',
    'never',
    '--name',
    `${p.project}-${service}`,
    '--label',
    `passport.native.project=${p.project}`,
    '--label',
    `passport.native.service=${service}`,
    '--network',
    p.project,
    '--network-alias',
    service,
    '--cap-drop',
    'ALL',
    '-p',
    `127.0.0.1:${port}:${inner}`,
  ];
  if (service !== 'proof-server') args.push('-v', `${p.project}-${service}-data:/data`);
  if (service === 'node')
    args.push(
      '--cap-add',
      'CHOWN',
      '--cap-add',
      'DAC_OVERRIDE',
      '--cap-add',
      'FOWNER',
      '-e',
      'CFG_PRESET=dev',
      '-e',
      'SIDECHAIN_BLOCK_BENEFICIARY=04bcf7ad3be7a5c790460be82a713af570f22e0f801f6659ab8e84a52be6969e',
    );
  if (service === 'indexer')
    args.push(
      '-e',
      'APP__INFRA__NODE__URL=ws://node:9944',
      '-e',
      'APP__INFRA__SPO_NODE__URL=ws://node:9944',
      '-e',
      'APP__APPLICATION__NETWORK_ID=undeployed',
      '-e',
      'APP__INFRA__SPO_NODE__BLOCKFROST_ID=dummy-not-using-spo',
      '-e',
      `APP__INFRA__SECRET=${randomBytes(32).toString('hex')}`,
    );
  args.push(image);
  return args;
}
/** All IDs are captured once at creation; names never confer control authority.
 * @param {import('./native-isolation-profile.mjs').IsolationProfile} profile
 * @param {DockerCommand} docker @param {()=>void} save @param {()=>void} check */
export function isolatedStack(profile, docker, save, check) {
  const p = admitIsolationProfile(profile);
  /** @type {OwnedContainer[]} */ const containers = [];
  /** @type {Array<{name:string,id:string}>} */ const volumes = [];
  const inventory = { project: p.project, containers, volumes, networkId: '', pending: '' };
  /** @param {OwnedContainer} owned @param {boolean} [running] */
  const inspect = (owned, running) => {
    const current = inspected(docker(['inspect', owned.id]));
    const state = isolationObject(current.State);
    assert.equal(typeof state.Running, 'boolean');
    assertNativeContainer(current, {
      ...owned,
      project: p.project,
      labelPrefix: 'passport.native',
      port:
        owned.service === 'node'
          ? ISOLATED_PORTS.node
          : owned.service === 'indexer'
            ? ISOLATED_PORTS.indexer
            : ISOLATED_PORTS.prover,
      running: running ?? Boolean(state.Running),
      strictEnvironment: true,
      networkId: inventory.networkId,
    });
    return current;
  };
  const infrastructure = () => {
    if (inventory.networkId) {
      const n = inspected(docker(['network', 'inspect', inventory.networkId]));
      assert.equal(n.Id, inventory.networkId);
      assert.equal(n.Name, p.project);
      assert.equal(isolationObject(n.Labels)['passport.native.project'], p.project);
      const attached = Object.keys(isolationObject(n.Containers));
      assert.ok(
        attached.every((id) => containers.some((c) => c.id === id)),
        'Unowned network attachment',
      );
    }
    for (const volume of volumes) {
      const v = inspected(docker(['volume', 'inspect', volume.name]));
      assert.equal(v.Name, volume.name);
      assert.equal(v.CreatedAt, volume.id);
      assert.equal(isolationObject(v.Labels)['passport.native.project'], p.project);
    }
  };
  /** @param {NativeRole} role */
  const find = (role) => {
    const value = containers.find((c) => c.service === role);
    assert.ok(value);
    return value;
  };
  /** @param {'start'|'stop'} action @param {OwnedContainer} owned */
  const transition = (action, owned) => {
    if (action === 'start') check();
    infrastructure();
    const current = inspect(owned);
    if (isolationObject(current.State).Running === (action === 'start')) return;
    docker(action === 'stop' ? ['stop', '--time', '20', owned.id] : ['start', owned.id]);
    inspect(owned, action === 'start');
    save();
  };
  /** @param {ReturnType<typeof isolatedImages>} images */
  const create = (images) =>
    createStackResources(p, docker, save, check, inventory, inspect, infrastructure, images);
  /** Only source-runner inspection/start/stop commands are admitted. @param {string[]} args */
  const control = (args) => {
    check();
    const action = args[0];
    if (action === 'inspect') {
      const ids = args.slice(1);
      assert.ok(ids.length > 0);
      for (const id of ids) {
        const owned = containers.find((c) => c.id === id);
        assert.ok(owned);
        inspect(owned);
      }
      return docker(args);
    }
    assert.ok(
      action === 'stop' || action === 'start',
      'Isolated source lane refuses other Docker operations',
    );
    const id = args.at(-1),
      owned = containers.find((c) => c.id === id);
    assert.ok(owned);
    transition(action, owned);
    return owned.id;
  };
  const cleanup = () => {
    /** @type {string[]} */ const stopped = [];
    let incomplete = inventory.pending !== '';
    for (const owned of [...containers].reverse()) {
      try {
        transition('stop', owned);
        stopped.push(owned.id);
      } catch {
        incomplete = true;
      }
    }
    try {
      infrastructure();
    } catch {
      incomplete = true;
    }
    return { stopped, incomplete, retainedVolumes: true, unrelatedResourcesControlled: 0 };
  };
  return { inventory, create, inspect, infrastructure, control, find, transition, cleanup };
}

/** @param {import('./native-isolation-profile.mjs').IsolationProfile} p
 * @param {DockerCommand} docker @param {()=>void} save @param {()=>void} check
 * @param {{project:string,containers:OwnedContainer[],volumes:{name:string,id:string}[],networkId:string,pending:string}} inventory
 * @param {(owned:OwnedContainer,running?:boolean)=>Record<string,unknown>} inspect
 * @param {()=>void} infrastructure @param {ReturnType<typeof isolatedImages>} images */
function createStackResources(p, docker, save, check, inventory, inspect, infrastructure, images) {
  check();
  assert.deepEqual(
    images.map((image) => image.service),
    ['node', 'indexer', 'proof-server'],
  );
  for (const image of images) assert.match(image.id, /^sha256:[a-f0-9]{64}$/);
  for (const [type, name] of [
    ['network', p.project],
    ...['node', 'indexer'].map((role) => ['volume', `${p.project}-${role}-data`]),
  ]) {
    assert.ok(type && name);
    assert.equal(
      docker([type, 'ls', '--filter', `name=^${name}$`, '--format', '{{.Name}}']).trim(),
      '',
      'Fresh resource already exists',
    );
  }
  for (const image of images)
    assert.equal(
      docker([
        'ps',
        '-a',
        '--filter',
        `name=^/${p.project}-${image.service}$`,
        '--format',
        '{{.ID}}',
      ]).trim(),
      '',
    );
  check();
  inventory.pending = 'network-create';
  save();
  inventory.networkId = docker([
    'network',
    'create',
    '--label',
    `passport.native.project=${p.project}`,
    p.project,
  ]).trim();
  assert.match(inventory.networkId, /^[a-f0-9]{64}$/);
  inventory.pending = '';
  save();
  for (const role of ['node', 'indexer']) {
    check();
    const name = `${p.project}-${role}-data`;
    inventory.pending = 'volume-create:' + name;
    save();
    docker(['volume', 'create', '--label', `passport.native.project=${p.project}`, name]);
    const v = inspected(docker(['volume', 'inspect', name]));
    assert.equal(typeof v.CreatedAt, 'string');
    inventory.volumes.push({ name, id: String(v.CreatedAt) });
    inventory.pending = '';
    save();
  }
  for (const image of images) {
    check();
    inventory.pending = 'container-create:' + image.service;
    save();
    const id = docker(isolatedContainerArguments(p, image.service, image.id)).trim();
    assert.match(id, /^[a-f0-9]{64}$/);
    const owned = { service: image.service, image: image.id, id };
    inventory.containers.push(owned);
    inventory.pending = '';
    save();
    inspect(owned, false);
  }
  infrastructure();
}
