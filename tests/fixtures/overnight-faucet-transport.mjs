import assert from 'node:assert/strict';
import { remoteFaucet, FaucetClientError } from '../../packages/adapter-service/dist/index.js';
/** @typedef {import('../../packages/adapter-service/dist/faucet.js').FaucetClientOptions} Options */
/** @typedef {import('../../packages/account/dist/ports/index.js').FetchLike} FetchLike */
export const original = {
  requestId: '12345678-1234-1234-1234-123456789abc',
  networkId: 'undeployed',
  bindingId: 'acc-s3r1.1',
  manifestSha256: 'ef'.repeat(32),
  accountAddress: 'ab'.repeat(32),
  color: 'cd'.repeat(32),
  amount: '10',
};
export const changedId = '87654321-4321-4321-4321-cba987654321',
  max = '340282366920938463463374607431768211455';
export const result = {
  requestId: original.requestId,
  txId: 'provider-watch',
  creditedBalance: '110',
};
/** @param {unknown} body @param {number} [status] @param {boolean} [ok] */
export const json = (body, status = 200, ok = status >= 200 && status < 300) => ({
  ok,
  status,
  json: async () => body,
});
/** @template T @returns {{promise:Promise<T>,resolve:(value:T)=>void,reject:(reason:unknown)=>void}} */
export function deferred() {
  /** @type {(value:T)=>void} */ let resolve = () => {};
  /** @type {(reason:unknown)=>void} */ let reject = () => {};
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
/** @param {FetchLike} fetch @param {number} [timeoutMs] @param {Options['headers']} [headers] */
export const client = (fetch, timeoutMs, headers = async () => ({})) =>
  remoteFaucet('http://injected.invalid//', {
    fetch,
    headers,
    ...(timeoutMs !== undefined && { timeoutMs }),
  });
/** @param {unknown} error @param {number} status @param {string} message */
export const failure = (error, status, message) => {
  assert.ok(error instanceof FaucetClientError);
  assert.equal(error.status, status);
  assert.equal(error.message, message);
  return true;
};
/** @param {Promise<unknown>} task */
export async function bounded(task) {
  let timer;
  try {
    return await Promise.race([
      task,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(Error('Owned faucet observation did not settle')), 1500);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
