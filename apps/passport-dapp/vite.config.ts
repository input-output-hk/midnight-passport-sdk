import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import wasm from 'vite-plugin-wasm';

const here = path.dirname(fileURLToPath(import.meta.url));

const contractDir = process.env.PASSPORT_CONTRACT_DIR;
if (!contractDir) {
  throw new Error(
    'passport-dapp: set PASSPORT_CONTRACT_DIR to the pinned artefact build (the directory holding contracts/managed).',
  );
}
// R18: the app pins the artefact manifest itself, at build time. It is never read from the
// service's /config, which could otherwise vouch for its own tampered artefacts.
const manifestSha256 = process.env.PASSPORT_MANIFEST_SHA256 ?? '';
if (!/^[0-9a-fA-F]{64}$/.test(manifestSha256)) {
  throw new Error(
    "passport-dapp: set PASSPORT_MANIFEST_SHA256 to the 64 hex characters of the SHA-256 of the artefacts' contract-manifest.json.",
  );
}

const buffer = path.resolve(here, 'node_modules/buffer/index.js');

export default defineConfig({
  plugins: [wasm()],
  define: {
    __PASSPORT_MANIFEST_SHA256__: JSON.stringify(manifestSha256.toLowerCase()),
  },
  resolve: {
    // The generated module sits outside the workspace and imports compact-runtime from its own
    // node_modules; a second copy would split the runtime's classes and module state.
    dedupe: ['@midnight-ntwrk/compact-runtime'],
    alias: [
      { find: /^node:buffer$/, replacement: buffer },
      { find: /^buffer$/, replacement: buffer },
      { find: /^(node:)?assert$/, replacement: path.resolve(here, 'src/shims/assert.ts') },
      { find: 'isomorphic-ws', replacement: path.resolve(here, 'src/shims/ws.ts') },
      {
        find: '@acc/module',
        replacement: path.resolve(contractDir, 'contracts/managed/account/contract/index.js'),
      },
    ],
  },
  // The origin must stay exactly http://localhost:5173: wa-json134 binds a 21-byte origin.
  server: {
    host: 'localhost',
    port: 5173,
    strictPort: true,
    fs: { allow: [here, contractDir, path.resolve(here, '../..')] },
  },
  build: { target: 'esnext' },
});
