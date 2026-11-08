import assert from 'node:assert/strict';
import { ISOLATED_IMAGES } from '../../scripts/qualification/native-isolated-stack.mjs';
import { ISOLATED_PORTS } from '../../scripts/qualification/native-isolation-profile.mjs';
/** @param {import('../../scripts/qualification/native-isolation-profile.mjs').IsolationProfile} profile
 * @param {import('../../scripts/qualification/native-isolated-stack.mjs').OwnedContainer} owned @param {boolean} running */
export function containerFixture(profile, owned, running) {
  const inner = owned.service === 'node' ? 9944 : owned.service === 'indexer' ? 8088 : 6300;
  const port =
    owned.service === 'node'
      ? ISOLATED_PORTS.node
      : owned.service === 'indexer'
        ? ISOLATED_PORTS.indexer
        : ISOLATED_PORTS.prover;
  const ports = { [`${inner}/tcp`]: [{ HostIp: '127.0.0.1', HostPort: String(port) }] };
  return {
    Id: owned.id,
    Image: owned.image,
    Name: `/${profile.project}-${owned.service}`,
    Config: {
      Labels: {
        'passport.native.project': profile.project,
        'passport.native.service': owned.service,
      },
      Env: [
        'APP__INFRA__NODE__URL=ws://node:9944',
        'APP__INFRA__SPO_NODE__URL=ws://node:9944',
        'APP__APPLICATION__NETWORK_ID=undeployed',
      ],
    },
    State: { Running: running },
    HostConfig: { PortBindings: ports, NetworkMode: profile.project },
    NetworkSettings: {
      Ports: running ? ports : {},
      Networks: {
        [profile.project]: { IPAddress: running ? '172.30.0.2' : '', NetworkID: '9'.repeat(64) },
      },
    },
    Mounts:
      owned.service === 'proof-server'
        ? []
        : [
            {
              Type: 'volume',
              Name: `${profile.project}-${owned.service}-data`,
              Destination: '/data',
              RW: true,
            },
          ],
  };
}
/** A closed in-memory Docker substitute; never invokes Docker or opens a port.
 * @param {import('../../scripts/qualification/native-isolation-profile.mjs').IsolationProfile} profile */
export function fakeIsolationDocker(profile) {
  /** @type {string[][]} */ const commands = [];
  /** @type {Map<string,ReturnType<typeof containerFixture>>} */ const containers = new Map();
  /** @type {Map<string,{Name:string,CreatedAt:string,Labels:Record<string,string>}>} */ const volumes =
    new Map();
  const network = {
    Id: '9'.repeat(64),
    Name: profile.project,
    Labels: { 'passport.native.project': profile.project },
    Containers: {},
  };
  let networkCreated = false,
    failure = '',
    collision = '';
  const images = ISOLATED_IMAGES.map((image, index) => ({
    ...image,
    id: 'sha256:' + String(index + 1).repeat(64),
    arch: 'arm64',
  }));
  /** @param {string[]} args @param {string} flag */
  const value = (args, flag) => {
    const result = args[args.indexOf(flag) + 1];
    assert.ok(result);
    return result;
  };
  /** @param {string[]} args */
  const command = (args) => {
    commands.push([...args]);
    if (args[0] === 'image') {
      const image = images.find((image) => image.tag === args[2]);
      assert.ok(image);
      return JSON.stringify([{ Id: image.id, Os: 'linux', Architecture: 'arm64' }]);
    }
    if (args[1] === 'ls' || args[0] === 'ps')
      return collision === args[0] ? 'existing-owned-or-retained' : '';
    if (args[0] === 'network') {
      if (args[1] === 'create') {
        assert.equal(networkCreated, false);
        networkCreated = true;
        if (failure === 'network') throw new Error('unknown network creation');
        return network.Id;
      }
      return JSON.stringify([network]);
    }
    if (args[0] === 'volume') {
      const name = args.at(-1);
      assert.ok(name);
      if (args[1] === 'create') {
        volumes.set(name, {
          Name: name,
          CreatedAt: '2026-11-08T00:00:00Z',
          Labels: { 'passport.native.project': profile.project },
        });
        if (failure === 'volume') throw new Error('unknown volume creation');
        return name;
      }
      const volume = volumes.get(name);
      assert.ok(volume);
      return JSON.stringify([volume]);
    }
    if (args[0] === 'create') {
      const name = value(args, '--name'),
        image = images.find((image) => args.at(-1) === image.id);
      assert.ok(image);
      assert.equal(value(args, '--pull'), 'never');
      const id = String(images.indexOf(image) + 4).repeat(64),
        owned = { service: image.service, image: image.id, id };
      assert.equal(name, `${profile.project}-${owned.service}`);
      containers.set(id, containerFixture(profile, owned, false));
      if (failure === 'container' || failure === owned.service)
        throw new Error('simulated unknown Docker creation');
      return id;
    }
    if (args[0] === 'inspect')
      return JSON.stringify(
        args.slice(1).map((id) => {
          const c = containers.get(id);
          assert.ok(c);
          return c;
        }),
      );
    assert.ok(args[0] === 'start' || args[0] === 'stop');
    const id = args.at(-1);
    assert.ok(id);
    const c = containers.get(id);
    assert.ok(c);
    const service = images.find((image) => image.id === c.Image);
    assert.ok(service);
    containers.set(
      id,
      containerFixture(
        profile,
        { service: service.service, image: c.Image, id },
        args[0] === 'start',
      ),
    );
    return id;
  };
  return {
    command,
    commands,
    containers,
    volumes,
    network,
    images,
    unknownCreate: (phase = 'container') => {
      failure = phase;
    },
    collide: (type = 'network') => {
      collision = type;
    },
  };
}
