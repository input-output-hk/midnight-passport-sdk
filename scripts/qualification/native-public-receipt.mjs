// Explicit public projection. Unknown child fields and filesystem locations never leave the run.
import assert from 'node:assert/strict';
import { consumerSha256 } from '../consumer-inputs.mjs';
export { nativeSignerInputIdentity as publicSignerIdentity } from './native-worker-inputs.mjs';
/** @param {any} inner */
export function publicNativeResult(inner) {
  if (!inner) return undefined;
  // The caller validates success semantics separately. Hash arbitrary labels instead of exporting them.
  const hex = (/** @type {unknown} */ value, /** @type {number} */ bytes) => {
    assert.ok(typeof value === 'string');
    assert.match(value, new RegExp('^[a-f0-9]{' + bytes * 2 + '}$'));
    return value;
  };
  assert.ok(Number.isSafeInteger(inner.testsPassed) && inner.testsPassed >= 0);
  assert.ok(Array.isArray(inner.cases));
  return {
    testsPassed: inner.testsPassed,
    casesSha256: consumerSha256(JSON.stringify(inner.cases)),
    address: hex(inner.address, 32),
    grantId: hex(inner.grantId, 32),
    depositTxId: hex(inner.depositTxId, 33),
    depositTxHash: hex(inner.depositTxHash, 32),
    confirmedContractActions: inner.confirmedContractActions.map((/** @type {unknown} */ h) =>
      hex(h, 32),
    ),
    nativeProof: inner.nativeProof === true,
    syntheticCredentials: inner.syntheticCredentials === true,
    hostSignerHandlers: inner.hostSignerHandlers === true,
    readerDelivery: inner.readerDelivery === true,
    realProvider: false,
    fullCompatibility: false,
  };
}
/** Final identity failure must not discard an already-effectful run's cleanup/evidence.
 * @param {()=>Promise<unknown>} readIdentity
 */
export async function nativeEndIdentity(readIdentity) {
  try {
    return { source: await readIdentity() };
  } catch (error) {
    return { failureSha256: consumerSha256(String(error)) };
  }
}
