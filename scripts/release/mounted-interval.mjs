// One coordinator for actual and fault-injected mounted runs. Never manufacture a PASS.
import assert from 'node:assert/strict';
import { isDeepStrictEqual } from 'node:util';
import { releaseOutcome } from './resources.mjs';

/** @typedef {{verdict:string,functional:boolean,inputsUnchanged:boolean,quiescent:boolean,leaseReleased:boolean,before?:unknown,after?:unknown,result?:unknown,failureType?:string}} IntervalReceipt */
/** @param {{owner:import('./resources.mjs').ResourceOwner,capture:()=>Promise<unknown>,execute:()=>Promise<unknown>,stopProcesses:()=>Promise<boolean>,releaseLease:(ok:boolean)=>void,save:()=>void,verifyDaemon:()=>void,receipt:IntervalReceipt}} options */
export async function mountedInterval(options) {
  const { owner, capture, execute, stopProcesses, releaseLease, save, receipt, verifyDaemon } =
    options;
  let began = false;
  try {
    receipt.before = await capture();
    began = true;
    save();
    receipt.result = await execute();
    receipt.functional = true;
    save();
  } catch (error) {
    receipt.failureType = error instanceof Error ? error.name : 'UnknownFailure';
    save();
  } finally {
    let processesClosed = false,
      firstCleanup = false;
    try {
      processesClosed = await stopProcesses();
    } catch {
      /* retain lease */
    }
    try {
      verifyDaemon();
      firstCleanup = owner.cleanup();
    } catch {
      /* retain lease */
    }
    if (began && processesClosed && firstCleanup) {
      try {
        receipt.after = await capture();
        receipt.inputsUnchanged = isDeepStrictEqual(receipt.after, receipt.before);
      } catch {
        receipt.inputsUnchanged = false;
      }
    }
    // The final input check can itself create/start a Linux fingerprint helper.
    try {
      verifyDaemon();
      receipt.quiescent = owner.cleanup() && processesClosed;
    } catch {
      receipt.quiescent = false;
    }
    try {
      releaseLease(receipt.quiescent && receipt.inputsUnchanged);
      receipt.leaseReleased = true;
    } catch {
      receipt.leaseReleased = false;
    }
    receipt.verdict = releaseOutcome({
      functional: receipt.functional,
      inputs: receipt.inputsUnchanged,
      quiescent: receipt.quiescent,
      leaseReleased: receipt.leaseReleased,
    });
    save();
  }
  assert.equal(
    receipt.verdict,
    'PASS',
    'Mounted qualification failed; preserve journal, IDs, state and any unresolved lease',
  );
  return receipt;
}
