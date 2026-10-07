// experiments/acc-0.35/patch-endpoints.sh against temp copies of the reference client's
// `src/node/wallet.ts` and `src/wallet/capture.ts` snippets: the original literals, the older
// port-only patch (which must be upgraded, not skipped), and the idempotent rerun.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(
  new URL('../experiments/acc-0.35/patch-endpoints.sh', import.meta.url),
);

/** @param {string[]} localLines the endpoint lines of CONFIGS.local */
const wallet = (localLines) => `const NETWORK = process.env.MIDNIGHT_NETWORK ?? 'local';

const CONFIGS: Record<
  string,
  { networkId: string; indexer: string; indexerWS: string; node: string; proofServer: string }
> = {
  local: {
${localLines.map((l) => `    ${l}`).join('\n')}
  },
};

export const CONFIG = CONFIGS[NETWORK] ?? CONFIGS.local;
const networkId = getNetworkId();
const cfg = {
    networkId,
    node: 1,
};
`;
/** @param {string} fallback */
const capture = (fallback) => `export function indexerUrl(): string {
  return process.env.INDEXER_URL
    ?? process.env.MIDNIGHT_INDEXER_URL
    ?? ${fallback};
}
`;

const ORIGINAL = {
  wallet: wallet([
    "networkId: 'undeployed',",
    "indexer: 'http://localhost:8088/api/v4/graphql',",
    "indexerWS: 'ws://localhost:8088/api/v4/graphql/ws',",
    "node: 'http://localhost:9944',",
    "proofServer: 'http://127.0.0.1:6300',",
  ]),
  capture: capture("'http://localhost:8088/api/v4/graphql'"),
};
// What the script produced before the MN_*_URL variables existed.
const PORT_ONLY = {
  wallet: wallet([
    "networkId: 'undeployed',",
    "indexer: `http://localhost:${process.env.MN_INDEXER_PORT ?? '18088'}/api/v4/graphql`,",
    "indexerWS: `ws://localhost:${process.env.MN_INDEXER_PORT ?? '18088'}/api/v4/graphql/ws`,",
    "node: `http://localhost:${process.env.MN_NODE_PORT ?? '19944'}`,",
    "proofServer: `http://127.0.0.1:${process.env.MN_PROOF_PORT ?? '16300'}`,",
  ]),
  capture: capture("`http://localhost:${process.env.MN_INDEXER_PORT ?? '18088'}/api/v4/graphql`"),
};

/** @param {{ wallet: string, capture: string }} files */
function tree(files) {
  const dir = mkdtempSync(join(tmpdir(), 'patch-endpoints-'));
  mkdirSync(join(dir, 'src/node'), { recursive: true });
  mkdirSync(join(dir, 'src/wallet'), { recursive: true });
  writeFileSync(join(dir, 'src/node/wallet.ts'), files.wallet);
  writeFileSync(join(dir, 'src/wallet/capture.ts'), files.capture);
  return dir;
}
/** @param {string} dir */
const patch = (dir) => execFileSync('bash', [SCRIPT, dir], { encoding: 'utf8' });
/** @param {string} dir */
const read = (dir) => ({
  wallet: readFileSync(join(dir, 'src/node/wallet.ts'), 'utf8'),
  capture: readFileSync(join(dir, 'src/wallet/capture.ts'), 'utf8'),
});

/**
 * Evaluates CONFIGS.local of a patched wallet.ts under an environment.
 * @param {string} source
 * @param {Record<string, string>} env
 */
function localConfig(source, env) {
  const block = /^ {2}local: \{\n([\s\S]*?)\n {2}\},$/m.exec(source)?.[1];
  assert.ok(block, 'CONFIGS.local not found');
  return new Function('process', `return ({ ${block} });`)({ env });
}

/** @param {string} source @param {Record<string, string>} env */
function indexerFallback(source, env) {
  const body = /indexerUrl\(\): string \{\n\s*return ([\s\S]*?);\n\}/.exec(source)?.[1];
  assert.ok(body, 'indexerUrl() not found');
  return new Function('process', `return (${body});`)({ env });
}

