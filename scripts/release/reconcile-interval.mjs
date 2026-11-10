// Reconciled cleanup never upgrades an interrupted functional run to PASS.
import assert from 'node:assert/strict';
import { isDeepStrictEqual } from 'node:util';

/** @typedef {{verdict:string,functional:false,clientClosed:boolean,quiescent:boolean,inputsUnchanged:boolean,leaseReleased:boolean,before:unknown,after?:unknown,failureType?:string}} ReconcileReceipt */
/** @param {{owner:import('./resources.mjs').ResourceOwner,verify:()=>void,closeClient:()=>Promise<boolean>,capture:()=>Promise<unknown>,releaseLease:(safe:boolean)=>void,receipt:ReconcileReceipt,save:()=>void}} options */
export async function reconciliationInterval(options) {
  const { owner, verify, closeClient, capture, releaseLease, receipt, save } = options;
  try {
    verify();
    receipt.clientClosed = await closeClient();
    save();
  } catch (error) {
    receipt.failureType = error instanceof Error ? error.name : 'UnknownFailure';
    save();
  } finally {
    let stopped = false;
    try {
      verify();
      if (owner.pending) owner.reconcile(); // Resolve only the recorded allocation.
      stopped = owner.cleanup();
    } catch {
      /* Still stop known resources below; unresolved allocation retains lease. */
    }
    if (!stopped) {
      try {
        verify();
        stopped = owner.cleanup();
      } catch {
        /* retain uncertainty */
      }
    }
    if (receipt.clientClosed && stopped && receipt.before !== undefined) {
      try {
        receipt.after = await capture();
        receipt.inputsUnchanged = isDeepStrictEqual(receipt.before, receipt.after);
      } catch (error) {
        receipt.failureType ??= error instanceof Error ? error.name : 'UnknownFailure';
      }
    }
    try {
      verify();
      receipt.quiescent = owner.cleanup() && receipt.clientClosed;
    } catch {
      receipt.quiescent = false;
    }
    if (receipt.quiescent && receipt.inputsUnchanged) {
      try {
        verify();
        releaseLease(true);
        receipt.leaseReleased = true;
      } catch {
        receipt.leaseReleased = false;
      }
    }
    receipt.verdict =
      receipt.clientClosed && receipt.inputsUnchanged && receipt.quiescent && receipt.leaseReleased
        ? 'RECONCILED_INTERRUPTION'
        : 'FAIL';
    save();
  }
  assert.equal(
    receipt.verdict,
    'RECONCILED_INTERRUPTION',
    'Unresolved interruption: preserve every record and the native lease',
  );
  return receipt;
}
