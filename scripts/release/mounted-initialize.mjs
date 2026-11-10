// Root is used only to initialize fresh synthetic Linux-volume ownership.
import assert from 'node:assert/strict';
/** @param {import('./resources.mjs').ResourceOwner} owner @param {(role:string)=>string} volume @param {string} project @param {string} serviceId @param {string} token */
export function initializeMountedVolumes(owner, volume, project, serviceId, token) {
  const state = volume('service-state'),
    funding = volume('funding-state'),
    config = volume('config');
  const program =
    "const fs=require('fs');const data=JSON.parse(fs.readFileSync(0,'utf8'));for(const p of ['/data/service','/data/funding','/data/config']){fs.chownSync(p,10001,10001);fs.chmodSync(p,448)}for(const [name,value] of Object.entries(data)){const p='/data/config/'+name;fs.writeFileSync(p,value,{mode:384});fs.chownSync(p,10001,10001)}if(fs.statfsSync('/data/service').type!==0xef53)throw Error('Linux ext filesystem required');console.log('initialized');";
  const row = owner.create(
    'container',
    `${project}-initialize`,
    [
      '--platform',
      'linux/amd64',
      '--network',
      'none',
      '--user',
      '0:0',
      '--mount',
      `type=volume,src=${state},dst=/data/service,volume-nocopy`,
      '--mount',
      `type=volume,src=${funding},dst=/data/funding,volume-nocopy`,
      '--mount',
      `type=volume,src=${config},dst=/data/config,volume-nocopy`,
      '--entrypoint',
      'node',
      '-i',
      serviceId,
      '-e',
      program,
    ],
    serviceId,
  );
  const policy = [
    { color: '00'.repeat(32), maxPerRequest: '10', maxPerUtcDay: '100' },
    { color: 'ab'.repeat(32), maxPerRequest: '10', maxPerUtcDay: '100' },
  ];
  assert.equal(
    owner.start(row, {
      attach: true,
      input: JSON.stringify({
        'funding-token': token + '\n',
        'funding-assets.json': JSON.stringify(policy),
      }),
    }).status,
    0,
  );
  owner.stop(row);
}
