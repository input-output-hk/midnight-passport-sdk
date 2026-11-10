// Full source/dist/physical graph/reference/streamed keys plus Linux-volume dependency fence.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isolatedInputs } from '../qualification/native-isolation-inputs.mjs';
import { object, sha256 } from './files.mjs';

export const linuxTreeProgram =
  "const f=require('fs'),c=require('crypto'),p=require('path'),h=c.createHash('sha256');let files=0,links=0;function walk(d,r=''){for(const n of f.readdirSync(d).sort()){const a=p.join(d,n),b=p.join(r,n),s=f.lstatSync(a);if(s.isDirectory())walk(a,b);else if(s.isSymbolicLink()){links++;h.update('L'+b+'\\0'+f.readlinkSync(a)+'\\n')}else if(s.isFile()){files++;h.update('F'+b+'\\0'+c.createHash('sha256').update(f.readFileSync(a)).digest('hex')+'\\n')}else throw Error('unexpected dependency entry')}}walk('/deps');console.log(JSON.stringify({sha256:h.digest('hex'),files,links}));";
/** @param {string} repository @param {ReturnType<import('./mounted-plan.mjs').mountedPlan>} plan @param {import('./resources.mjs').ResourceOwner} owner @param {string} image @param {()=>void} check */
export function mountedCapture(repository, plan, owner, image, check) {
  let capture = 0;
  return async () => {
    check();
    const inputs = await isolatedInputs(repository, plan.contract, check);
    assert.equal(inputs.frozen.source.commit, plan.source, 'Mounted source differs from plan');
    const lock = readFileSync(join(plan.contract, 'package-lock.json'));
    assert.equal(sha256(lock), plan.linuxDependencies.lockSha256, 'Linux lock pin differs');
    const helper = owner.create(
      'container',
      `passport-${owner.runId}-deps-${++capture}`,
      [
        '--platform',
        'linux/amd64',
        '--network',
        'none',
        '--read-only',
        '--cap-drop',
        'ALL',
        '--security-opt',
        'no-new-privileges',
        '--mount',
        `type=volume,src=${plan.linuxDependencies.volume},dst=/deps,readonly,volume-nocopy`,
        '--entrypoint',
        'node',
        image,
        '-e',
        linuxTreeProgram,
      ],
      image,
    );
    const result = owner.start(helper, { attach: true });
    assert.equal(result.status, 0);
    assert.equal(object(owner.inspect(helper).State).ExitCode, 0);
    owner.stop(helper);
    const linux = JSON.parse(result.stdout);
    assert.equal(
      linux.sha256,
      plan.linuxDependencies.treeSha256,
      'Linux dependency bytes differ from independently prepared volume',
    );
    const volume = JSON.parse(
      owner.docker(['volume', 'inspect', plan.linuxDependencies.volume]).stdout,
    )[0];
    return {
      ...inputs.frozen,
      keys: inputs.keys,
      linux,
      linuxVolume: { name: volume.Name, createdAt: volume.CreatedAt },
      linuxLockSha256: sha256(lock),
    };
  };
}
