// Node execution of the actual built-in wallet; software seed, not browser/provider acceptance.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import {
  privateFiles,
  boundedWait,
  publicEvent as emit,
} from '../../passport-service/qualification/private-files.ts';
import { createDevWallet, type DevWallet } from '../src/wallet/dev-wallet.ts';

const [, root] = process.argv.slice(2);
assert.equal(process.env.PASSPORT_RC_LOCALNET, '1');
assert.equal(process.env.MN_NETWORK_ID, 'undeployed');
assert.equal(process.env.MN_INDEXER_URL, 'http://127.0.0.1:18098/api/v4/graphql');
assert.equal(process.env.MN_INDEXER_WS_URL, 'ws://127.0.0.1:18098/api/v4/graphql/ws');
assert.equal(process.env.MN_NODE_URL, 'http://127.0.0.1:19954');
const files = privateFiles(root!);
assert.equal(files.exists('wallet-fixture.json'), false, 'Do not replace a prior wallet identity.');
files.save('wallet-fixture.json', { seed: new Uint8Array(randomBytes(32)) });
const material = files.read('wallet-fixture.json');
const nativeSocket = globalThis.WebSocket;
let opens = 0,
  closes = 0,
  active = 0;
class ObservedSocket extends nativeSocket {
  constructor(url: string | URL, protocols?: string | string[]) {
    super(url, protocols);
    if (String(url) === process.env.MN_INDEXER_WS_URL) {
      let opened = false;
      this.addEventListener('open', () => {
        opened = true;
        opens++;
        active++;
      });
      this.addEventListener('close', () => {
        if (opened) {
          closes++;
          active--;
        }
      });
    }
  }
}
globalThis.WebSocket = ObservedSocket;
const config = {
  networkId: 'undeployed',
  indexerUri: process.env.MN_INDEXER_URL!,
  indexerWsUri: process.env.MN_INDEXER_WS_URL!,
  nodeUri: process.env.MN_NODE_URL!,
};
const NIGHT = '00'.repeat(32);
let wallet: DevWallet | undefined;
try {
  wallet = await createDevWallet(material.seed, config);
  const api = await wallet.descriptor.connect('undeployed');
  const addresses = async (v: typeof api) => ({
    unshielded: (await v.getUnshieldedAddress()).unshieldedAddress,
    shielded: (await v.getShieldedAddresses()).shieldedAddress,
    dust: (await v.getDustAddress()).dustAddress,
  });
  const before = await addresses(api);
  const initial = (await api.getUnshieldedBalances())[NIGHT] ?? 0n;
  assert.equal(initial, 0n);
  await boundedWait(() => opens > 0);
  const originalOpens = opens,
    originalCloses = closes;
  files.save('wallet-ready.json', { ...before, initialNight: initial });
  emit({ walletReady: true, initialNight: initial.toString(), socketOpens: opens });
  await boundedWait(() => files.exists('wallet-indexer-down.json'));
  await boundedWait(() => closes > originalCloses);
  assert.equal(
    await fetch(config.indexerUri, { signal: AbortSignal.timeout(2000) }).then(
      () => true,
      () => false,
    ),
    false,
  );
  emit({ walletDisconnected: true, socketCloses: closes });
  await boundedWait(() => files.exists('wallet-indexer-up.json'));
  let received = 0n;
  await boundedWait(async () => {
    received = (await api.getUnshieldedBalances())[NIGHT] ?? 0n;
    return received === 2n;
  });
  assert.ok(opens > originalOpens, 'The same wallet must reopen its indexer socket.');
  assert.deepEqual(await addresses(api), before);
  await Promise.all([wallet.stop(), wallet.stop()]);
  await assert.rejects(api.getConnectionStatus(), { code: 'Disconnected' });
  await assert.rejects(wallet.descriptor.connect('undeployed'), { code: 'Disconnected' });
  await boundedWait(() => active === 0, 10000);
  wallet = await createDevWallet(material.seed, config);
  const reopened = await wallet.descriptor.connect('undeployed');
  assert.deepEqual(await addresses(reopened), before);
  assert.equal((await reopened.getUnshieldedBalances())[NIGHT], 2n);
  assert.deepEqual(files.read('wallet-fixture.json'), material);
  await wallet.stop();
  await boundedWait(() => active === 0, 10000);
  emit({
    completed: 'wallet-reconnect',
    initialNight: initial.toString(),
    afterRestartNight: received.toString(),
    reopenedNight: '2',
    socketOpens: opens,
    socketCloses: closes,
    sameAddresses: true,
    sameSeed: true,
    staleHandleRefused: true,
    subscriptionsClosed: true,
  });
} finally {
  await wallet?.stop();
  globalThis.WebSocket = nativeSocket;
}

process.exit(0);
