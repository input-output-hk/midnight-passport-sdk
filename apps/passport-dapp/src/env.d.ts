/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_PASSPORT_SERVICE_URL?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/** SHA-256 of the artefacts' contract-manifest.json, injected by vite.config.ts (R18). */
declare const __PASSPORT_MANIFEST_SHA256__: string;

/**
 * The generated module of the pinned artefact build (package.json "imports", synced by
 * scripts/sync-acc.mjs). Declared here so that type-checking needs no synced copy: the copy is
 * git-ignored and excluded from tsconfig.json.
 */
declare module '#acc' {
  type Generated = import('@midnight-ntwrk/mn-passport-adapter-browser').GeneratedAccModule;
  export const Contract: Generated['Contract'];
  export const ledger: Generated['ledger'];
  export const pureCircuits: Generated['pureCircuits'];
}
