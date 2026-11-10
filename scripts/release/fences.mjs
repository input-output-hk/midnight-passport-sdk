// Evidence on failed work must still include its independent end-of-interval fence.
import assert from 'node:assert/strict';

/** @template T @param {()=>unknown} capture @param {()=>Promise<T>} work @param {(result:{checked:boolean,inputsUnchanged:boolean})=>void} retain */
export async function installedFence(capture, work, retain) {
  const before = capture();
  let checked = false,
    inputsUnchanged = false;
  try {
    return await work();
  } finally {
    try {
      const after = capture();
      checked = true;
      assert.deepEqual(after, before, 'Installed graph changed');
      inputsUnchanged = true;
    } finally {
      retain({ checked, inputsUnchanged });
    }
  }
}

/** @template T @param {import('./resources.mjs').ResourceOwner} owner @param {()=>void} verify @param {()=>Promise<T>} work @param {(complete:boolean)=>void} retain */
export async function imageInterval(owner, verify, work, retain) {
  let complete = false;
  try {
    return await work();
  } finally {
    try {
      verify();
      complete = owner.cleanup();
    } finally {
      retain(complete);
    }
    assert.equal(complete, true, 'Image compute unresolved; preserve original IDs');
  }
}
