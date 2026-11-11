import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import wasm from 'vite-plugin-wasm';
import { readPins } from './build-pins.ts';

const here = path.dirname(fileURLToPath(import.meta.url));

// The contract package owns the generated ACC module and pins its Compact runtime peer.
// R18: the app pins the artefact manifest itself, at build time. It is never read from the
// service's /config, which could otherwise vouch for its own tampered artefacts. The network id is
// pinned the same way (PASSPORT_NETWORK_ID, default `undeployed`).
const { manifestSha256, networkId } = readPins(process.env);
const binding = JSON.parse(
  readFileSync(path.resolve(here, '../../packages/contract/acc-binding-v2.generated.json'), 'utf8'),
) as { manifestSha256: string };
if (manifestSha256 !== binding.manifestSha256) {
  throw new Error(
    'passport-dapp: PASSPORT_MANIFEST_SHA256 must pin the packaged acc-s3r1.1 binding',
  );
}

const buffer = path.resolve(here, 'node_modules/buffer/index.js');

function loopbackPort(variable: string) {
  const port = process.env[variable];
  if (!port || !/^[1-9][0-9]{0,4}$/.test(port) || Number(port) > 65535 || port === '5173')
    throw new Error(`Invalid loopback port for ${variable}.`);
  return { target: `http://localhost:${port}`, changeOrigin: false };
}

function claimProxy() {
  if (process.env.VITE_MIDNAMES_CLAIM_PREPARATION !== '1') return;
  const owner = loopbackPort('PASSPORT_MIDNAMES_OWNER_PORT');
  return {
    '/owner-claim/': owner,
    '/owner-artifact/': owner,
    '/owner-proof/': owner,
    '/v1/midnames/claim/': loopbackPort('PASSPORT_MIDNAMES_SPONSOR_PORT'),
  };
}

const proxy = claimProxy();
export default defineConfig({
  plugins: [wasm()],
  worker: { format: 'es', plugins: () => [wasm()] },
  define: {
    __PASSPORT_MANIFEST_SHA256__: JSON.stringify(manifestSha256),
    __PASSPORT_NETWORK_ID__: JSON.stringify(networkId),
  },
  resolve: {
    alias: [
      { find: /^node:buffer$/, replacement: buffer },
      { find: /^buffer$/, replacement: buffer },
      { find: /^(node:)?assert$/, replacement: path.resolve(here, 'src/shims/assert.ts') },
      { find: 'isomorphic-ws', replacement: path.resolve(here, 'src/shims/ws.ts') },
    ],
  },
  // The origin must stay exactly http://localhost:5173: wa-json134 binds a 21-byte origin.
  server: {
    host: 'localhost',
    port: 5173,
    strictPort: true,
    ...(proxy && { proxy }),
    fs: { allow: [here, path.resolve(here, '../..')] },
  },
  build: { target: 'esnext' },
});
