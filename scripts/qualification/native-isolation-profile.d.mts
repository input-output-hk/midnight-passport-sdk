export const ISOLATED_KIND: 'source-host-job-lifecycle';
export const ISOLATED_PORTS: Readonly<{
  node: 19964;
  indexer: 18108;
  prover: 16320;
  service: 18798;
}>;
export const ISOLATED_ENDPOINTS: Readonly<{
  nodeUrl: 'http://127.0.0.1:19964';
  indexerUrl: 'http://127.0.0.1:18108/api/v4/graphql';
  indexerWsUrl: 'ws://127.0.0.1:18108/api/v4/graphql/ws';
  proverUrl: 'http://127.0.0.1:16320';
}>;
export interface IsolationProfile {
  readonly schema: 1;
  readonly kind: typeof ISOLATED_KIND;
  readonly runId: string;
  readonly project: string;
  readonly outputRoot: string;
  readonly endpoints: typeof ISOLATED_ENDPOINTS;
  readonly service: Readonly<{ host: '127.0.0.1'; port: 18798 }>;
}
export function isolationObject(value: unknown): Record<string, unknown>;
export function isolationProfile(runId: string, outputRoot: string): IsolationProfile;
export function admitIsolationProfile(input: unknown): IsolationProfile;
export function isolationDigest(profile: IsolationProfile): string;
export function isolationEnvironment(profile: IsolationProfile): {
  PASSPORT_NATIVE_ISOLATION: typeof ISOLATED_KIND;
  PASSPORT_NATIVE_ISOLATION_FILE: string;
  PASSPORT_NATIVE_ISOLATION_SHA256: string;
  PASSPORT_NATIVE_ISOLATION_RUN_ID: string;
  MN_NODE_URL: typeof ISOLATED_ENDPOINTS.nodeUrl;
  MN_INDEXER_URL: typeof ISOLATED_ENDPOINTS.indexerUrl;
  MN_INDEXER_WS_URL: typeof ISOLATED_ENDPOINTS.indexerWsUrl;
  MN_PROOF_SERVER_URL: typeof ISOLATED_ENDPOINTS.proverUrl;
  PASSPORT_SERVICE_HOST: '127.0.0.1';
  PASSPORT_SERVICE_PORT: string;
};
export const ISOLATION_FORBIDDEN_NAMES: readonly string[];
export const ISOLATION_FORBIDDEN_PREFIXES: readonly string[];
export function assertIsolationOverrides(env: NodeJS.ProcessEnv): void;
