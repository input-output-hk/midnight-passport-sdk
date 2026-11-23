import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { startDemoOwnerBundle } from './claim-owner-browser-host.mjs';
import { verifyPreparedRegistry } from './verify-prepared.mjs';

async function main() {
  const [preparedPath, referencePath, publicContextPath, origin, profileArg, ...extra] =
    process.argv.slice(2);
  if (!preparedPath || !referencePath || !publicContextPath || extra.length) {
    throw new Error(
      'Usage: node --experimental-import-meta-resolve examples/midnames-local/claim-owner-demo-local.mjs <prepared-registry> <registry-client> <public-context.json> [demo-origin] [standalone-0.35|standalone-0.36.1]',
    );
  }
  const profile = profileArg ?? 'standalone-0.35';
  assert.ok(profile === 'standalone-0.35' || profile === 'standalone-0.36.1');

  const context = JSON.parse(readFileSync(publicContextPath, 'utf8'));
  assert.equal(
    context.networkId,
    'undeployed',
    'The owner host supports the isolated local network.',
  );
  assert.equal(context.indexerUrl, 'http://127.0.0.1:18108/api/v4/graphql');
  assert.equal(context.indexerWsUrl, 'ws://127.0.0.1:18108/api/v4/graphql/ws');
  for (const value of [
    context.registryAddress,
    context.sponsorAddress,
    context.walletKeys?.coin,
    context.walletKeys?.encryption,
  ]) {
    assert.equal(typeof value, 'string');
    assert.match(value, /^[0-9a-f]{64}$/);
  }

  const prepared = resolve(preparedPath);
  await verifyPreparedRegistry(prepared, () => {}, profile);
  const assets = join(prepared, 'managed');
  const stop = AbortSignal.any([signalOn('SIGINT'), signalOn('SIGTERM')]);
  const owner = await startDemoOwnerBundle(
    {
      assets,
      modulePath: join(assets, 'contract', 'index.js'),
      ref: resolve(referencePath),
      registryProfile: profile,
      ...(profile === 'standalone-0.36.1' && { proverUrl: context.proverUrl }),
    },
    context,
    origin,
  );
  try {
    if (stop.aborted) return;
    console.log('PASSPORT_MIDNAMES_OWNER_PORT=' + new URL(owner.origin).port);
    await new Promise((done) => stop.addEventListener('abort', done, { once: true }));
  } finally {
    await owner.close();
  }
}

function signalOn(name) {
  const signal = new AbortController();
  process.once(name, () => signal.abort());
  return signal.signal;
}

await main();