const LOCAL = {
  networkId: 'undeployed',
  indexer: 'http://localhost:18088/api/v4/graphql',
  indexerWS: 'ws://localhost:18088/api/v4/graphql/ws',
  node: 'http://localhost:19944',
  proofServer: 'http://127.0.0.1:16300',
};
const HOSTED = {
  MN_NETWORK_ID: 'preview',
  MN_NODE_URL: 'https://node.example',
  MN_INDEXER_URL: 'https://indexer.example/api/v4/graphql',
  MN_INDEXER_WS_URL: 'wss://indexer.example/api/v4/graphql/ws',
  MN_PROOF_SERVER_URL: 'https://prover.example',
};

/** @param {{ wallet: string, capture: string }} files */
function assertCurrent(files) {
  // Falls back to the ports, as before.
  assert.deepEqual(localConfig(files.wallet, {}), LOCAL);
  assert.deepEqual(
    localConfig(files.wallet, { MN_NODE_PORT: '1', MN_INDEXER_PORT: '2', MN_PROOF_PORT: '3' }),
    {
      networkId: 'undeployed',
      indexer: 'http://localhost:2/api/v4/graphql',
      indexerWS: 'ws://localhost:2/api/v4/graphql/ws',
      node: 'http://localhost:1',
      proofServer: 'http://127.0.0.1:3',
    },
  );
  // Reads the stack variables, which beat the ports.
  assert.deepEqual(localConfig(files.wallet, { ...HOSTED, MN_NODE_PORT: '1' }), {
    networkId: 'preview',
    indexer: HOSTED.MN_INDEXER_URL,
    indexerWS: HOSTED.MN_INDEXER_WS_URL,
    node: HOSTED.MN_NODE_URL,
    proofServer: HOSTED.MN_PROOF_SERVER_URL,
  });
  // The rest of the file is untouched.
  assert.match(files.wallet, /^ {4}networkId,\n {4}node: 1,$/m);
  assert.match(files.wallet, /CONFIG = CONFIGS\[NETWORK\] \?\? CONFIGS\.local;/);
  // capture.ts: INDEXER_URL and MIDNIGHT_INDEXER_URL still win.
  assert.equal(indexerFallback(files.capture, {}), LOCAL.indexer);
  assert.equal(indexerFallback(files.capture, { MN_INDEXER_URL: 'https://i' }), 'https://i');
  assert.equal(
    indexerFallback(files.capture, {
      MN_INDEXER_URL: 'https://i',
      MIDNIGHT_INDEXER_URL: 'https://m',
    }),
    'https://m',
  );
  assert.equal(
    indexerFallback(files.capture, { MN_INDEXER_URL: 'https://i', INDEXER_URL: 'https://x' }),
    'https://x',
  );
  assert.equal(
    indexerFallback(files.capture, { MN_INDEXER_PORT: '7' }),
    'http://localhost:7/api/v4/graphql',
  );
}

test('the patch makes the original reference client read the MN_* stack', () => {
  const dir = tree(ORIGINAL);
  assert.match(patch(dir), /patching the original/);
  assertCurrent(read(dir));
  // The original is kept once.
  assert.equal(readFileSync(join(dir, 'src/node/wallet.ts.orig'), 'utf8'), ORIGINAL.wallet);
});

test('the patch upgrades the older port-only patch instead of skipping it', () => {
  const dir = tree(PORT_ONLY);
  assert.deepEqual(read(dir), PORT_ONLY);
  assert.match(patch(dir), /upgrading the port-only patch/);
  assertCurrent(read(dir));
});

test('the patch is idempotent, and both starting points end at the same files', () => {
  const fresh = tree(ORIGINAL);
  patch(fresh);
  const once = read(fresh);
  assert.match(patch(fresh), /already patched/);
  assert.deepEqual(read(fresh), once);
  const upgraded = tree(PORT_ONLY);
  patch(upgraded);
  assert.deepEqual(read(upgraded), once);
});

test('the patch fails loudly on a wallet.ts it does not recognise', () => {
  const dir = tree({ wallet: 'export const CONFIG = {};\n', capture: ORIGINAL.capture });
  assert.throws(() => patch(dir), /did not match/);
});
