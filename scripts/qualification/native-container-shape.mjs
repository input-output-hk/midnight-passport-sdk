// Inspection admission shared by the two closed native qualification profiles.
import assert from 'node:assert/strict';
import { isolationObject } from './native-isolation-profile.mjs';
/** @typedef {'node'|'indexer'|'proof-server'} NativeRole */
/** @typedef {{project:string,labelPrefix:string,service:NativeRole,image:string,id?:string,port:number,running:boolean,strictEnvironment?:boolean,networkId?:string}} ContainerShape */
/** @param {unknown} input @param {ContainerShape} expected */
export function assertNativeContainer(input, expected) {
  const c = isolationObject(input);
  assert.equal(c.Name, `/${expected.project}-${expected.service}`);
  assert.equal(c.Image, expected.image);
  assert.match(String(c.Id), /^[a-f0-9]{64}$/);
  if (expected.id !== undefined) assert.equal(c.Id, expected.id);
  const config = isolationObject(c.Config),
    labels = isolationObject(config.Labels);
  assert.equal(labels[`${expected.labelPrefix}.project`], expected.project);
  assert.equal(labels[`${expected.labelPrefix}.service`], expected.service);
  assert.equal(isolationObject(c.State).Running, expected.running);
  const inner = expected.service === 'node' ? 9944 : expected.service === 'indexer' ? 8088 : 6300;
  const bindings = { [`${inner}/tcp`]: [{ HostIp: '127.0.0.1', HostPort: String(expected.port) }] };
  assert.deepEqual(isolationObject(c.HostConfig).PortBindings, bindings);
  const network = isolationObject(c.NetworkSettings);
  if (expected.running) assert.deepEqual(network.Ports, bindings);
  const networks = isolationObject(network.Networks);
  assert.deepEqual(Object.keys(networks), [expected.project]);
  if (expected.running) assert.ok(isolationObject(networks[expected.project]).IPAddress);
  if (expected.networkId !== undefined) {
    const id = isolationObject(networks[expected.project]).NetworkID;
    if (expected.running) assert.equal(id, expected.networkId);
    else assert.ok(id === '' || id === expected.networkId);
    assert.equal(isolationObject(c.HostConfig).NetworkMode, expected.project);
  }
  const mounts =
    expected.service === 'proof-server'
      ? []
      : [
          {
            Type: 'volume',
            Name: `${expected.project}-${expected.service}-data`,
            Destination: '/data',
          },
        ];
  assert.ok(Array.isArray(c.Mounts));
  assert.equal(c.Mounts.length, mounts.length);
  for (const [i, mount] of mounts.entries()) {
    const current = isolationObject(c.Mounts[i]);
    for (const [key, value] of Object.entries(mount)) assert.equal(current[key], value);
    if (expected.strictEnvironment) assert.equal(current.RW, true);
  }
  if (expected.strictEnvironment) assertContainerEnvironment(config, expected.service);
  return String(c.Id);
}
/** @param {Record<string,unknown>} config @param {NativeRole} service */
function assertContainerEnvironment(config, service) {
  if (service !== 'indexer') return;
  assert.ok(Array.isArray(config.Env));
  for (const entry of [
    'APP__INFRA__NODE__URL=ws://node:9944',
    'APP__INFRA__SPO_NODE__URL=ws://node:9944',
    'APP__APPLICATION__NETWORK_ID=undeployed',
  ])
    assert.equal(
      config.Env.filter((value) => String(value).startsWith(entry.split('=')[0] + '=')).join(),
      entry,
    );
}
