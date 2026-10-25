import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/** @param {{root:string,worker:(...args:any[])=>any,finished:(w:any,ms:number)=>Promise<any>,waitFor:(f:()=>Promise<boolean>,ms:number,terminal?:()=>boolean)=>Promise<void>,docker:(args:string[])=>string,indexerId:string,indexerReady:()=>Promise<boolean>}} c */
export async function runWalletReconnect(c) {
  await mkdir(c.root, { mode: 0o700 });
  /** @param {string} name @param {unknown} value */
  const marker = (name, value) =>
    writeFile(join(c.root, name + '.json'), JSON.stringify(value) + '\n', {
      flag: 'wx',
      mode: 0o600,
    });
  const observer = c.worker('wallet-observer', c.root, 'jubjub', 'wallet', 'none');
  /** @param {any} w */
  const alive = (w) => () => w.child.exitCode !== null || w.child.signalCode !== null;
  await c.waitFor(
    async () => observer.messages.some((/** @type {any} */ m) => m.walletReady),
    180000,
    alive(observer),
  );
  const producer = c.worker('wallet-producer', c.root, 'jubjub', 'wallet', 'none');
  await c.waitFor(
    async () => producer.messages.some((/** @type {any} */ m) => m.walletTransferPrepared),
    180000,
    alive(producer),
  );
  c.docker(['stop', '--time', '1', c.indexerId]);
  await c.waitFor(async () => !(await c.indexerReady()), 10000);
  await marker('wallet-indexer-down', { ownedIndexerStopped: true });
  await c.waitFor(
    async () => observer.messages.some((/** @type {any} */ m) => m.walletDisconnected),
    15000,
    alive(observer),
  );
  await marker('wallet-send', { approveOriginalPreparedTransfer: true });
  await c.waitFor(
    async () => producer.messages.some((/** @type {any} */ m) => m.walletSubmitted),
    60000,
    alive(producer),
  );
  assert.equal(await c.indexerReady(), false);
  // Submission awaited node Finalized, so this finalized height bounds offline inclusion.
  /** @param {string} method @param {unknown[]} [params] */
  const rpc = async (method, params = []) => {
    const response = await fetch('http://127.0.0.1:19954', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      signal: AbortSignal.timeout(4000),
    });
    const value = /** @type {any} */ (await response.json());
    assert.ok(response.ok && value.result && !value.error);
    return value.result;
  };
  const finalized = await rpc('chain_getFinalizedHead');
  const header = await rpc('chain_getHeader', [finalized]);
  const beforeRestartHeight = Number(BigInt(header.number));
  assert.ok(Number.isSafeInteger(beforeRestartHeight) && beforeRestartHeight > 0);
  c.docker(['start', c.indexerId]);
  await c.waitFor(c.indexerReady, 60000);
  await marker('wallet-indexer-up', { beforeRestartHeight });
  const [observed, paid] = await Promise.all([
    c.finished(observer, 240000),
    c.finished(producer, 240000),
  ]);
  assert.equal(observed.code, 0, 'Same-instance wallet reconnect/recreation must complete.');
  assert.equal(paid.code, 0, 'Original offline wallet transfer must confirm.');
  assert.ok(
    observed.messages.some(
      (/** @type {any} */ m) =>
        m.completed === 'wallet-reconnect' &&
        m.afterRestartNight === '2' &&
        m.sameAddresses &&
        m.sameSeed &&
        m.staleHandleRefused &&
        m.subscriptionsClosed,
    ),
  );
  assert.ok(
    paid.messages.some(
      (/** @type {any} */ m) =>
        m.completed === 'wallet-transfer' && m.sends === 1 && m.finalizedDuringIndexerOutage,
    ),
  );
  return {
    operation: 'wallet-reconnect',
    verdict: 'PASS',
    beforeRestartHeight,
    observer: observed,
    producer: paid,
  };
}
