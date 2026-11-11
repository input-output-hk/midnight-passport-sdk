/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_PASSPORT_SERVICE_URL?: string;
  readonly VITE_MIDNAMES_REGISTRY_ADDRESS?: string;
  readonly VITE_MIDNAMES_NAMESPACE?: string;
  readonly VITE_MIDNAMES_NETWORK_ID?: string;
  readonly VITE_MIDNAMES_INDEXER_URL?: string;
  readonly VITE_MIDNAMES_INDEXER_WS_URL?: string;
  readonly VITE_PASSPORT_ARM?: string;
  readonly VITE_PASSPORT_SIGNING_MODE?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/** SHA-256 of the artefacts' contract-manifest.json, injected by vite.config.ts (R18). */
declare const __PASSPORT_MANIFEST_SHA256__: string;

/** The network id this build is bound to (PASSPORT_NETWORK_ID, default `undeployed`), injected by vite.config.ts. */
declare const __PASSPORT_NETWORK_ID__: string;
