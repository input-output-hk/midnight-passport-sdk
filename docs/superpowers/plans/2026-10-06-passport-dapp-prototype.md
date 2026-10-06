# Passport DApp Prototype Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A prototype Midnight Passport DApp Connector API (consumable by lace-sdk from this fork) plus a Passport web app whose Node service hosts the ACC's ZK artefacts, proves server-side, deploys and sponsors — so a new user's passkey creates, activates, uses, and reopens an ACC on the standalone network.

**Architecture:** Platform-neutral connector logic lives in `packages/account` behind injected seams (passkey, chain, registry, contract module). `packages/adapter-browser` supplies the browser seams: WebAuthn `wa-json134`, a midnight-js call pipeline whose proving and fee balancing are delegated over HTTP, and a `window.midnight.passport` shim. `apps/passport-service` is a thin `node:http` layer over the contract team's reference client, imported at runtime from the pinned, git-ignored ACC export. `apps/passport-dapp` is a Vite harness with a built-in, PRF-seeded wallet.

**Tech Stack:** TypeScript 6 (repo base config), Node 22 and pnpm 10.34.4 from the repo's Nix flake, Compact 0.35.0 artefacts from revision `45721e1`, midnight-js 5.0.0-rc.2, compact-js 3.0.0-rc.3, compact-runtime 0.20.0, ledger-v9 1.0.0-rc.5, wallet SDK 5.0.0-rc.0, `@noble/curves` 2.2.0, Vite 8.3.1 + `vite-plugin-wasm` 3.6.0, `tsx` 4.23.15, `node:test`.

**Spec:** [`docs/superpowers/specs/2026-10-06-passport-dapp-design.md`](../specs/2026-10-06-passport-dapp-design.md)

## Global Constraints

- **Nix only.** Every build, test, compile and run command in this plan runs inside the repository's Nix shell: either `nix develop` first, or `nix develop -c <command>`. Other `compactc`/`compact`, Node, or Midnight stack versions on the machine must never be used. `apps/passport-service` and every prototype script start by running `experiments/acc-0.35/guard.sh`.
- Network id `'undeployed'`; standalone localnet from `infra/localnet` with Docker memory ≥ 24 GiB.
- Artefacts: the 52-circuit ACC at revision `45721e1`, produced by `experiments/acc-0.35/fetch-acc.sh 45721e1` and `experiments/acc-0.35/compile.sh <dir> full`. Its compiler manifest hash is pinned and checked at service start-up.
- WebAuthn: profile `wa-json134`; RP id `localhost`; origin exactly `http://localhost:5173` (21 bytes). The dapp's Vite server uses `strictPort: true` on 5173.
- Dependencies: exact pins (the repo's `save-exact`); `ignore-scripts=true` stays; any version younger than 7 days needs an owner-approved `minimumReleaseAgeExclude` entry with a comment.
- Package rules (enforced by `tests/dependency-rules.test.mjs`): every `packages/<dir>` is `@midnight-ntwrk/mn-passport-<dir>`, `"version": "0.0.0"`, `"private": true`, `"type": "module"`, and is in `scripts/dependency-graph.mjs`. `account` is platform-neutral: no `node:` imports, no globals other than `crypto`.
- Code style: British English, dates `YYYY/MM/DD`; no `any`, and `unknown` only with a comment naming why; vendor-neutral wording in committed docs.
- Pushed text names no upstream (`midnightntwrk`) repository. Code ported from the planning workspace carries a header naming the file path and revision only.
- Commits: `git commit -S -s` with an `Assisted-by: AI` trailer, never `Co-Authored-By`; conventional subjects; stage explicit paths, never `git add -A`; verify `git log --format='%h %G?' -1` prints `G`; push only `git push origin refs/heads/passport-acc-prototype:refs/heads/passport-acc-prototype`.

## Review Focus

1. **The use counter rolls after every authorised call.** A second `rotateEncryptionKey`, or one after a reload, must rescan the device entry rather than reuse counter 0. A reasonable user expects the second click to work. Pinned by the "rotate twice" test in Task 4 and by the end-to-end script in Task 10.
2. **A failure between deploy and activation must not lose the account.** The boot salt is the only way to activate. Expected: the registry records the account as `deployed` (with its salt) before activation, and `openAccount` finishes the activation. Pinned in Task 4.
3. **A stale or tampered artefact directory.** Expected: the service refuses to start, not serve the wrong keys. Pinned in Task 5.
4. **Path traversal on `/zk`** (`/zk/acc/../../…`, encoded variants). Expected: 404, never a file outside the artefact root. Pinned in Task 5.
5. **Two P-256 proofs at once.** Each needs about 13.5 GiB. Expected: the service runs proofs one at a time instead of exhausting the VM. Pinned in Task 7.

---

## Prerequisites (once, before Task 1)

- [ ] **P1: Artefacts and toolchain.** Inside `nix develop`:

```bash
export PASSPORT_REPO=/path/to/your/passport/checkout
git -C "$PASSPORT_REPO" fetch
D=$(experiments/acc-0.35/fetch-acc.sh 45721e1 | tail -1)
experiments/acc-0.35/compile.sh "$D" full        # ~22 min if not already built
(cd "$D" && npm ci --ignore-scripts --no-audit --no-fund)
shasum -a 256 "$D/contracts/managed/account/compiler/contract-manifest.json"
```

Expected: the inventory line reports `52 proving` and `manifest: 212 files, … mismatches: 0`. Record the manifest SHA-256; it is `PASSPORT_MANIFEST_SHA256` below.

- [ ] **P2: Localnet.** Docker Desktop memory ≥ 24 GiB, then:

```bash
experiments/acc-0.35/run.sh "$D" down 2>/dev/null; cp -n infra/localnet/.env.example infra/localnet/.env
docker compose -f infra/localnet/docker-compose.yml -f infra/localnet/docker-compose.macos.yml up -d --wait node proof-server
# wait for block ≥ 2, then:
docker compose -f infra/localnet/docker-compose.yml -f infra/localnet/docker-compose.macos.yml up -d --wait indexer
```

Expected: node `2.1.0-1b2b31c7`, proof server `9.0.0-rc.8`, indexer healthy.

---

### Task 1: Workspace scaffolding for the prototype

**Files:**
- Modify: `pnpm-workspace.yaml`
- Modify: `scripts/dependency-graph.mjs`
- Modify: `scripts/lint-boundaries.mjs:20`
- Modify: `tsconfig.build.json`
- Modify: `package.json` (root scripts)
- Create: `packages/account/package.json`, `packages/account/tsconfig.json`, `packages/account/src/index.ts`
- Create: `packages/adapter-browser/package.json`, `packages/adapter-browser/tsconfig.json`, `packages/adapter-browser/src/index.ts`
- Create: `apps/passport-service/package.json`, `apps/passport-service/tsconfig.json`
- Create: `apps/passport-dapp/package.json`, `apps/passport-dapp/tsconfig.json`
- Test: `tests/dependency-rules.test.mjs` (existing, must stay green)

**Interfaces:**
- Produces: workspace packages `@midnight-ntwrk/mn-passport-account` (deps: contract, protocol) and `@midnight-ntwrk/mn-passport-adapter-browser` (deps: account, contract, protocol); apps `passport-service` and `passport-dapp`.

- [ ] **Step 1: Check the cooldown for every new dependency.** Inside `nix develop`:

```bash
for p in @midnight-ntwrk/compact-runtime:0.20.0 @midnight-ntwrk/compact-js:3.0.0-rc.3 \
  @midnight-ntwrk/midnight-js-contracts:5.0.0-rc.2 @midnight-ntwrk/midnight-js-types:5.0.0-rc.2 \
  @midnight-ntwrk/midnight-js-fetch-zk-config-provider:5.0.0-rc.2 \
  @midnight-ntwrk/midnight-js-indexer-public-data-provider:5.0.0-rc.2 \
  @midnight-ntwrk/midnight-js-network-id:5.0.0-rc.2 @midnightntwrk/ledger-v9:1.0.0-rc.5 \
  @midnightntwrk/wallet-sdk-facade:5.0.0-rc.0 @noble/curves:2.2.0 @noble/hashes:2.2.0 \
  vite:8.3.1 vite-plugin-wasm:3.6.0 tsx:4.23.15 buffer:6.0.3; do
  n=${p%%:*}; v=${p##*:}
  npm view "$n" time --json | node -e "let s='';process.stdin.on('data',c=>s+=c).on('end',()=>{const d=JSON.parse(s)['$v'];const age=(Date.now()-Date.parse(d))/864e5;console.log('$n@$v',d,age.toFixed(1)+'d',age<7?'INSIDE 7-DAY WINDOW':'ok')})"
done
```

Expected: every line `ok`, except possibly the 2026/09/29–30 releases (compact-runtime, compact-js, midnight-js). For each `INSIDE 7-DAY WINDOW` line, stop and get the owner's approval before Step 2's exclusion entry.

- [ ] **Step 2: Workspace and cooldown exclusions.** Edit `pnpm-workspace.yaml` so it reads (keep the existing comments):

```yaml
packages:
  - packages/*
  - apps/*

minimumReleaseAge: 10080
blockExoticSubdeps: true
trustPolicy: no-downgrade
minimumReleaseAgeExclude:
  # Renovate security update: pnpm@10.34.4
  - pnpm@10.34.4
  # Passport DApp prototype (docs/superpowers/specs/2026-10-06-passport-dapp-design.md):
  # the Compact 0.35.0 stack the ACC was verified on; owner-approved on <date>.
  # Remove each line once its version is older than 7 days.
  - '@midnight-ntwrk/compact-runtime@0.20.0'
  - '@midnight-ntwrk/compact-js@3.0.0-rc.3'
  - '@midnight-ntwrk/midnight-js-contracts@5.0.0-rc.2'
  - '@midnight-ntwrk/midnight-js-types@5.0.0-rc.2'
  - '@midnight-ntwrk/midnight-js-fetch-zk-config-provider@5.0.0-rc.2'
  - '@midnight-ntwrk/midnight-js-indexer-public-data-provider@5.0.0-rc.2'
  - '@midnight-ntwrk/midnight-js-network-id@5.0.0-rc.2'
```

List only the versions Step 1 reported as inside the window.

- [ ] **Step 3: Dependency graph and platform neutrality.** In `scripts/dependency-graph.mjs` add two entries to `ALLOWED`:

```js
  account: ['contract', 'protocol'],
  'adapter-browser': ['account', 'contract', 'protocol'],
```

In `scripts/lint-boundaries.mjs:20` change the set to:

```js
const PLATFORM_NEUTRAL = new Set(['protocol', 'contract', 'core', 'connect', 'account']);
```

- [ ] **Step 4: Package skeletons.** Create `packages/account/package.json`:

```json
{
  "name": "@midnight-ntwrk/mn-passport-account",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": { ".": { "types": "./dist/index.d.ts", "default": "./dist/index.js" } },
  "files": ["dist"],
  "dependencies": {
    "@midnight-ntwrk/mn-passport-contract": "workspace:*",
    "@midnight-ntwrk/mn-passport-protocol": "workspace:*"
  }
}
```

`packages/account/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "outDir": "dist", "rootDir": "src", "tsBuildInfoFile": "dist/.tsbuildinfo" },
  "include": ["src"],
  "references": [{ "path": "../contract" }, { "path": "../protocol" }]
}
```

`packages/account/src/index.ts`: `export {};`

`packages/adapter-browser/package.json`:

```json
{
  "name": "@midnight-ntwrk/mn-passport-adapter-browser",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": { ".": { "types": "./dist/index.d.ts", "default": "./dist/index.js" } },
  "files": ["dist"],
  "dependencies": {
    "@midnight-ntwrk/compact-js": "3.0.0-rc.3",
    "@midnight-ntwrk/midnight-js-contracts": "5.0.0-rc.2",
    "@midnight-ntwrk/midnight-js-fetch-zk-config-provider": "5.0.0-rc.2",
    "@midnight-ntwrk/midnight-js-indexer-public-data-provider": "5.0.0-rc.2",
    "@midnight-ntwrk/midnight-js-network-id": "5.0.0-rc.2",
    "@midnight-ntwrk/midnight-js-types": "5.0.0-rc.2",
    "@midnight-ntwrk/mn-passport-account": "workspace:*",
    "@midnight-ntwrk/mn-passport-contract": "workspace:*",
    "@midnight-ntwrk/mn-passport-protocol": "workspace:*",
    "@midnightntwrk/ledger-v9": "1.0.0-rc.5",
    "@noble/curves": "2.2.0",
    "@noble/hashes": "2.2.0"
  }
}
```

`packages/adapter-browser/tsconfig.json` (DOM types: this package is browser-facing):

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist", "rootDir": "src", "tsBuildInfoFile": "dist/.tsbuildinfo",
    "lib": ["ES2022", "DOM"]
  },
  "include": ["src"],
  "references": [{ "path": "../account" }, { "path": "../contract" }, { "path": "../protocol" }]
}
```

`packages/adapter-browser/src/index.ts`: `export {};`

- [ ] **Step 5: App skeletons.** `apps/passport-service/package.json`:

```json
{
  "name": "passport-service",
  "private": true,
  "type": "module",
  "scripts": {
    "start": "../../experiments/acc-0.35/guard.sh && tsx src/main.ts",
    "test": "node --import tsx --test test/*.test.ts"
  },
  "devDependencies": { "@types/node": "22.20.1", "tsx": "4.23.15" }
}
```

`apps/passport-service/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "composite": false, "noEmit": true, "types": ["node"], "allowImportingTsExtensions": true },
  "include": ["src", "test"]
}
```

`apps/passport-dapp/package.json`:

```json
{
  "name": "passport-dapp",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "../../experiments/acc-0.35/guard.sh && vite",
    "e2e": "../../experiments/acc-0.35/guard.sh && node --import tsx e2e/mvp.e2e.ts"
  },
  "dependencies": {
    "@midnight-ntwrk/compact-runtime": "0.20.0",
    "@midnight-ntwrk/mn-passport-account": "workspace:*",
    "@midnight-ntwrk/mn-passport-adapter-browser": "workspace:*",
    "@midnight-ntwrk/mn-passport-protocol": "workspace:*",
    "@midnightntwrk/wallet-sdk-facade": "5.0.0-rc.0",
    "buffer": "6.0.3"
  },
  "devDependencies": { "@types/node": "22.20.1", "tsx": "4.23.15", "vite": "8.3.1", "vite-plugin-wasm": "3.6.0" }
}
```

`apps/passport-dapp/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "composite": false, "noEmit": true, "lib": ["ES2022", "DOM"], "types": ["node", "vite/client"],
    "moduleResolution": "Bundler", "module": "ESNext", "allowImportingTsExtensions": true
  },
  "include": ["src", "e2e", "vite.config.ts"]
}
```

- [ ] **Step 6: Build wiring.** Add to `tsconfig.build.json` `references`: `{ "path": "./packages/account" }` and `{ "path": "./packages/adapter-browser" }`. Add root scripts in `package.json`:

```json
    "test:apps": "pnpm --filter passport-service test",
    "prototype:service": "pnpm --filter passport-service start",
    "prototype:dapp": "pnpm --filter passport-dapp dev",
    "prototype:e2e": "pnpm --filter passport-dapp e2e"
```

- [ ] **Step 7: Install and run the existing gate.**

Run: `nix develop -c bash -c 'pnpm install && pnpm test && pnpm run lint && pnpm run format:check'`
Expected: install succeeds with no cooldown refusal; `tests/dependency-rules.test.mjs` passes (both new packages are in the graph, named, private, `0.0.0`, ESM); lint prints `Dependency boundaries respected`.

- [ ] **Step 8: Commit.**

```bash
git add pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.build.json scripts/dependency-graph.mjs scripts/lint-boundaries.mjs \
  packages/account packages/adapter-browser apps/passport-service/package.json apps/passport-service/tsconfig.json \
  apps/passport-dapp/package.json apps/passport-dapp/tsconfig.json
git commit -S -s -m "build(prototype): scaffold the account, adapter-browser, service and dapp workspaces

Assisted-by: AI"
```

---

### Task 2: Prototype connector types in `protocol`

**Files:**
- Create: `packages/protocol/src/connector.ts`
- Modify: `packages/protocol/src/index.ts`
- Test: `tests/protocol-connector.test.mjs`

**Interfaces:**
- Produces (exact names later tasks import): `PASSPORT_CONNECTOR_VERSION`, `PASSPORT_ERROR_TYPE`, `PASSPORT_NETWORK_UNDEPLOYED`, `PASSPORT_ERROR_CODES`, types `PassportConnectorAPI`, `PassportConnectorDescriptor`, `CreateAccountOptions`, `CreateAccountStep`, `PassportAccount`, `PassportAccountState`, `PassportTxResult`, `PassportErrorCode`, `PassportErrorShape`.

- [ ] **Step 1: Write the failing test** `tests/protocol-connector.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';

const p = await import(new URL('../packages/protocol/dist/index.js', import.meta.url).href);

test('the connector version and error vocabulary are fixed constants', () => {
  assert.equal(p.PASSPORT_CONNECTOR_VERSION, '0.1.0-prototype');
  assert.equal(p.PASSPORT_ERROR_TYPE, 'PassportConnectorError');
  assert.equal(p.PASSPORT_NETWORK_UNDEPLOYED, 'undeployed');
  assert.deepEqual([...p.PASSPORT_ERROR_CODES].sort(), [
    'AccountNotFound', 'ArtefactIntegrity', 'InternalError', 'NetworkMismatch',
    'ProverUnavailable', 'SponsorRejected', 'UnsupportedAuthenticator', 'UserCancelled',
  ]);
  assert.ok(Object.isFrozen(p.PASSPORT_ERROR_CODES));
});
```

- [ ] **Step 2: Run it.** Run: `nix develop -c pnpm test`. Expected: FAIL, `PASSPORT_CONNECTOR_VERSION` is undefined.

- [ ] **Step 3: Implement** `packages/protocol/src/connector.ts`:

```ts
// Prototype Midnight Passport DApp Connector API (spec §4.1). Types and
// constants only, as everything in protocol: the implementation is
// mn-passport-account's, and a wallet (lace-sdk) exposes it to dApps.

export const PASSPORT_CONNECTOR_VERSION = '0.1.0-prototype';
export const PASSPORT_ERROR_TYPE = 'PassportConnectorError';
export const PASSPORT_NETWORK_UNDEPLOYED = 'undeployed';

export const PASSPORT_ERROR_CODES = Object.freeze([
  'UserCancelled',
  'UnsupportedAuthenticator',
  'AccountNotFound',
  'ArtefactIntegrity',
  'ProverUnavailable',
  'SponsorRejected',
  'NetworkMismatch',
  'InternalError',
] as const);

export type PassportErrorCode = (typeof PASSPORT_ERROR_CODES)[number];

/** The shape every connector error has; discriminate on `type` and `code`. */
export interface PassportErrorShape extends Error {
  readonly type: typeof PASSPORT_ERROR_TYPE;
  readonly code: PassportErrorCode;
}

export type CreateAccountStep = 'passkey-created' | 'deploying' | 'deployed' | 'activating' | 'active';

export interface CreateAccountOptions {
  readonly userName: string;
  readonly onProgress?: (step: CreateAccountStep) => void;
}

export interface PassportTxResult {
  readonly txHash: string;
  readonly blockHeight?: number;
}

export interface PassportAccountState {
  readonly booted: boolean;
  readonly authNonce: bigint;
  readonly deviceEpoch: bigint;
  /** Entries in the device set; not a device count (erratum 8). */
  readonly entryCount: number;
  readonly specVersion: number;
}

export interface PassportAccount {
  readonly address: string;
  readonly networkId: string;
  /** The artefact build the account was deployed from, e.g. 'acc-45721e1'. */
  readonly bindingId: string;
  state(): Promise<PassportAccountState>;
  /** MVP passkey-authorised call: rotates the account's encryption key. */
  rotateEncryptionKey(newKey: Uint8Array): Promise<PassportTxResult>;
}

export interface PassportConnectorAPI {
  readonly apiVersion: typeof PASSPORT_CONNECTOR_VERSION;
  readonly networkId: string;
  createAccount(options: CreateAccountOptions): Promise<PassportAccount>;
  openAccount(): Promise<PassportAccount>;
}

/** What a wallet injects at `window.midnight.passport`. */
export interface PassportConnectorDescriptor {
  readonly name: string;
  readonly apiVersion: typeof PASSPORT_CONNECTOR_VERSION;
  connect(networkId: string): Promise<PassportConnectorAPI>;
}
```

Replace `packages/protocol/src/index.ts` with:

```ts
export * from './connector.js';
```

- [ ] **Step 4: Run it.** Run: `nix develop -c pnpm test`. Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add packages/protocol/src/connector.ts packages/protocol/src/index.ts tests/protocol-connector.test.mjs
git commit -S -s -m "feat(protocol): prototype Passport DApp Connector API types

Assisted-by: AI"
```

---

### Task 3: `account` errors, codec and registry client

**Files:**
- Create: `packages/account/src/errors.ts`, `packages/account/src/codec.ts`, `packages/account/src/registry-client.ts`, `packages/account/src/seams.ts`
- Modify: `packages/account/src/index.ts`
- Test: `tests/account-registry.test.mjs`

**Interfaces:**
- Consumes: `PassportErrorCode`, `PASSPORT_ERROR_TYPE` from Task 2.
- Produces:
  - `class PassportConnectorError extends Error { type; code; cause? }`, `isPassportError(e: unknown): e is PassportConnectorError`, `toPassportError(e: unknown): PassportConnectorError`
  - `toHex(b: Uint8Array): string`, `fromHex(s: string): Uint8Array`
  - `interface FetchLike`, `createRegistryClient(baseUrl: string, fetchFn: FetchLike): RegistrySeam`
  - seam types in `seams.ts`: `P256PublicKey`, `WebAuthnPolicy`, `PasskeyCredential`, `PasskeySignature`, `PasskeySeam`, `AccountRecord`, `RegistrySeam`, `AccLedgerView`, `ConstructorArgs`, `ChainSeam`, `AccPureCircuits`, `PassportSeams`

- [ ] **Step 1: Write the seam types** `packages/account/src/seams.ts` (no logic, no test of its own):

```ts
import type { PassportTxResult } from '@midnight-ntwrk/mn-passport-protocol';

export interface P256PublicKey { readonly x: bigint; readonly y: bigint; readonly identity: false }
/** WebAuthn binding the contract enrols: SHA-256 of the RP id, and the 21-byte origin. */
export interface WebAuthnPolicy { readonly rp_id_hash: Uint8Array; readonly origin: Uint8Array }

export interface PasskeyCredential {
  readonly credentialId: Uint8Array;
  readonly publicKey: P256PublicKey;
  readonly policy: WebAuthnPolicy;
}
/** The signed material the P-256 arm consumes; validated client-side by the adapter. */
export interface PasskeySignature {
  readonly authenticator_data: Uint8Array;
  readonly sig: { readonly r: bigint; readonly s: bigint };
}
export interface PasskeySeam {
  create(userName: string): Promise<PasskeyCredential>;
  /** Discoverable-credential prompt: which credential the user picked. */
  identify(): Promise<{ readonly credentialId: Uint8Array }>;
  sign(credential: PasskeyCredential, challenge: Uint8Array): Promise<PasskeySignature>;
}

export type AccountStatus = 'deployed' | 'active';
export interface AccountRecord {
  readonly credentialId: Uint8Array;
  readonly address: string;
  readonly publicKey: P256PublicKey;
  readonly policy: WebAuthnPolicy;
  /** Opens the boot commitment; needed to activate a deployed account. */
  readonly salt: Uint8Array;
  readonly status: AccountStatus;
}
export interface RegistrySeam {
  put(networkId: string, record: AccountRecord): Promise<void>;
  get(networkId: string, credentialId: Uint8Array): Promise<AccountRecord | undefined>;
}

/** The ledger facts the MVP flows read (spec §5). */
export interface AccLedgerView {
  readonly booted: boolean;
  readonly authNonce: bigint;
  readonly deviceEpoch: bigint;
  readonly entryCount: number;
  readonly specVersion: number;
  hasEntry(entry: Uint8Array): boolean;
}
export interface ConstructorArgs { readonly boot: Uint8Array; readonly encKey: Uint8Array }
export type MvpCircuit = 'activate_initial_device_with_p256' | 'rotate_enc_key_with_p256';
export interface ChainSeam {
  deploy(args: ConstructorArgs): Promise<{ readonly address: string; readonly txHashes: readonly string[] }>;
  readLedger(address: string): Promise<AccLedgerView | undefined>;
  call(address: string, circuit: MvpCircuit, args: readonly unknown[]): Promise<PassportTxResult>;
}

type ContractAddressArg = { readonly bytes: Uint8Array };
/** The subset of the generated module's pure circuits the MVP calls (Compact runs them in JS). */
export interface AccPureCircuits {
  derive_boot_commitment_with_p256(salt: Uint8Array, pk: P256PublicKey, policy: WebAuthnPolicy): Uint8Array;
  derive_device_entry_with_p256(
    self: ContractAddressArg, pk: P256PublicKey, policy: WebAuthnPolicy, epoch: bigint, counter: bigint,
  ): Uint8Array;
  challenge_rotate_enc_key_with_p256(
    self: ContractAddressArg, pk: P256PublicKey, key: Uint8Array, nonce: bigint,
  ): Uint8Array;
}

export interface PassportSeams {
  readonly networkId: string;
  readonly bindingId: string;
  readonly pureCircuits: AccPureCircuits;
  readonly passkey: PasskeySeam;
  readonly chain: ChainSeam;
  readonly registry: RegistrySeam;
  /** Cryptographically secure random bytes. */
  random(length: number): Uint8Array;
  /** A fresh X25519 public key for the account's inbox (MVP keeps no inbox). */
  encryptionKey(): Uint8Array;
}
```

- [ ] **Step 2: Write the failing test** `tests/account-registry.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';

const a = await import(new URL('../packages/account/dist/index.js', import.meta.url).href);

const record = {
  credentialId: Uint8Array.of(1, 2, 3),
  address: 'ab'.repeat(32),
  publicKey: { x: 5n, y: 7n, identity: false },
  policy: { rp_id_hash: new Uint8Array(32).fill(9), origin: new TextEncoder().encode('http://localhost:5173') },
  salt: new Uint8Array(32).fill(4),
  status: 'deployed',
};

function fakeFetch() {
  const store = new Map();
  const calls = [];
  const fn = async (url, init = {}) => {
    calls.push({ url, method: init.method ?? 'GET' });
    const key = new URL(url).pathname;
    if ((init.method ?? 'GET') === 'PUT') { store.set(key, init.body); return { ok: true, status: 204, json: async () => ({}) }; }
    if (!store.has(key)) return { ok: false, status: 404, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => JSON.parse(store.get(key)) };
  };
  return { fn, calls };
}

test('hex round-trips', () => {
  assert.deepEqual(a.fromHex(a.toHex(Uint8Array.of(0, 255, 16))), Uint8Array.of(0, 255, 16));
  assert.throws(() => a.fromHex('abc'), /hex/);
});

test('the registry client round-trips a record under its network and credential id', async () => {
  const { fn, calls } = fakeFetch();
  const reg = a.createRegistryClient('http://svc', fn);
  await reg.put('undeployed', record);
  const back = await reg.get('undeployed', record.credentialId);
  assert.deepEqual(back, record);
  assert.equal(calls[0].url, 'http://svc/accounts/undeployed/010203');
});

test('an unknown credential is undefined, not an error', async () => {
  const reg = a.createRegistryClient('http://svc', fakeFetch().fn);
  assert.equal(await reg.get('undeployed', Uint8Array.of(9)), undefined);
});

test('errors are typed and WebAuthn cancellation maps to UserCancelled', () => {
  const e = a.toPassportError(Object.assign(new Error('x'), { name: 'NotAllowedError' }));
  assert.equal(e.code, 'UserCancelled');
  assert.equal(e.type, 'PassportConnectorError');
  assert.ok(a.isPassportError(e));
  assert.equal(a.toPassportError(new Error('boom')).code, 'InternalError');
  const kept = new a.PassportConnectorError('NetworkMismatch', 'n');
  assert.equal(a.toPassportError(kept), kept);
});
```

- [ ] **Step 3: Run it.** Run: `nix develop -c pnpm test`. Expected: FAIL, `fromHex` is not a function.

- [ ] **Step 4: Implement.** `packages/account/src/codec.ts`:

```ts
export function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function fromHex(text: string): Uint8Array {
  const clean = text.startsWith('0x') ? text.slice(2) : text;
  if (clean.length % 2 !== 0 || !/^[0-9a-f]*$/i.test(clean)) throw new Error(`invalid hex: ${text.slice(0, 16)}…`);
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(clean.slice(2 * i, 2 * i + 2), 16);
  return out;
}
```

`packages/account/src/errors.ts`:

```ts
import { PASSPORT_ERROR_TYPE, type PassportErrorCode, type PassportErrorShape } from '@midnight-ntwrk/mn-passport-protocol';

export class PassportConnectorError extends Error implements PassportErrorShape {
  override readonly name = 'PassportConnectorError';
  readonly type = PASSPORT_ERROR_TYPE;
  constructor(readonly code: PassportErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
  }
}

export function isPassportError(e: unknown): e is PassportConnectorError {
  return e instanceof PassportConnectorError;
}

/** Maps any thrown value to the connector taxonomy (spec §6). */
export function toPassportError(e: unknown): PassportConnectorError {
  if (isPassportError(e)) return e;
  const name = e instanceof Error ? e.name : '';
  const message = e instanceof Error ? e.message : String(e);
  if (name === 'NotAllowedError' || name === 'AbortError') {
    return new PassportConnectorError('UserCancelled', 'The passkey prompt was cancelled.', { cause: e });
  }
  if (name === 'ZkArtifactIntegrityError') {
    return new PassportConnectorError('ArtefactIntegrity', message, { cause: e });
  }
  return new PassportConnectorError('InternalError', message, { cause: e });
}
```

`packages/account/src/registry-client.ts`:

```ts
import { fromHex, toHex } from './codec.js';
import type { AccountRecord, RegistrySeam } from './seams.js';

/** Structural fetch: the package compiles without DOM or Node types. */
export type FetchLike = (
  url: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string },
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

interface WireRecord {
  credentialId: string; address: string; publicKey: { x: string; y: string };
  policy: { rp_id_hash: string; origin: string }; salt: string; status: AccountRecord['status'];
}

const toWire = (r: AccountRecord): WireRecord => ({
  credentialId: toHex(r.credentialId),
  address: r.address,
  publicKey: { x: r.publicKey.x.toString(16), y: r.publicKey.y.toString(16) },
  policy: { rp_id_hash: toHex(r.policy.rp_id_hash), origin: toHex(r.policy.origin) },
  salt: toHex(r.salt),
  status: r.status,
});

const fromWire = (w: WireRecord): AccountRecord => ({
  credentialId: fromHex(w.credentialId),
  address: w.address,
  publicKey: { x: BigInt(`0x${w.publicKey.x}`), y: BigInt(`0x${w.publicKey.y}`), identity: false },
  policy: { rp_id_hash: fromHex(w.policy.rp_id_hash), origin: fromHex(w.policy.origin) },
  salt: fromHex(w.salt),
  status: w.status,
});

export function createRegistryClient(baseUrl: string, fetchFn: FetchLike): RegistrySeam {
  const url = (networkId: string, credentialId: Uint8Array) =>
    `${baseUrl}/accounts/${encodeURIComponent(networkId)}/${toHex(credentialId)}`;
  return {
    async put(networkId, record) {
      const res = await fetchFn(url(networkId, record.credentialId), {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(toWire(record)),
      });
      if (!res.ok) throw new Error(`registry PUT failed: ${res.status}`);
    },
    async get(networkId, credentialId) {
      const res = await fetchFn(url(networkId, credentialId));
      if (res.status === 404) return undefined;
      if (!res.ok) throw new Error(`registry GET failed: ${res.status}`);
      return fromWire((await res.json()) as WireRecord);
    },
  };
}
```

Replace `packages/account/src/index.ts`:

```ts
export * from './codec.js';
export * from './errors.js';
export * from './registry-client.js';
export type * from './seams.js';
```

- [ ] **Step 5: Run it.** Run: `nix develop -c bash -c 'pnpm test && pnpm run lint'`. Expected: PASS; lint clean (no `node:` imports in `account`).

- [ ] **Step 6: Commit.**

```bash
git add packages/account/src tests/account-registry.test.mjs
git commit -S -s -m "feat(account): connector errors, hex codec, seams and the registry client

Assisted-by: AI"
```

---

### Task 4: `account` connector flows (`createPassportConnector`)

**Files:**
- Create: `packages/account/src/connector.ts`
- Modify: `packages/account/src/index.ts`
- Test: `tests/account-connector.test.mjs`

**Interfaces:**
- Consumes: Task 3 seams and errors; Task 2 API types.
- Produces: `createPassportConnector(seams: PassportSeams): PassportConnectorAPI`; `RESCAN_LIMIT = 64`.

- [ ] **Step 1: Write the failing test** `tests/account-connector.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';

const a = await import(new URL('../packages/account/dist/index.js', import.meta.url).href);

const enc = (s) => new TextEncoder().encode(s);
const eq = (x, y) => x.length === y.length && x.every((v, i) => v === y[i]);
// Deterministic stand-ins for the generated module's pure circuits.
const pureCircuits = {
  derive_boot_commitment_with_p256: (salt, pk) => enc(`boot:${salt[0]}:${pk.x}`),
  derive_device_entry_with_p256: (self, pk, _p, epoch, counter) => enc(`entry:${pk.x}:${epoch}:${counter}`),
  challenge_rotate_enc_key_with_p256: (_self, pk, key, nonce) => enc(`rot:${pk.x}:${key[0]}:${nonce}`),
};

function world({ failActivationOnce = false } = {}) {
  const credential = { credentialId: Uint8Array.of(7), publicKey: { x: 11n, y: 13n, identity: false },
    policy: { rp_id_hash: new Uint8Array(32), origin: enc('http://localhost:5173') } };
  const ledger = { booted: false, authNonce: 0n, deviceEpoch: 0n, entries: [] };
  const registry = new Map();
  const log = [];
  let failNext = failActivationOnce;
  const chain = {
    async deploy(args) { log.push(['deploy', args.boot]); return { address: 'cd'.repeat(32), txHashes: ['t0'] }; },
    async readLedger() {
      return { booted: ledger.booted, authNonce: ledger.authNonce, deviceEpoch: ledger.deviceEpoch,
        entryCount: ledger.entries.length, specVersion: 2, hasEntry: (e) => ledger.entries.some((x) => eq(x, e)) };
    },
    async call(_addr, circuit, args) {
      log.push([circuit]);
      if (circuit === 'activate_initial_device_with_p256') {
        if (failNext) { failNext = false; throw new Error('sponsor down'); }
        ledger.booted = true;
        ledger.entries.push(pureCircuits.derive_device_entry_with_p256(null, args[0], null, 0n, 0n));
      } else {
        const auth = args[1];
        const current = pureCircuits.derive_device_entry_with_p256(null, auth.pk, null, 0n, auth.use_counter);
        assert.ok(ledger.entries.some((x) => eq(x, current)), 'signed with a live entry');
        ledger.entries = ledger.entries.filter((x) => !eq(x, current));
        ledger.entries.push(pureCircuits.derive_device_entry_with_p256(null, auth.pk, null, 0n, auth.use_counter + 1n));
        ledger.authNonce += 1n;
      }
      return { txHash: `tx-${log.length}` };
    },
  };
  const seams = {
    networkId: 'undeployed', bindingId: 'acc-45721e1', pureCircuits, chain,
    passkey: {
      create: async () => credential,
      identify: async () => ({ credentialId: credential.credentialId }),
      sign: async (_c, challenge) => { log.push(['sign', new TextDecoder().decode(challenge)]); return { authenticator_data: new Uint8Array(37), sig: { r: 1n, s: 2n } }; },
    },
    registry: {
      put: async (n, r) => registry.set(`${n}/${r.credentialId}`, r),
      get: async (n, id) => registry.get(`${n}/${id}`),
    },
    random: (n) => new Uint8Array(n).fill(3),
    encryptionKey: () => new Uint8Array(32).fill(5),
  };
  return { seams, ledger, registry, log };
}

test('createAccount deploys, activates, records, and reports progress in order', async () => {
  const w = world();
  const steps = [];
  const account = await a.createPassportConnector(w.seams).createAccount({ userName: 'u', onProgress: (s) => steps.push(s) });
  assert.deepEqual(steps, ['passkey-created', 'deploying', 'deployed', 'activating', 'active']);
  assert.equal(account.address, 'cd'.repeat(32));
  assert.equal([...w.registry.values()][0].status, 'active');
  assert.equal((await account.state()).booted, true);
});

test('rotate twice: the second call rescans the rolled use counter', async () => {
  const w = world();
  const account = await a.createPassportConnector(w.seams).createAccount({ userName: 'u' });
  await account.rotateEncryptionKey(Uint8Array.of(1));
  await account.rotateEncryptionKey(Uint8Array.of(2));
  assert.deepEqual(w.log.filter((l) => l[0] === 'sign').map((l) => l[1]), ['rot:11:1:0', 'rot:11:2:1']);
});

test('openAccount after a reload reopens the same account and can still rotate', async () => {
  const w = world();
  const first = await a.createPassportConnector(w.seams).createAccount({ userName: 'u' });
  await first.rotateEncryptionKey(Uint8Array.of(1));
  const reopened = await a.createPassportConnector(w.seams).openAccount();
  assert.equal(reopened.address, first.address);
  await reopened.rotateEncryptionKey(Uint8Array.of(3));
});

test('a failure after deploy leaves a deployed record that openAccount finishes', async () => {
  const w = world({ failActivationOnce: true });
  await assert.rejects(a.createPassportConnector(w.seams).createAccount({ userName: 'u' }));
  assert.equal([...w.registry.values()][0].status, 'deployed');
  const account = await a.createPassportConnector(w.seams).openAccount();
  assert.equal((await account.state()).booted, true);
  assert.equal([...w.registry.values()][0].status, 'active');
  assert.equal(w.log.filter((l) => l[0] === 'deploy').length, 1, 'never redeploys');
});

test('openAccount without a record is AccountNotFound', async () => {
  const w = world();
  await assert.rejects(a.createPassportConnector(w.seams).openAccount(), { code: 'AccountNotFound' });
});
```

- [ ] **Step 2: Run it.** Run: `nix develop -c pnpm test`. Expected: FAIL, `createPassportConnector` is not a function.

- [ ] **Step 3: Implement** `packages/account/src/connector.ts`:

```ts
import {
  PASSPORT_CONNECTOR_VERSION,
  type PassportAccount,
  type PassportConnectorAPI,
} from '@midnight-ntwrk/mn-passport-protocol';
import { fromHex } from './codec.js';
import { PassportConnectorError, toPassportError } from './errors.js';
import type { AccountRecord, PassportSeams } from './seams.js';

/** How many use counters past the last known one the rescan probes (MIP-0013 S11). */
export const RESCAN_LIMIT = 64;

export function createPassportConnector(seams: PassportSeams): PassportConnectorAPI {
  const { chain, passkey, registry, pureCircuits, networkId } = seams;

  const activate = async (record: AccountRecord): Promise<AccountRecord> => {
    await chain.call(record.address, 'activate_initial_device_with_p256', [record.publicKey, record.salt, record.policy]);
    const active: AccountRecord = { ...record, status: 'active' };
    await registry.put(networkId, active);
    return active;
  };

  const useCounter = async (record: AccountRecord): Promise<{ counter: bigint; authNonce: bigint }> => {
    const view = await chain.readLedger(record.address);
    if (!view) throw new PassportConnectorError('AccountNotFound', `No contract at ${record.address}.`);
    const self = { bytes: fromHex(record.address) };
    for (let k = 0n; k < BigInt(RESCAN_LIMIT); k++) {
      const entry = pureCircuits.derive_device_entry_with_p256(self, record.publicKey, record.policy, view.deviceEpoch, k);
      if (view.hasEntry(entry)) return { counter: k, authNonce: view.authNonce };
    }
    throw new PassportConnectorError('AccountNotFound', 'This passkey has no live entry on the account.');
  };

  const account = (record: AccountRecord): PassportAccount => ({
    address: record.address,
    networkId,
    bindingId: seams.bindingId,
    async state() {
      const view = await chain.readLedger(record.address);
      if (!view) throw new PassportConnectorError('AccountNotFound', `No contract at ${record.address}.`);
      return {
        booted: view.booted, authNonce: view.authNonce, deviceEpoch: view.deviceEpoch,
        entryCount: view.entryCount, specVersion: view.specVersion,
      };
    },
    async rotateEncryptionKey(newKey) {
      try {
        const { counter, authNonce } = await useCounter(record);
        const self = { bytes: fromHex(record.address) };
        const challenge = pureCircuits.challenge_rotate_enc_key_with_p256(self, record.publicKey, newKey, authNonce);
        const credential = { credentialId: record.credentialId, publicKey: record.publicKey, policy: record.policy };
        const signed = await passkey.sign(credential, challenge);
        const auth = { pk: record.publicKey, policy: record.policy, ...signed, use_counter: counter };
        return await chain.call(record.address, 'rotate_enc_key_with_p256', [newKey, auth]);
      } catch (e) {
        throw toPassportError(e);
      }
    },
  });

  return {
    apiVersion: PASSPORT_CONNECTOR_VERSION,
    networkId,
    async createAccount({ userName, onProgress }) {
      try {
        const credential = await passkey.create(userName);
        onProgress?.('passkey-created');
        const salt = seams.random(32);
        const boot = pureCircuits.derive_boot_commitment_with_p256(salt, credential.publicKey, credential.policy);
        onProgress?.('deploying');
        const { address } = await chain.deploy({ boot, encKey: seams.encryptionKey() });
        const deployed: AccountRecord = { ...credential, address, salt, status: 'deployed' };
        // Recorded before activation: the salt is the only way to activate (Review Focus 2).
        await registry.put(networkId, deployed);
        onProgress?.('deployed');
        onProgress?.('activating');
        const active = await activate(deployed);
        onProgress?.('active');
        return account(active);
      } catch (e) {
        throw toPassportError(e);
      }
    },
    async openAccount() {
      try {
        const { credentialId } = await passkey.identify();
        const record = await registry.get(networkId, credentialId);
        if (!record) throw new PassportConnectorError('AccountNotFound', 'No Passport account for this passkey on this network.');
        return account(record.status === 'active' ? record : await activate(record));
      } catch (e) {
        throw toPassportError(e);
      }
    },
  };
}
```

Append to `packages/account/src/index.ts`:

```ts
export * from './connector.js';
```

- [ ] **Step 4: Run it.** Run: `nix develop -c bash -c 'pnpm test && pnpm run lint'`. Expected: PASS, including "rotate twice" and "failure after deploy".

- [ ] **Step 5: Commit.**

```bash
git add packages/account/src/connector.ts packages/account/src/index.ts tests/account-connector.test.mjs
git commit -S -s -m "feat(account): create, open and rotate flows behind injected seams

Assisted-by: AI"
```

---

### Task 5: Service core — configuration, artefact check, `/config`, `/zk`

**Files:**
- Create: `apps/passport-service/src/config.ts`, `apps/passport-service/src/artefacts.ts`, `apps/passport-service/src/http.ts`, `apps/passport-service/src/routes/zk.ts`, `apps/passport-service/src/server.ts`
- Test: `apps/passport-service/test/zk.test.ts`, `apps/passport-service/test/fixtures.ts`

**Interfaces:**
- Produces:
  - `interface ServiceConfig { port; corsOrigin; networkId; bindingId; contractDir; artefactDir; manifestSha256; indexerUri; indexerWsUri; nodeUri; proofServerUri; registryFile; sponsorSeed }`, `loadConfig(env: NodeJS.ProcessEnv): ServiceConfig`
  - `verifyArtefacts(dir: string, manifestSha256: string): void` (throws on mismatch)
  - `type Route = (req, res, url: URL) => Promise<boolean>`; `json(res, status, body)`; `readJson(req): Promise<unknown>`
  - `createServer(config: ServiceConfig, routes: Route[]): http.Server`
  - `zkRoute(config): Route`, `configRoute(config, extra: () => Record<string, unknown>): Route`

- [ ] **Step 1: Test fixtures** `apps/passport-service/test/fixtures.ts`:

```ts
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ServiceConfig } from '../src/config.ts';

/** A tiny artefact tree with a valid compiler manifest. */
export function fakeArtefacts(): { dir: string; manifestSha256: string } {
  const dir = mkdtempSync(join(tmpdir(), 'acc-art-'));
  const files: Record<string, Uint8Array> = {
    'zkir/c.bzkir': Uint8Array.of(1, 2),
    'keys/c.verifier': Uint8Array.of(3),
    'keys/c.prover': Uint8Array.of(4, 5, 6),
    'compiler/contract-info.json': new TextEncoder().encode('{"circuits":[]}'),
  };
  const node = (rel: string, bytes: Uint8Array) => ({ type: 'file', size: bytes.length, hash: createHash('sha256').update(bytes).digest('hex') });
  const tree: Record<string, unknown> = { 'manifest-version': '1' };
  for (const [rel, bytes] of Object.entries(files)) {
    mkdirSync(join(dir, rel, '..'), { recursive: true });
    writeFileSync(join(dir, rel), bytes);
    const [folder, name] = rel.split('/') as [string, string];
    const sub = (tree[folder] ??= { type: 'directory' }) as Record<string, unknown>;
    sub[name] = node(rel, bytes);
  }
  const manifest = JSON.stringify(tree);
  writeFileSync(join(dir, 'compiler/contract-manifest.json'), manifest);
  return { dir, manifestSha256: createHash('sha256').update(manifest).digest('hex') };
}

export function testConfig(over: Partial<ServiceConfig> = {}): ServiceConfig {
  const { dir, manifestSha256 } = fakeArtefacts();
  return {
    port: 0, corsOrigin: 'http://localhost:5173', networkId: 'undeployed', bindingId: 'acc-test',
    contractDir: dir, artefactDir: dir, manifestSha256, indexerUri: 'http://i', indexerWsUri: 'ws://i',
    nodeUri: 'http://n', proofServerUri: 'http://p', registryFile: join(dir, 'registry.json'), sponsorSeed: '00'.repeat(32),
    ...over,
  };
}
```

- [ ] **Step 2: Write the failing test** `apps/passport-service/test/zk.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { createServer } from '../src/server.ts';
import { configRoute, zkRoute } from '../src/routes/zk.ts';
import { verifyArtefacts } from '../src/artefacts.ts';
import { testConfig } from './fixtures.ts';

async function start(config = testConfig()) {
  const server = createServer(config, [configRoute(config, () => ({})), zkRoute(config)]);
  await new Promise<void>((r) => server.listen(0, r));
  const base = `http://localhost:${(server.address() as AddressInfo).port}`;
  return { base, server, config };
}

test('the artefact check accepts a matching tree and refuses a tampered one', () => {
  const c = testConfig();
  verifyArtefacts(c.artefactDir, c.manifestSha256);
  assert.throws(() => verifyArtefacts(c.artefactDir, '0'.repeat(64)), /manifest/);
  writeFileSync(join(c.artefactDir, 'keys/c.verifier'), Uint8Array.of(9));
  assert.throws(() => verifyArtefacts(c.artefactDir, c.manifestSha256), /keys\/c\.verifier/);
});

test('/zk serves artefact files as octet-stream with CORS and cache headers', async () => {
  const { base, server } = await start();
  const res = await fetch(`${base}/zk/acc/keys/c.verifier`, { headers: { origin: 'http://localhost:5173' } });
  assert.equal(res.status, 200);
  assert.deepEqual(new Uint8Array(await res.arrayBuffer()), Uint8Array.of(3));
  assert.equal(res.headers.get('content-type'), 'application/octet-stream');
  assert.equal(res.headers.get('access-control-allow-origin'), 'http://localhost:5173');
  assert.match(res.headers.get('cache-control') ?? '', /immutable/);
  const manifest = await fetch(`${base}/zk/acc/compiler/contract-manifest.json`);
  assert.equal(manifest.headers.get('cache-control'), 'no-cache');
  server.close();
});

test('/zk refuses path traversal and unknown files with 404', async () => {
  const { base, server } = await start();
  for (const p of ['/zk/acc/../registry.json', '/zk/acc/%2e%2e/registry.json', '/zk/acc/keys/missing.prover', '/zk/acc/']) {
    assert.equal((await fetch(base + p)).status, 404, p);
  }
  server.close();
});

test('/config reports the network, binding and pinned manifest', async () => {
  const { base, server, config } = await start();
  const body = (await (await fetch(`${base}/config`)).json()) as Record<string, string>;
  assert.equal(body.networkId, 'undeployed');
  assert.equal(body.manifestSha256, config.manifestSha256);
  assert.equal(body.zkBaseUrl, `${base}/zk/acc`);
  server.close();
});
```

- [ ] **Step 3: Run it.** Run: `nix develop -c pnpm run test:apps`. Expected: FAIL, cannot find `../src/server.ts`.

- [ ] **Step 4: Implement.** `apps/passport-service/src/config.ts`:

```ts
export interface ServiceConfig {
  readonly port: number;
  readonly corsOrigin: string;
  readonly networkId: string;
  readonly bindingId: string;
  /** The fetched contract tree (fetch-acc.sh output): reference client and node_modules. */
  readonly contractDir: string;
  /** contracts/managed/account inside contractDir. */
  readonly artefactDir: string;
  readonly manifestSha256: string;
  readonly indexerUri: string;
  readonly indexerWsUri: string;
  readonly nodeUri: string;
  readonly proofServerUri: string;
  readonly registryFile: string;
  /** Hex wallet seed of the fee sponsor; never sent to a client. */
  readonly sponsorSeed: string;
}

const need = (env: NodeJS.ProcessEnv, key: string): string => {
  const v = env[key];
  if (!v) throw new Error(`passport-service: set ${key}`);
  return v;
};

export function loadConfig(env: NodeJS.ProcessEnv): ServiceConfig {
  const contractDir = need(env, 'PASSPORT_CONTRACT_DIR');
  return {
    port: Number(env.PASSPORT_SERVICE_PORT ?? '8787'),
    corsOrigin: env.PASSPORT_DAPP_ORIGIN ?? 'http://localhost:5173',
    networkId: env.PASSPORT_NETWORK_ID ?? 'undeployed',
    bindingId: env.PASSPORT_BINDING_ID ?? 'acc-45721e1',
    contractDir,
    artefactDir: `${contractDir}/contracts/managed/account`,
    manifestSha256: need(env, 'PASSPORT_MANIFEST_SHA256'),
    indexerUri: env.PASSPORT_INDEXER_URI ?? 'http://localhost:8088/api/v4/graphql',
    indexerWsUri: env.PASSPORT_INDEXER_WS_URI ?? 'ws://localhost:8088/api/v4/graphql/ws',
    nodeUri: env.PASSPORT_NODE_URI ?? 'http://localhost:9944',
    proofServerUri: env.PASSPORT_PROOF_SERVER_URI ?? 'http://127.0.0.1:6300',
    registryFile: env.PASSPORT_REGISTRY_FILE ?? `${contractDir}/../passport-registry.json`,
    // The standalone network's genesis-funded dev seed; testnet replaces this with a real sponsor.
    sponsorSeed: env.PASSPORT_SPONSOR_SEED ?? '0000000000000000000000000000000000000000000000000000000000000001',
  };
}
```

`apps/passport-service/src/artefacts.ts`:

```ts
import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

type ManifestNode = { type: 'file'; size: number; hash: string } | { type: 'directory'; [name: string]: unknown };

const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

/** Fails closed unless the manifest hash and every listed file match (spec §6; Review Focus 3). */
export function verifyArtefacts(dir: string, manifestSha256: string): void {
  const manifestBytes = readFileSync(join(dir, 'compiler/contract-manifest.json'));
  if (sha256(manifestBytes) !== manifestSha256) throw new Error('artefact manifest hash does not match the pinned value');
  const walk = (node: Record<string, unknown>, prefix: string) => {
    for (const [name, value] of Object.entries(node)) {
      if (!value || typeof value !== 'object') continue;
      const entry = value as ManifestNode;
      const rel = `${prefix}${name}`;
      if (entry.type === 'file') {
        const path = join(dir, rel);
        if (statSync(path).size !== entry.size || sha256(readFileSync(path)) !== entry.hash) {
          throw new Error(`artefact ${rel} does not match the manifest`);
        }
      } else if (entry.type === 'directory') {
        walk(entry as Record<string, unknown>, `${rel}/`);
      }
    }
  };
  walk(JSON.parse(manifestBytes.toString('utf8')) as Record<string, unknown>, '');
}
```

> The manifest lists `contract/index.js.map`. If the artefact tree was built with a non-canonical invocation, that file and the manifest hash differ; rebuild with `compile.sh` (experiment X1).

`apps/passport-service/src/http.ts`:

```ts
import type { IncomingMessage, ServerResponse } from 'node:http';

export type Route = (req: IncomingMessage, res: ServerResponse, url: URL) => Promise<boolean>;

export function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body, (_k, v: unknown) => (typeof v === 'bigint' ? v.toString() : v)));
}

export async function readJson(req: IncomingMessage, limit = 8 * 1024 * 1024): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > limit) throw new Error('request body too large');
    chunks.push(chunk as Buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}
```

`apps/passport-service/src/server.ts`:

```ts
import { createServer as createHttpServer, type Server } from 'node:http';
import type { ServiceConfig } from './config.ts';
import { json, type Route } from './http.ts';

export function createServer(config: ServiceConfig, routes: Route[]): Server {
  return createHttpServer(async (req, res) => {
    res.setHeader('access-control-allow-origin', config.corsOrigin);
    res.setHeader('access-control-allow-headers', 'content-type');
    res.setHeader('access-control-allow-methods', 'GET, POST, PUT, OPTIONS');
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    try {
      for (const route of routes) if (await route(req, res, url)) return;
      json(res, 404, { error: 'not found' });
    } catch (e) {
      json(res, 500, { error: e instanceof Error ? e.message : String(e) });
    }
  });
}
```

`apps/passport-service/src/routes/zk.ts`:

```ts
import { createReadStream, statSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import type { ServiceConfig } from '../config.ts';
import { json, type Route } from '../http.ts';

const PREFIX = '/zk/acc/';

export function zkRoute(config: ServiceConfig): Route {
  const root = resolve(config.artefactDir);
  return async (req, res, url) => {
    if (req.method !== 'GET' || !url.pathname.startsWith(PREFIX)) return false;
    let rel: string;
    try { rel = decodeURIComponent(url.pathname.slice(PREFIX.length)); } catch { json(res, 404, { error: 'not found' }); return true; }
    const path = resolve(root, rel);
    const inside = path.startsWith(`${root}${sep}`);
    const file = inside ? statSync(path, { throwIfNoEntry: false }) : undefined;
    if (!file?.isFile()) { json(res, 404, { error: 'not found' }); return true; }
    res.writeHead(200, {
      'content-type': 'application/octet-stream',
      'content-length': file.size,
      'cache-control': rel.endsWith('contract-manifest.json') ? 'no-cache' : 'public, max-age=31536000, immutable',
    });
    createReadStream(path).pipe(res);
    return true;
  };
}

export function configRoute(config: ServiceConfig, extra: () => Record<string, unknown>): Route {
  return async (req, res, url) => {
    if (req.method !== 'GET' || url.pathname !== '/config') return false;
    json(res, 200, {
      networkId: config.networkId, bindingId: config.bindingId, manifestSha256: config.manifestSha256,
      indexerUri: config.indexerUri, indexerWsUri: config.indexerWsUri, nodeUri: config.nodeUri,
      zkBaseUrl: `http://${req.headers.host}/zk/acc`, ...extra(),
    });
    return true;
  };
}
```

- [ ] **Step 5: Run it.** Run: `nix develop -c pnpm run test:apps`. Expected: PASS, 4 tests.

- [ ] **Step 6: Commit.**

```bash
git add apps/passport-service/src apps/passport-service/test
git commit -S -s -m "feat(service): artefact check, /config and the /zk artefact host

Assisted-by: AI"
```

---

### Task 6: Service account registry

**Files:**
- Create: `apps/passport-service/src/routes/registry.ts`
- Test: `apps/passport-service/test/registry.test.ts`

**Interfaces:**
- Consumes: `Route`, `json`, `readJson`, `ServiceConfig` (Task 5); the wire record shape of Task 3's `registry-client.ts`.
- Produces: `registryRoute(config): Route` serving `PUT/GET /accounts/{networkId}/{credentialIdHex}`.

- [ ] **Step 1: Write the failing test** `apps/passport-service/test/registry.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { createServer } from '../src/server.ts';
import { registryRoute } from '../src/routes/registry.ts';
import { testConfig } from './fixtures.ts';

const record = {
  credentialId: '0a0b', address: 'ab'.repeat(32), publicKey: { x: '5', y: '7' },
  policy: { rp_id_hash: '00'.repeat(32), origin: '68'.repeat(21) }, salt: '04'.repeat(32), status: 'deployed',
};

async function start(config = testConfig()) {
  const server = createServer(config, [registryRoute(config)]);
  await new Promise<void>((r) => server.listen(0, r));
  return { base: `http://localhost:${(server.address() as AddressInfo).port}`, server, config };
}

test('PUT then GET returns the record, keyed by network and credential', async () => {
  const { base, server } = await start();
  const put = await fetch(`${base}/accounts/undeployed/0a0b`, { method: 'PUT', body: JSON.stringify(record) });
  assert.equal(put.status, 204);
  assert.deepEqual(await (await fetch(`${base}/accounts/undeployed/0a0b`)).json(), record);
  assert.equal((await fetch(`${base}/accounts/testnet/0a0b`)).status, 404, 'network-bound');
  server.close();
});

test('records survive a restart', async () => {
  const first = await start();
  await fetch(`${first.base}/accounts/undeployed/0a0b`, { method: 'PUT', body: JSON.stringify(record) });
  first.server.close();
  const second = await start(first.config);
  assert.equal((await fetch(`${second.base}/accounts/undeployed/0a0b`)).status, 200);
  second.server.close();
});

test('malformed ids or bodies are refused with 400', async () => {
  const { base, server } = await start();
  assert.equal((await fetch(`${base}/accounts/undeployed/zz`, { method: 'PUT', body: JSON.stringify(record) })).status, 400);
  assert.equal((await fetch(`${base}/accounts/undeployed/0a0b`, { method: 'PUT', body: JSON.stringify({ ...record, credentialId: '0c' }) })).status, 400);
  assert.equal((await fetch(`${base}/accounts/undeployed/0a0b`, { method: 'PUT', body: JSON.stringify({ ...record, status: 'x' }) })).status, 400);
  server.close();
});
```

- [ ] **Step 2: Run it.** Run: `nix develop -c pnpm run test:apps`. Expected: FAIL, cannot find `../src/routes/registry.ts`.

- [ ] **Step 3: Implement** `apps/passport-service/src/routes/registry.ts`:

```ts
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import type { ServiceConfig } from '../config.ts';
import { json, readJson, type Route } from '../http.ts';

const PATH = /^\/accounts\/([a-z0-9-]{1,32})\/([0-9a-f]{2,512})$/;
const HEX = /^[0-9a-f]*$/;

type Store = Record<string, unknown>;

function isRecord(body: unknown, credentialId: string): boolean {
  if (!body || typeof body !== 'object') return false;
  const r = body as Record<string, unknown>;
  const pk = r.publicKey as Record<string, unknown> | undefined;
  const policy = r.policy as Record<string, unknown> | undefined;
  return r.credentialId === credentialId && typeof r.address === 'string' && HEX.test(r.address) &&
    typeof pk?.x === 'string' && typeof pk.y === 'string' &&
    typeof policy?.rp_id_hash === 'string' && typeof policy.origin === 'string' &&
    typeof r.salt === 'string' && HEX.test(r.salt) && (r.status === 'deployed' || r.status === 'active');
}

export function registryRoute(config: ServiceConfig): Route {
  const load = (): Store => (existsSync(config.registryFile) ? (JSON.parse(readFileSync(config.registryFile, 'utf8')) as Store) : {});
  const save = (store: Store) => {
    writeFileSync(`${config.registryFile}.tmp`, JSON.stringify(store, null, 2));
    renameSync(`${config.registryFile}.tmp`, config.registryFile);
  };
  return async (req, res, url) => {
    if (!url.pathname.startsWith('/accounts/')) return false;
    const m = PATH.exec(url.pathname);
    if (!m || m[2]!.length % 2 !== 0) { json(res, 400, { error: 'bad account path' }); return true; }
    const key = `${m[1]}/${m[2]}`;
    if (req.method === 'GET') {
      const rec = load()[key];
      if (rec === undefined) json(res, 404, { error: 'not found' }); else json(res, 200, rec);
      return true;
    }
    if (req.method === 'PUT') {
      const body = await readJson(req, 64 * 1024);
      if (!isRecord(body, m[2]!)) { json(res, 400, { error: 'bad account record' }); return true; }
      const store = load();
      store[key] = body;
      save(store);
      res.writeHead(204); res.end();
      return true;
    }
    json(res, 405, { error: 'method not allowed' });
    return true;
  };
}
```

- [ ] **Step 4: Run it.** Run: `nix develop -c pnpm run test:apps`. Expected: PASS, 7 tests in total.

- [ ] **Step 5: Commit.**

```bash
git add apps/passport-service/src/routes/registry.ts apps/passport-service/test/registry.test.ts
git commit -S -s -m "feat(service): network-bound passkey-to-account registry

Assisted-by: AI"
```

---

### Task 7: Service chain — delegated proving, sponsorship, deployment

**Files:**
- Create: `apps/passport-service/src/backend.ts`, `apps/passport-service/src/reference-backend.ts`, `apps/passport-service/src/routes/chain.ts`, `apps/passport-service/src/main.ts`
- Test: `apps/passport-service/test/chain.test.ts`, `apps/passport-service/test/reference.it.test.ts` (opt-in)

**Interfaces:**
- Consumes: Task 5 server and routes, Task 6 registry route.
- Produces:
  - `interface ChainBackend { check(preimage: Uint8Array, keyLocation: string): Promise<(bigint | undefined)[]>; prove(preimage: Uint8Array, keyLocation: string, overwriteBindingInput?: bigint): Promise<Uint8Array>; balance(tx: Uint8Array): Promise<Uint8Array>; submit(tx: Uint8Array): Promise<string>; deploy(boot: Uint8Array, encKey: Uint8Array): Promise<{ address: string; txHashes: string[] }>; sponsorKeys(): { coinPublicKey: string; encryptionPublicKey: string } }`
  - `chainRoute(backend: ChainBackend): Route`. Wire format, all hex: `POST /check {preimage, keyLocation}` → `{result: (string|null)[]}`; `POST /prove {preimage, keyLocation, overwriteBindingInput?: string}` → `{proof}`; `POST /sponsor/balance {tx}` → `{tx}`; `POST /sponsor/submit {tx}` → `{txId}`; `POST /deploy {boot, encKey}` → `{address, txHashes}`.
  - `loadReferenceBackend(config: ServiceConfig): Promise<ChainBackend>`
- Deviations from spec §4.3, deliberate:
  - The single `/sponsor` becomes `/sponsor/balance` and `/sponsor/submit`. These are exactly the `balanceTx` and `submitTx` of midnight-js's wallet and node providers, which is where lace-sdk's own wallet will plug in.
  - `/deploy` answers when the waves finish instead of streaming progress; the connector's `onProgress` steps carry the progress.
  - `/deploy` takes `{boot, encKey}` only; the service fills the reference's recovery-at-birth defaults (a random JubJub key, a zero wrap, a 3-day veto window).

- [ ] **Step 1: Write the failing test** `apps/passport-service/test/chain.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { createServer } from '../src/server.ts';
import { chainRoute } from '../src/routes/chain.ts';
import type { ChainBackend } from '../src/backend.ts';
import { testConfig } from './fixtures.ts';

function fakeBackend(delayMs = 30) {
  let active = 0; let maxActive = 0;
  const seen: Record<string, unknown> = {};
  const backend: ChainBackend = {
    async check(p, k) { seen.check = [p, k]; return [1n, undefined]; },
    async prove(p, k, o) {
      active++; maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, delayMs));
      active--; seen.prove = [p, k, o]; return Uint8Array.of(0xaa);
    },
    async balance(tx) { return Uint8Array.of(...tx, 0xbb); },
    async submit() { return 'txid-1'; },
    async deploy(boot, enc) { seen.deploy = [boot, enc]; return { address: 'cc'.repeat(32), txHashes: ['a', 'b'] }; },
    sponsorKeys: () => ({ coinPublicKey: 'cp', encryptionPublicKey: 'ep' }),
  };
  return { backend, seen, maxActive: () => maxActive };
}

async function start(backend: ChainBackend) {
  const server = createServer(testConfig(), [chainRoute(backend)]);
  await new Promise<void>((r) => server.listen(0, r));
  return { base: `http://localhost:${(server.address() as AddressInfo).port}`, server };
}
const post = (url: string, body: unknown) => fetch(url, { method: 'POST', body: JSON.stringify(body) });

test('/prove decodes hex, passes the binding input as bigint, and returns the proof', async () => {
  const f = fakeBackend(); const { base, server } = await start(f.backend);
  const res = await post(`${base}/prove`, { preimage: '0102', keyLocation: 'k', overwriteBindingInput: '5' });
  assert.deepEqual(await res.json(), { proof: 'aa' });
  assert.deepEqual(f.seen.prove, [Uint8Array.of(1, 2), 'k', 5n]);
  server.close();
});

test('/check returns bigints as decimal strings and undefined as null', async () => {
  const f = fakeBackend(); const { base, server } = await start(f.backend);
  assert.deepEqual(await (await post(`${base}/check`, { preimage: '01', keyLocation: 'k' })).json(), { result: ['1', null] });
  server.close();
});

test('proofs run one at a time even when requested concurrently', async () => {
  const f = fakeBackend(); const { base, server } = await start(f.backend);
  await Promise.all([1, 2, 3].map(() => post(`${base}/prove`, { preimage: '01', keyLocation: 'k' })));
  assert.equal(f.maxActive(), 1);
  server.close();
});

test('/sponsor/balance and /sponsor/submit round-trip hex transactions', async () => {
  const f = fakeBackend(); const { base, server } = await start(f.backend);
  assert.deepEqual(await (await post(`${base}/sponsor/balance`, { tx: '01' })).json(), { tx: '01bb' });
  assert.deepEqual(await (await post(`${base}/sponsor/submit`, { tx: '01bb' })).json(), { txId: 'txid-1' });
  server.close();
});

test('/deploy takes constructor inputs only and returns the address', async () => {
  const f = fakeBackend(); const { base, server } = await start(f.backend);
  const body = await (await post(`${base}/deploy`, { boot: '11'.repeat(32), encKey: '22'.repeat(32) })).json();
  assert.equal((body as { address: string }).address, 'cc'.repeat(32));
  assert.equal((await post(`${base}/deploy`, { boot: '11' })).status, 400);
  server.close();
});

test('a backend failure on /prove is a 502 the client can map to ProverUnavailable', async () => {
  const f = fakeBackend();
  f.backend.prove = async () => { throw new Error('proof server down'); };
  const { base, server } = await start(f.backend);
  const res = await post(`${base}/prove`, { preimage: '01', keyLocation: 'k' });
  assert.equal(res.status, 502);
  assert.match(((await res.json()) as { error: string }).error, /proof server down/);
  server.close();
});
```

- [ ] **Step 2: Run it.** Run: `nix develop -c pnpm run test:apps`. Expected: FAIL, cannot find `../src/routes/chain.ts`.

- [ ] **Step 3: Implement** `apps/passport-service/src/backend.ts`:

```ts
/** What the HTTP layer needs from the chain; the reference client implements it (reference-backend.ts). */
export interface ChainBackend {
  check(preimage: Uint8Array, keyLocation: string): Promise<(bigint | undefined)[]>;
  prove(preimage: Uint8Array, keyLocation: string, overwriteBindingInput?: bigint): Promise<Uint8Array>;
  /** Adds the sponsor's fees to a proven, unbalanced transaction; returns the finalized bytes. */
  balance(tx: Uint8Array): Promise<Uint8Array>;
  submit(tx: Uint8Array): Promise<string>;
  /** Wave deployment with constructor inputs only; retires the maintenance authority. */
  deploy(boot: Uint8Array, encKey: Uint8Array): Promise<{ address: string; txHashes: string[] }>;
  sponsorKeys(): { coinPublicKey: string; encryptionPublicKey: string };
}
```

`apps/passport-service/src/routes/chain.ts`:

```ts
import type { ChainBackend } from '../backend.ts';
import { json, readJson, type Route } from '../http.ts';

const hex = (b: Uint8Array) => Buffer.from(b).toString('hex');
const bytes = (s: unknown, field: string): Uint8Array => {
  if (typeof s !== 'string' || !/^([0-9a-f]{2})*$/.test(s)) throw new BadRequest(`${field} must be hex`);
  return new Uint8Array(Buffer.from(s, 'hex'));
};
class BadRequest extends Error {}

/** One proof at a time: a P-256 proof needs ~13.5 GiB (Review Focus 5). */
function serial() {
  let tail: Promise<unknown> = Promise.resolve();
  return <T>(job: () => Promise<T>): Promise<T> => {
    const next = tail.then(job, job);
    tail = next.catch(() => undefined);
    return next;
  };
}

export function chainRoute(backend: ChainBackend): Route {
  const queue = serial();
  const handlers: Record<string, (body: Record<string, unknown>) => Promise<unknown>> = {
    '/check': async (b) => ({
      result: (await backend.check(bytes(b.preimage, 'preimage'), String(b.keyLocation))).map((v) => (v === undefined ? null : v.toString())),
    }),
    '/prove': async (b) => ({
      proof: hex(await queue(() => backend.prove(
        bytes(b.preimage, 'preimage'), String(b.keyLocation),
        b.overwriteBindingInput === undefined ? undefined : BigInt(String(b.overwriteBindingInput)),
      ))),
    }),
    '/sponsor/balance': async (b) => ({ tx: hex(await backend.balance(bytes(b.tx, 'tx'))) }),
    '/sponsor/submit': async (b) => ({ txId: await backend.submit(bytes(b.tx, 'tx')) }),
    '/deploy': async (b) => {
      const boot = bytes(b.boot, 'boot'); const encKey = bytes(b.encKey, 'encKey');
      if (boot.length !== 32 || encKey.length !== 32) throw new BadRequest('boot and encKey must be 32 bytes');
      return backend.deploy(boot, encKey);
    },
  };
  return async (req, res, url) => {
    const handler = handlers[url.pathname];
    if (!handler || req.method !== 'POST') return false;
    try {
      json(res, 200, await handler((await readJson(req)) as Record<string, unknown>));
    } catch (e) {
      json(res, e instanceof BadRequest ? 400 : 502, { error: e instanceof Error ? e.message : String(e) });
    }
    return true;
  };
}
```

- [ ] **Step 4: Run it.** Run: `nix develop -c pnpm run test:apps`. Expected: PASS, 13 tests in total.

- [ ] **Step 5: Implement the reference-backed backend** `apps/passport-service/src/reference-backend.ts`. It imports the contract team's Node client from the fetched tree at runtime (`tsx` transpiles it; its own `node_modules` supplies the exactly pinned stack), so no upstream code is copied into the fork:

```ts
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { ChainBackend } from './backend.ts';
import type { ServiceConfig } from './config.ts';

/** The reference modules are untyped from here: they live outside this workspace. */
type Loose = Record<string, (...args: unknown[]) => unknown>;
const load = async (config: ServiceConfig, rel: string): Promise<Loose> =>
  (await import(pathToFileURL(join(config.contractDir, rel)).href)) as Loose;

export async function loadReferenceBackend(config: ServiceConfig): Promise<ChainBackend> {
  const wallet = await load(config, 'src/node/wallet.ts');
  const setup = await load(config, 'src/node/setup.ts');
  const waves = await load(config, 'src/wallet/wave-deploy.ts');
  const witnesses = await load(config, 'src/wallet/witnesses.ts');
  const signer = await load(config, 'src/wallet/signer.ts');
  const proofProvider = (await import(pathToFileURL(join(config.contractDir,
    'node_modules/@midnight-ntwrk/midnight-js-http-client-proof-provider/dist/index.js')).href)) as Loose;
  const zkProvider = (await import(pathToFileURL(join(config.contractDir,
    'node_modules/@midnight-ntwrk/midnight-js-node-zk-config-provider/dist/index.js')).href)) as Loose;

  // The sponsor: the reference wallet over the localnet's genesis seed, synced once.
  // setupWallet(seed) returns { walletCtx, providers }, with providers over contracts/managed/account.
  const { providers } = (await setup.setupWallet!(config.sponsorSeed)) as {
    providers: {
      walletProvider: { balanceTx(tx: { serialize(): Uint8Array }): Promise<{ serialize(): Uint8Array }>;
        getCoinPublicKey(): string; getEncryptionPublicKey(): string };
      midnightProvider: { submitTx(tx: { serialize(): Uint8Array }): Promise<string> };
    };
  };
  void wallet; // node/wallet.ts is imported for its side effects: network id, WebSocket, CONFIG.
  const registry = await zkProvider.nodeZkConfigRegistry!(join(config.contractDir, 'contracts/managed'));
  const proving = proofProvider.httpClientProvingProvider!(config.proofServerUri, registry) as {
    check(p: Uint8Array, k: string): Promise<(bigint | undefined)[]>;
    prove(p: Uint8Array, k: string, o?: bigint): Promise<Uint8Array>;
  };
  // balanceTx/submitTx only call tx.serialize() (reference node/wallet.ts), so raw bytes travel as a thin wrapper.
  const wrap = (bytes: Uint8Array) => ({ serialize: () => bytes });

  return {
    check: (p, k) => proving.check(p, k),
    prove: (p, k, o) => proving.prove(p, k, o),
    balance: async (tx) => (await providers.walletProvider.balanceTx(wrap(tx))).serialize(),
    submit: (tx) => providers.midnightProvider.submitTx(wrap(tx)),
    async deploy(boot, encKey) {
      const birth = (signer.JubjubDevice as unknown as { generate(): { pk: unknown } }).generate();
      const address = (await waves.deployAccountInWaves!(providers, setup.compiledAccountContract!(), {
        firstArm: 'p256',
        args: [boot, encKey, birth.pk, new Uint8Array(64), 3n * 24n * 3600n],
        privateStateId: `passport-${randomBytes(8).toString('hex')}`,
        initialPrivateState: witnesses.emptyCoinStore!(),
        retireAuthority: true,
      })) as string;
      return { address, txHashes: [] };
    },
    sponsorKeys: () => ({
      coinPublicKey: providers.walletProvider.getCoinPublicKey(),
      encryptionPublicKey: providers.walletProvider.getEncryptionPublicKey(),
    }),
  };
}
```

> The reference client reads its network from `MIDNIGHT_NETWORK` (default `local`, i.e. `'undeployed'` and the localnet endpoints in `node/wallet.ts`), so the service is started with `MIDNIGHT_NETWORK=local`. A testnet run would add a configuration there.

- [ ] **Step 6: Entry point** `apps/passport-service/src/main.ts`:

```ts
import { loadConfig } from './config.ts';
import { verifyArtefacts } from './artefacts.ts';
import { loadReferenceBackend } from './reference-backend.ts';
import { createServer } from './server.ts';
import { configRoute, zkRoute } from './routes/zk.ts';
import { registryRoute } from './routes/registry.ts';
import { chainRoute } from './routes/chain.ts';

const config = loadConfig(process.env);
verifyArtefacts(config.artefactDir, config.manifestSha256);
console.log(`passport-service: artefacts verified (${config.bindingId}, manifest ${config.manifestSha256.slice(0, 12)}…)`);
const backend = await loadReferenceBackend(config);
const server = createServer(config, [
  configRoute(config, () => backend.sponsorKeys()),
  zkRoute(config),
  registryRoute(config),
  chainRoute(backend),
]);
server.listen(config.port, () => console.log(`passport-service: http://localhost:${config.port} (network ${config.networkId})`));
```

- [ ] **Step 7: Opt-in integration test** `apps/passport-service/test/reference.it.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../src/config.ts';
import { loadReferenceBackend } from '../src/reference-backend.ts';

test('the reference backend deploys an ACC on the localnet (PASSPORT_IT=1)', { skip: process.env.PASSPORT_IT !== '1', timeout: 30 * 60_000 }, async () => {
  const backend = await loadReferenceBackend(loadConfig(process.env));
  const keys = backend.sponsorKeys();
  assert.ok(keys.coinPublicKey.length > 0);
  const { address } = await backend.deploy(new Uint8Array(32).fill(1), new Uint8Array(32).fill(2));
  assert.match(address, /^[0-9a-f]{64}$/);
});
```

Run (localnet up, prerequisites done):

```bash
nix develop -c bash -c 'export PASSPORT_CONTRACT_DIR="$D" PASSPORT_MANIFEST_SHA256=<P1 hash> PASSPORT_IT=1 MIDNIGHT_NETWORK=local; pnpm --filter passport-service test'
```

Expected: PASS after the 10 deploy waves (several minutes). Unit tests stay green without `PASSPORT_IT`.

- [ ] **Step 8: Run the gate and commit.**

Run: `nix develop -c bash -c 'pnpm test && pnpm run test:apps && pnpm run lint'`. Expected: PASS.

```bash
git add apps/passport-service/src/backend.ts apps/passport-service/src/reference-backend.ts apps/passport-service/src/routes/chain.ts \
  apps/passport-service/src/main.ts apps/passport-service/test/chain.test.ts apps/passport-service/test/reference.it.test.ts
git commit -S -s -m "feat(service): delegated proving, fee sponsorship and wave deployment

Assisted-by: AI"
```

---

### Task 8: `adapter-browser` — service-backed chain and the shim

**Files:**
- Create: `packages/adapter-browser/src/service-client.ts`, `packages/adapter-browser/src/delegated-proving.ts`, `packages/adapter-browser/src/service-chain.ts`, `packages/adapter-browser/src/shim.ts`
- Modify: `packages/adapter-browser/src/index.ts`
- Test: `tests/adapter-browser-chain.test.mjs`

**Interfaces:**
- Consumes: `ChainSeam`, `AccLedgerView`, `ConstructorArgs`, `MvpCircuit`, `FetchLike`, `toHex`, `fromHex`, `PassportConnectorError` (Tasks 3–4); the service wire format of Task 7.
- Produces:
  - `interface ServiceConfigWire { networkId; bindingId; manifestSha256; indexerUri; indexerWsUri; nodeUri; zkBaseUrl; coinPublicKey; encryptionPublicKey }`, `fetchServiceConfig(base, fetchFn): Promise<ServiceConfigWire>`
  - `delegatedProvingProvider(base, fetchFn)`: a ledger-v9 `ProvingProvider`
  - `interface GeneratedAccModule { Contract: new (witnesses: unknown) => unknown; ledger(data: unknown): unknown; pureCircuits: AccPureCircuits }`
  - `createServiceChain(opts: { serviceUrl: string; config: ServiceConfigWire; module: GeneratedAccModule; fetchFn?: FetchLike }): ChainSeam`
  - `injectPassportConnector(target: { midnight?: Record<string, unknown> }, descriptor: PassportConnectorDescriptor): void`

- [ ] **Step 1: Write the failing test** `tests/adapter-browser-chain.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';

const b = await import(new URL('../packages/adapter-browser/dist/index.js', import.meta.url).href);

function recordingFetch(responses) {
  const calls = [];
  const fn = async (url, init = {}) => {
    calls.push({ url, body: init.body ? JSON.parse(init.body) : undefined });
    const r = responses[new URL(url).pathname];
    return { ok: r.status === 200, status: r.status, json: async () => r.body };
  };
  return { fn, calls };
}

test('the delegated proving provider sends hex preimage, key location and decimal binding input', async () => {
  const f = recordingFetch({ '/prove': { status: 200, body: { proof: 'aabb' } }, '/check': { status: 200, body: { result: ['3', null] } } });
  const p = b.delegatedProvingProvider('http://svc', f.fn);
  assert.deepEqual(await p.prove(Uint8Array.of(1, 2), 'contract:x/c', 7n), Uint8Array.of(0xaa, 0xbb));
  assert.deepEqual(f.calls[0].body, { preimage: '0102', keyLocation: 'contract:x/c', overwriteBindingInput: '7' });
  assert.deepEqual(await p.check(Uint8Array.of(1), 'k'), [3n, undefined]);
});

test('a prover failure surfaces as ProverUnavailable', async () => {
  const f = recordingFetch({ '/prove': { status: 502, body: { error: 'down' } } });
  await assert.rejects(b.delegatedProvingProvider('http://svc', f.fn).prove(Uint8Array.of(1), 'k'), { code: 'ProverUnavailable' });
});

test('the shim installs a descriptor under window.midnight.passport without clobbering others', () => {
  const target = { midnight: { devwallet: { name: 'dev' } } };
  const descriptor = { name: 'Midnight Passport (prototype)', apiVersion: '0.1.0-prototype', connect: async () => ({}) };
  b.injectPassportConnector(target, descriptor);
  assert.equal(target.midnight.passport, descriptor);
  assert.equal(target.midnight.devwallet.name, 'dev');
  assert.ok(Object.isFrozen(target.midnight.passport));
  const empty = {};
  b.injectPassportConnector(empty, descriptor);
  assert.equal(empty.midnight.passport, descriptor);
});

test('fetchServiceConfig refuses a service on another network', async () => {
  const f = recordingFetch({ '/config': { status: 200, body: { networkId: 'testnet' } } });
  await assert.rejects(b.fetchServiceConfig('http://svc', f.fn, 'undeployed'), { code: 'NetworkMismatch' });
});
```

- [ ] **Step 2: Run it.** Run: `nix develop -c pnpm test`. Expected: FAIL, `delegatedProvingProvider` is not a function.

- [ ] **Step 3: Implement** `packages/adapter-browser/src/service-client.ts`:

```ts
import { PassportConnectorError, type FetchLike } from '@midnight-ntwrk/mn-passport-account';

export interface ServiceConfigWire {
  readonly networkId: string;
  readonly bindingId: string;
  readonly manifestSha256: string;
  readonly indexerUri: string;
  readonly indexerWsUri: string;
  readonly nodeUri: string;
  readonly zkBaseUrl: string;
  readonly coinPublicKey: string;
  readonly encryptionPublicKey: string;
}

export const defaultFetch: FetchLike = (url, init) => fetch(url, init);

export async function postJson<T>(fetchFn: FetchLike, url: string, body: unknown): Promise<{ status: number; body: T }> {
  const res = await fetchFn(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { status: res.status, body: (await res.json()) as T };
}

export async function fetchServiceConfig(base: string, fetchFn: FetchLike, networkId: string): Promise<ServiceConfigWire> {
  const res = await fetchFn(`${base}/config`);
  if (!res.ok) throw new PassportConnectorError('InternalError', `service /config failed: ${res.status}`);
  const config = (await res.json()) as ServiceConfigWire;
  if (config.networkId !== networkId) {
    throw new PassportConnectorError('NetworkMismatch', `service is on ${config.networkId}, connector is bound to ${networkId}`);
  }
  return config;
}
```

`packages/adapter-browser/src/delegated-proving.ts`:

```ts
import { PassportConnectorError, fromHex, toHex, type FetchLike } from '@midnight-ntwrk/mn-passport-account';
import type { ProvingProvider } from '@midnightntwrk/ledger-v9';
import { postJson } from './service-client.js';

/** midnight-js's proving seam, answered by the service, which holds the prover keys (spec §2). */
export function delegatedProvingProvider(base: string, fetchFn: FetchLike): ProvingProvider {
  return {
    async check(serializedPreimage, keyLocation) {
      const r = await postJson<{ result?: (string | null)[]; error?: string }>(fetchFn, `${base}/check`,
        { preimage: toHex(serializedPreimage), keyLocation });
      if (r.status !== 200 || !r.body.result) throw new PassportConnectorError('ProverUnavailable', r.body.error ?? `check ${r.status}`);
      return r.body.result.map((v) => (v === null ? undefined : BigInt(v)));
    },
    async prove(serializedPreimage, keyLocation, overwriteBindingInput) {
      const r = await postJson<{ proof?: string; error?: string }>(fetchFn, `${base}/prove`, {
        preimage: toHex(serializedPreimage), keyLocation,
        ...(overwriteBindingInput === undefined ? {} : { overwriteBindingInput: overwriteBindingInput.toString() }),
      });
      if (r.status !== 200 || !r.body.proof) throw new PassportConnectorError('ProverUnavailable', r.body.error ?? `prove ${r.status}`);
      return fromHex(r.body.proof);
    },
  };
}
```

`packages/adapter-browser/src/service-chain.ts` (midnight-js 5's own call pipeline; the wallet and submit providers delegate to the service's sponsor, which is exactly where lace-sdk later plugs in its own wallet):

```ts
import { CompiledContract } from '@midnight-ntwrk/compact-js';
import { submitCallTx } from '@midnight-ntwrk/midnight-js-contracts';
import { FetchZkConfigProvider } from '@midnight-ntwrk/midnight-js-fetch-zk-config-provider';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import { createMidnightProvider, createProofProviderFromHandlers, createWalletProvider } from '@midnight-ntwrk/midnight-js-types';
import {
  PassportConnectorError, fromHex, toHex,
  type AccLedgerView, type AccPureCircuits, type ChainSeam, type FetchLike,
} from '@midnight-ntwrk/mn-passport-account';
import { CostModel, Transaction } from '@midnightntwrk/ledger-v9';
import { delegatedProvingProvider } from './delegated-proving.js';
import { defaultFetch, postJson, type ServiceConfigWire } from './service-client.js';

export interface GeneratedAccModule {
  /** The generated `Contract` class; its witness type is the reference's coin store. */
  readonly Contract: new (witnesses: never) => unknown;
  /** The generated ledger projection; `unknown` because the generated `Ledger` type stays in the artefact. */
  ledger(data: unknown): unknown;
  readonly pureCircuits: AccPureCircuits;
}

interface LedgerShape {
  booted: boolean; auth_nonce: bigint; device_epoch: bigint; spec_version: bigint;
  devices: { member(e: Uint8Array): boolean; size(): bigint };
}

export function createServiceChain(opts: {
  serviceUrl: string; config: ServiceConfigWire; module: GeneratedAccModule; fetchFn?: FetchLike;
}): ChainSeam {
  const { serviceUrl, config, module } = opts;
  const fetchFn = opts.fetchFn ?? defaultFetch;
  setNetworkId(config.networkId);
  // The MVP circuits never invoke the account's only witness (held_coin); refuse loudly if one does.
  const witnesses = { held_coin: () => { throw new Error('held_coin is not available in the Passport prototype'); } };
  const compiledContract = CompiledContract.make('account', module.Contract as never).pipe(
    CompiledContract.withWitnesses(witnesses as never),
  );
  const publicDataProvider = indexerPublicDataProvider(config.indexerUri, config.indexerWsUri);
  const providers = {
    publicDataProvider,
    zkConfigProvider: new FetchZkConfigProvider(config.zkBaseUrl, { verify: 'require', expectedManifestHash: config.manifestSha256 }),
    proofProvider: createProofProviderFromHandlers({
      currentEra: (tx: { prove(p: unknown, c: unknown): Promise<unknown> }) =>
        tx.prove(delegatedProvingProvider(serviceUrl, fetchFn), CostModel.initialCostModel()),
    } as never),
    walletProvider: createWalletProvider({
      getCoinPublicKey: () => config.coinPublicKey,
      getEncryptionPublicKey: () => config.encryptionPublicKey,
      async balanceTx(tx: { serialize(): Uint8Array }) {
        const r = await postJson<{ tx?: string; error?: string }>(fetchFn, `${serviceUrl}/sponsor/balance`, { tx: toHex(tx.serialize()) });
        if (r.status !== 200 || !r.body.tx) throw new PassportConnectorError('SponsorRejected', r.body.error ?? `balance ${r.status}`);
        return Transaction.deserialize('signature', 'proof', 'binding', fromHex(r.body.tx));
      },
    } as never),
    midnightProvider: createMidnightProvider(async (tx: { serialize(): Uint8Array }) => {
      const r = await postJson<{ txId?: string; error?: string }>(fetchFn, `${serviceUrl}/sponsor/submit`, { tx: toHex(tx.serialize()) });
      if (r.status !== 200 || !r.body.txId) throw new PassportConnectorError('SponsorRejected', r.body.error ?? `submit ${r.status}`);
      return r.body.txId;
    }),
  };

  return {
    async deploy(args) {
      const r = await postJson<{ address?: string; txHashes?: string[]; error?: string }>(fetchFn, `${serviceUrl}/deploy`,
        { boot: toHex(args.boot), encKey: toHex(args.encKey) });
      if (r.status !== 200 || !r.body.address) throw new PassportConnectorError('SponsorRejected', r.body.error ?? `deploy ${r.status}`);
      return { address: r.body.address, txHashes: r.body.txHashes ?? [] };
    },
    async readLedger(address): Promise<AccLedgerView | undefined> {
      const state = (await publicDataProvider.queryContractState(address)) as { data: unknown } | null;
      if (!state) return undefined;
      const l = module.ledger(state.data) as LedgerShape;
      return {
        booted: l.booted, authNonce: l.auth_nonce, deviceEpoch: l.device_epoch,
        entryCount: Number(l.devices.size()), specVersion: Number(l.spec_version),
        hasEntry: (entry) => l.devices.member(entry),
      };
    },
    async call(address, circuit, args) {
      // No privateStateId: the MVP circuits read no private state (midnight-js then needs no private-state provider).
      const result = (await submitCallTx(providers as never, {
        compiledContract, contractAddress: address, circuitId: circuit, args,
      } as never)) as { public: { txId: string; blockHeight?: number } };
      return { txHash: result.public.txId, ...(result.public.blockHeight === undefined ? {} : { blockHeight: result.public.blockHeight }) };
    },
  };
}
```

> The `as never` casts bridge generic midnight-js types that depend on the generated module's types, which live outside this package (FS-0.2 D-9). Each cast sits at a single call site, so the type check moves to the generated module when FS-0.9 T3 generates its surface.

`packages/adapter-browser/src/shim.ts`:

```ts
import type { PassportConnectorDescriptor } from '@midnight-ntwrk/mn-passport-protocol';

/** Installs the connector the way a wallet injects into `window.midnight` (spec §4.1). */
export function injectPassportConnector(
  target: { midnight?: Record<string, unknown> },
  descriptor: PassportConnectorDescriptor,
): void {
  target.midnight ??= {};
  target.midnight.passport = Object.freeze(descriptor);
}
```

Replace `packages/adapter-browser/src/index.ts`:

```ts
export * from './delegated-proving.js';
export * from './service-chain.js';
export * from './service-client.js';
export * from './shim.js';
```

- [ ] **Step 4: Run it.** Run: `nix develop -c bash -c 'pnpm test && pnpm run lint'`. Expected: PASS. If `tsc` reports a midnight-js export name that differs from the one used here, check it in `node_modules/@midnight-ntwrk/<pkg>/dist/index.d.ts` and correct the import. Do not add casts beyond the ones shown.

- [ ] **Step 5: Commit.**

```bash
git add packages/adapter-browser/src tests/adapter-browser-chain.test.mjs
git commit -S -s -m "feat(adapter-browser): service-backed call pipeline, delegated prover and the connector shim

Assisted-by: AI"
```

---

### Task 9: `adapter-browser` — WebAuthn passkey seam and the PRF wallet seed

**Files:**
- Create: `packages/adapter-browser/src/webauthn.ts` (port), `packages/adapter-browser/src/passkey.ts`, `packages/adapter-browser/src/prf.ts`
- Modify: `packages/adapter-browser/src/index.ts`
- Test: `tests/adapter-browser-webauthn.test.mjs`

**Interfaces:**
- Consumes: `PasskeySeam`, `PasskeyCredential`, `PasskeySignature`, `PassportConnectorError` (Task 3).
- Produces:
  - from the port: `WEBAUTHN_ORIGIN_BYTES`, `webauthnPolicy`, `clientDataJSON`, `parseES256Signature`, `assertionMaterial`, `type WebAuthnAssertion`, `type AssertionProvider`
  - `browserPasskey(opts: { rpId: string; origin: string; credentials?: CredentialsContainer }): PasskeySeam`
  - `walletSeedFromPasskey(opts: { credentialId: Uint8Array; rpId: string; networkId: string; credentials?: CredentialsContainer }): Promise<Uint8Array | undefined>`
  - `PRF_SALT_PREFIX = 'midnight:passport:wallet:v1:'`

- [ ] **Step 1: Port the profile helpers.** Copy the planning workspace's `contract/src/wallet/webauthn.ts` at revision `45721e1` (in `$D/src/wallet/webauthn.ts`) to `packages/adapter-browser/src/webauthn.ts`, keeping everything except `createBrowserCredential` and `browserAssertionProvider`, which `passkey.ts` replaces. Change the two imports to `@noble/curves/nist.js` and `@noble/hashes/sha2.js` (already identical) and prepend:

```ts
// Ported from the planning workspace's contract/src/wallet/webauthn.ts at
// revision 45721e1 (Apache-2.0): profile wa-json134 helpers, unchanged.
```

- [ ] **Step 2: Write the failing test** `tests/adapter-browser-webauthn.test.mjs`. It drives the seam through a fake `CredentialsContainer` backed by a real P-256 key, so the signature path runs for real:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { p256 } from '@noble/curves/nist.js';
import { sha256 } from '@noble/hashes/sha2.js';

const b = await import(new URL('../packages/adapter-browser/dist/index.js', import.meta.url).href);
const ORIGIN = 'http://localhost:5173';
const RP = 'localhost';

function softwareAuthenticator({ prf = true, cancel = false } = {}) {
  const sk = p256.utils.randomSecretKey();
  const pub = p256.getPublicKey(sk, false); // 0x04 || x || y
  const spki = new Uint8Array([...Buffer.from('3059301306072a8648ce3d020106082a8648ce3d030107034200', 'hex'), ...pub]);
  const id = Uint8Array.of(1, 2, 3, 4);
  const authData = new Uint8Array([...sha256(new TextEncoder().encode(RP)), 5, 0, 0, 0, 1]);
  return {
    pub,
    container: {
      async create() {
        if (cancel) throw Object.assign(new Error('no'), { name: 'NotAllowedError' });
        return { rawId: id.buffer, response: { getPublicKey: () => spki.buffer, getPublicKeyAlgorithm: () => -7 } };
      },
      async get({ publicKey }) {
        if (publicKey.extensions?.prf) {
          if (!prf) return { rawId: id.buffer, getClientExtensionResults: () => ({}) };
          const salt = new Uint8Array(publicKey.extensions.prf.eval.first);
          return { rawId: id.buffer, getClientExtensionResults: () => ({ prf: { results: { first: sha256(salt).buffer } } }) };
        }
        const challenge = new Uint8Array(publicKey.challenge);
        const clientData = b.clientDataJSON(challenge, new TextEncoder().encode(ORIGIN));
        const msg = new Uint8Array([...authData, ...sha256(clientData)]);
        const sig = p256.sign(msg, sk, { format: 'der', prehash: true });
        return { rawId: id.buffer, response: { authenticatorData: authData.buffer, clientDataJSON: clientData.buffer, signature: sig.buffer } };
      },
    },
  };
}

test('create returns the P-256 key and policy for a discoverable credential', async () => {
  const auth = softwareAuthenticator();
  const seam = b.browserPasskey({ rpId: RP, origin: ORIGIN, credentials: auth.container });
  const cred = await seam.create('alice');
  assert.equal(cred.publicKey.x, BigInt('0x' + Buffer.from(auth.pub.slice(1, 33)).toString('hex')));
  assert.equal(new TextDecoder().decode(cred.policy.origin), ORIGIN);
});

test('sign returns validated wa-json134 material for the challenge', async () => {
  const auth = softwareAuthenticator();
  const seam = b.browserPasskey({ rpId: RP, origin: ORIGIN, credentials: auth.container });
  const cred = await seam.create('alice');
  const signed = await seam.sign(cred, new Uint8Array(32).fill(7));
  assert.equal(signed.authenticator_data.length, 37);
  assert.ok(signed.sig.r > 0n && signed.sig.s > 0n);
});

test('identify returns the picked credential id', async () => {
  const seam = b.browserPasskey({ rpId: RP, origin: ORIGIN, credentials: softwareAuthenticator().container });
  assert.deepEqual((await seam.identify()).credentialId, Uint8Array.of(1, 2, 3, 4));
});

test('a cancelled prompt is UserCancelled', async () => {
  const seam = b.browserPasskey({ rpId: RP, origin: ORIGIN, credentials: softwareAuthenticator({ cancel: true }).container });
  await assert.rejects(seam.create('alice'), { code: 'UserCancelled' });
});

test('the PRF wallet seed is network-bound and absent without PRF support', async () => {
  const auth = softwareAuthenticator();
  const a1 = await b.walletSeedFromPasskey({ credentialId: Uint8Array.of(1, 2, 3, 4), rpId: RP, networkId: 'undeployed', credentials: auth.container });
  const a2 = await b.walletSeedFromPasskey({ credentialId: Uint8Array.of(1, 2, 3, 4), rpId: RP, networkId: 'testnet', credentials: auth.container });
  assert.equal(a1.length, 32);
  assert.notDeepEqual(a1, a2);
  const none = await b.walletSeedFromPasskey({ credentialId: Uint8Array.of(1), rpId: RP, networkId: 'undeployed',
    credentials: softwareAuthenticator({ prf: false }).container });
  assert.equal(none, undefined);
});
```

- [ ] **Step 3: Run it.** Run: `nix develop -c pnpm test`. Expected: FAIL, `browserPasskey` is not a function.

- [ ] **Step 4: Implement** `packages/adapter-browser/src/passkey.ts`:

```ts
import { PassportConnectorError, toPassportError, type PasskeySeam } from '@midnight-ntwrk/mn-passport-account';
import { assertionMaterial, validateP256Key, webauthnPolicy } from './webauthn.js';

const fromB64url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
const integer = (b: Uint8Array) => b.reduce((n, v) => (n << 8n) | BigInt(v), 0n);

/** wa-json134 passkeys; the private key never leaves the authenticator (spec §4.4). */
export function browserPasskey(opts: { rpId: string; origin: string; credentials?: CredentialsContainer }): PasskeySeam {
  const policy = webauthnPolicy(opts.rpId, opts.origin);
  const container = () => opts.credentials ?? navigator.credentials;
  return {
    async create(userName) {
      try {
        const credential = (await container().create({ publicKey: {
          challenge: crypto.getRandomValues(new Uint8Array(32)),
          rp: { id: opts.rpId, name: 'Midnight Passport' },
          user: { id: crypto.getRandomValues(new Uint8Array(32)), name: userName, displayName: userName },
          pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
          // Discoverable, so openAccount can find it without a stored id (spec §5.1).
          authenticatorSelection: { userVerification: 'required', residentKey: 'required' },
          attestation: 'none',
        } })) as PublicKeyCredential | null;
        if (!credential) throw new PassportConnectorError('UserCancelled', 'Passkey creation was cancelled.');
        const response = credential.response as AuthenticatorAttestationResponse;
        const spki = response.getPublicKey();
        if (response.getPublicKeyAlgorithm() !== -7 || !spki) {
          throw new PassportConnectorError('UnsupportedAuthenticator', 'The authenticator did not create an ES256 (P-256) key.');
        }
        const key = await crypto.subtle.importKey('spki', spki, { name: 'ECDSA', namedCurve: 'P-256' }, true, ['verify']);
        const jwk = await crypto.subtle.exportKey('jwk', key);
        const publicKey = { x: integer(fromB64url(jwk.x!)), y: integer(fromB64url(jwk.y!)), identity: false as const };
        validateP256Key(publicKey);
        return { credentialId: new Uint8Array(credential.rawId), publicKey, policy };
      } catch (e) {
        throw toPassportError(e);
      }
    },
    async identify() {
      try {
        const credential = (await container().get({ publicKey: {
          challenge: crypto.getRandomValues(new Uint8Array(32)), rpId: opts.rpId, userVerification: 'required',
        } })) as PublicKeyCredential | null;
        if (!credential) throw new PassportConnectorError('UserCancelled', 'No passkey was chosen.');
        return { credentialId: new Uint8Array(credential.rawId) };
      } catch (e) {
        throw toPassportError(e);
      }
    },
    async sign(credential, challenge) {
      try {
        const got = (await container().get({ publicKey: {
          challenge: new Uint8Array(challenge), rpId: opts.rpId, userVerification: 'required',
          allowCredentials: [{ type: 'public-key', id: new Uint8Array(credential.credentialId) }],
        } })) as PublicKeyCredential | null;
        if (!got) throw new PassportConnectorError('UserCancelled', 'The passkey prompt was cancelled.');
        const r = got.response as AuthenticatorAssertionResponse;
        const material = assertionMaterial(challenge, credential.policy, credential.publicKey, {
          authenticatorData: new Uint8Array(r.authenticatorData),
          clientDataJSON: new Uint8Array(r.clientDataJSON),
          signature: new Uint8Array(r.signature),
        });
        return { authenticator_data: material.authenticator_data, sig: material.sig };
      } catch (e) {
        throw toPassportError(e);
      }
    },
  };
}
```

`packages/adapter-browser/src/prf.ts`:

```ts
import { sha256 } from '@noble/hashes/sha2.js';

export const PRF_SALT_PREFIX = 'midnight:passport:wallet:v1:';

/**
 * The built-in wallet's seed, from a SEPARATE ceremony: a PRF extension output
 * adds authenticator extension data, which the ACC's wa-json134 signing profile
 * rejects (37-byte authenticator data only), so it can never share a signing
 * assertion. Network-bound by its salt (spec §5.4). Undefined without PRF.
 */
export async function walletSeedFromPasskey(opts: {
  credentialId: Uint8Array; rpId: string; networkId: string; credentials?: CredentialsContainer;
}): Promise<Uint8Array | undefined> {
  const salt = sha256(new TextEncoder().encode(PRF_SALT_PREFIX + opts.networkId));
  const credential = (await (opts.credentials ?? navigator.credentials).get({ publicKey: {
    challenge: crypto.getRandomValues(new Uint8Array(32)), rpId: opts.rpId, userVerification: 'required',
    allowCredentials: [{ type: 'public-key', id: new Uint8Array(opts.credentialId) }],
    extensions: { prf: { eval: { first: salt } } },
  } })) as PublicKeyCredential | null;
  const first = credential?.getClientExtensionResults().prf?.results?.first;
  return first ? new Uint8Array(first as ArrayBuffer).slice(0, 32) : undefined;
}
```

Append to `packages/adapter-browser/src/index.ts`:

```ts
export * from './passkey.js';
export * from './prf.js';
export * from './webauthn.js';
```

- [ ] **Step 5: Run it.** Run: `nix develop -c bash -c 'pnpm test && pnpm run lint'`. Expected: PASS, 5 WebAuthn tests.

- [ ] **Step 6: Commit.**

```bash
git add packages/adapter-browser/src/webauthn.ts packages/adapter-browser/src/passkey.ts packages/adapter-browser/src/prf.ts \
  packages/adapter-browser/src/index.ts tests/adapter-browser-webauthn.test.mjs
git commit -S -s -m "feat(adapter-browser): wa-json134 passkey seam and the network-bound PRF wallet seed

Assisted-by: AI"
```

---

### Task 10: End-to-end MVP script on the localnet

**Files:**
- Create: `apps/passport-dapp/e2e/software-passkey.ts`, `apps/passport-dapp/e2e/mvp.e2e.ts`

**Interfaces:**
- Consumes: `createPassportConnector` (Task 4), `createServiceChain`, `fetchServiceConfig`, `createRegistryClient` (Tasks 3, 8), the running service (Task 7).
- Produces: an evidence JSON at `experiments/acc-0.35/results/x8-dapp-e2e.json`.

- [ ] **Step 1: Software passkey** `apps/passport-dapp/e2e/software-passkey.ts` (a `PasskeySeam` signing exactly as a `wa-json134` authenticator does; for the automated run only):

```ts
import { p256 } from '@noble/curves/nist.js';
import { sha256 } from '@noble/hashes/sha2.js';
import type { PasskeySeam } from '@midnight-ntwrk/mn-passport-account';
import { clientDataJSON, parseES256Signature, webauthnPolicy } from '@midnight-ntwrk/mn-passport-adapter-browser';

export function softwarePasskey(rpId: string, origin: string): PasskeySeam {
  const sk = p256.utils.randomSecretKey();
  const pub = p256.getPublicKey(sk, false);
  const big = (b: Uint8Array) => BigInt(`0x${Buffer.from(b).toString('hex')}`);
  const publicKey = { x: big(pub.slice(1, 33)), y: big(pub.slice(33)), identity: false as const };
  const policy = webauthnPolicy(rpId, origin);
  const credentialId = Uint8Array.from(sha256(pub).slice(0, 16));
  let counter = 0;
  return {
    async create() { return { credentialId, publicKey, policy }; },
    async identify() { return { credentialId }; },
    async sign(_credential, challenge) {
      counter++;
      const authData = new Uint8Array([...policy.rp_id_hash, 5, 0, 0, 0, counter]);
      const message = new Uint8Array([...authData, ...sha256(clientDataJSON(challenge, policy.origin))]);
      const der = p256.sign(message, sk, { format: 'der', prehash: true });
      return { authenticator_data: authData, sig: parseES256Signature(der) };
    },
  };
}
```

- [ ] **Step 2: The script** `apps/passport-dapp/e2e/mvp.e2e.ts`:

```ts
import { mkdirSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { createPassportConnector, createRegistryClient } from '@midnight-ntwrk/mn-passport-account';
import { createServiceChain, fetchServiceConfig, type GeneratedAccModule } from '@midnight-ntwrk/mn-passport-adapter-browser';
import { softwarePasskey } from './software-passkey.ts';

const SERVICE = process.env.PASSPORT_SERVICE_URL ?? 'http://localhost:8787';
const contractDir = process.env.PASSPORT_CONTRACT_DIR!;
const module = (await import(pathToFileURL(`${contractDir}/contracts/managed/account/contract/index.js`).href)) as unknown as GeneratedAccModule;
const config = await fetchServiceConfig(SERVICE, fetch, 'undeployed');
const passkey = softwarePasskey('localhost', 'http://localhost:5173');
const seams = {
  networkId: 'undeployed', bindingId: config.bindingId, pureCircuits: module.pureCircuits, passkey,
  chain: createServiceChain({ serviceUrl: SERVICE, config, module }),
  registry: createRegistryClient(SERVICE, fetch),
  random: (n: number) => new Uint8Array(randomBytes(n)),
  encryptionKey: () => new Uint8Array(randomBytes(32)),
};

const evidence: Record<string, unknown> = { network: 'undeployed', service: SERVICE, binding: config.bindingId, manifestSha256: config.manifestSha256, steps: [] };
const step = (name: string, data: Record<string, unknown> = {}) => {
  (evidence.steps as unknown[]).push({ name, at: new Date().toISOString(), ...data });
  console.log(`  ✓ ${name}`, data);
};

const t0 = Date.now();
const account = await createPassportConnector(seams).createAccount({ userName: 'e2e', onProgress: (s) => step(`create:${s}`) });
step('created', { address: account.address, state: await account.state() });
const r1 = await account.rotateEncryptionKey(new Uint8Array(randomBytes(32)));
step('rotate #1 (passkey-signed, k = 18)', { ...r1 });
const reopened = await createPassportConnector(seams).openAccount();
if (reopened.address !== account.address) throw new Error('reopen returned a different account');
step('reopened after "reload"', { address: reopened.address });
const r2 = await reopened.rotateEncryptionKey(new Uint8Array(randomBytes(32)));
step('rotate #2 after reopen (rescanned counter)', { ...r2, state: await reopened.state() });
evidence.seconds = Math.round((Date.now() - t0) / 1000);
evidence.verdict = 'PASS';

mkdirSync('../../experiments/acc-0.35/results', { recursive: true });
writeFileSync('../../experiments/acc-0.35/results/x8-dapp-e2e.json',
  JSON.stringify(evidence, (_k, v: unknown) => (typeof v === 'bigint' ? v.toString() : v), 2) + '\n');
console.log(`MVP e2e: PASS in ${evidence.seconds} s`);
```

- [ ] **Step 3: Run it against the real stack.** Terminal A (service):

```bash
nix develop -c bash -c 'export PASSPORT_CONTRACT_DIR="$D" PASSPORT_MANIFEST_SHA256=<P1 hash> MIDNIGHT_NETWORK=local; pnpm prototype:service'
```

Expected: `artefacts verified`, then `passport-service: http://localhost:8787 (network undeployed)`.

Terminal B:

```bash
nix develop -c bash -c 'export PASSPORT_CONTRACT_DIR="$D"; pnpm prototype:e2e'
```

Expected: the steps `create:passkey-created` … `create:active`, then `rotate #1`, `reopened`, `rotate #2`, ending `MVP e2e: PASS`. It takes several minutes: 10 deploy waves, and two k = 18 proofs of about 30 s each. On failure, read the service log first: a 502 on `/prove` means Docker memory; `SponsorRejected` means dust or fees (the reference retries on dust lag).

- [ ] **Step 4: Commit the script and its evidence.**

```bash
git add apps/passport-dapp/e2e/software-passkey.ts apps/passport-dapp/e2e/mvp.e2e.ts experiments/acc-0.35/results/x8-dapp-e2e.json
git commit -S -s -m "test(dapp): end-to-end MVP on the localnet — create, rotate, reopen, rotate

Assisted-by: AI"
```

---

### Task 11: The Passport dapp harness (Vite)

**Files:**
- Create: `apps/passport-dapp/index.html`, `apps/passport-dapp/vite.config.ts`, `apps/passport-dapp/src/polyfills.ts`, `apps/passport-dapp/src/shims/assert.ts`, `apps/passport-dapp/src/shims/ws.ts`, `apps/passport-dapp/src/main.ts`, `apps/passport-dapp/src/connector.ts`, `apps/passport-dapp/src/acc-module.ts`

**Interfaces:**
- Consumes: Tasks 4, 8 and 9 exports; the service at `VITE_PASSPORT_SERVICE_URL` (default `http://localhost:8787`).
- Produces: a page at `http://localhost:5173` with buttons "Create Passport account", "Open with passkey", "Rotate encryption key", and an evidence panel with a "Copy evidence" button. `window.midnight.passport` is injected.

- [ ] **Step 1: Vite config** `apps/passport-dapp/vite.config.ts` (the WASM, `Buffer`, `assert` and WebSocket handling the planning workspace's Passport app needs for the same stack):

```ts
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import wasm from 'vite-plugin-wasm';

const here = path.dirname(fileURLToPath(import.meta.url));
const contractDir = process.env.PASSPORT_CONTRACT_DIR;
if (!contractDir) throw new Error('set PASSPORT_CONTRACT_DIR (fetch-acc.sh output)');
const buffer = path.resolve(here, 'node_modules/buffer/index.js');

export default defineConfig({
  plugins: [wasm()],
  resolve: {
    alias: [
      { find: /^node:buffer$/, replacement: buffer },
      { find: /^buffer$/, replacement: buffer },
      { find: /^(node:)?assert$/, replacement: path.resolve(here, 'src/shims/assert.ts') },
      { find: 'isomorphic-ws', replacement: path.resolve(here, 'src/shims/ws.ts') },
      { find: '@acc/module', replacement: path.resolve(contractDir, 'contracts/managed/account/contract/index.js') },
    ],
  },
  // The origin must stay exactly http://localhost:5173: wa-json134 binds a 21-byte origin.
  server: { host: 'localhost', port: 5173, strictPort: true, fs: { allow: [here, contractDir, path.resolve(here, '../..')] } },
  build: { target: 'esnext' },
});
```

- [ ] **Step 2: Shims.** `apps/passport-dapp/src/polyfills.ts`:

```ts
import { Buffer } from 'buffer';
// First import of the app: the SDK chunks read the Buffer global at load time.
(globalThis as { Buffer?: typeof Buffer }).Buffer ??= Buffer;
```

`apps/passport-dapp/src/shims/assert.ts`:

```ts
export default function assert(value: unknown, message?: string): asserts value {
  if (!value) throw new Error(message ?? 'assertion failed');
}
export { assert as ok };
```

`apps/passport-dapp/src/shims/ws.ts`:

```ts
export default globalThis.WebSocket;
export const WebSocket = globalThis.WebSocket;
```

`apps/passport-dapp/src/acc-module.ts`:

```ts
import type { GeneratedAccModule } from '@midnight-ntwrk/mn-passport-adapter-browser';
// The generated module from the pinned artefact build, aliased in vite.config.ts.
import * as generated from '@acc/module';

export const accModule = generated as unknown as GeneratedAccModule;
```

- [ ] **Step 3: Connector wiring** `apps/passport-dapp/src/connector.ts`:

```ts
import { createPassportConnector, createRegistryClient } from '@midnight-ntwrk/mn-passport-account';
import {
  browserPasskey, createServiceChain, defaultFetch, fetchServiceConfig, injectPassportConnector,
} from '@midnight-ntwrk/mn-passport-adapter-browser';
import { PASSPORT_CONNECTOR_VERSION, type PassportConnectorAPI } from '@midnight-ntwrk/mn-passport-protocol';
import { accModule } from './acc-module.js';

export const SERVICE_URL = import.meta.env.VITE_PASSPORT_SERVICE_URL ?? 'http://localhost:8787';
const RP_ID = 'localhost';
const ORIGIN = 'http://localhost:5173';

export async function connect(networkId: string): Promise<PassportConnectorAPI> {
  const config = await fetchServiceConfig(SERVICE_URL, defaultFetch, networkId);
  return createPassportConnector({
    networkId, bindingId: config.bindingId, pureCircuits: accModule.pureCircuits,
    passkey: browserPasskey({ rpId: RP_ID, origin: ORIGIN }),
    chain: createServiceChain({ serviceUrl: SERVICE_URL, config, module: accModule }),
    registry: createRegistryClient(SERVICE_URL, defaultFetch),
    random: (n) => crypto.getRandomValues(new Uint8Array(n)),
    encryptionKey: () => crypto.getRandomValues(new Uint8Array(32)),
  });
}

/** What lace-sdk would inject; the harness discovers it like any dApp would. */
export function installShim(): void {
  injectPassportConnector(window as unknown as { midnight?: Record<string, unknown> }, {
    name: 'Midnight Passport (prototype)', apiVersion: PASSPORT_CONNECTOR_VERSION, connect,
  });
}
```

- [ ] **Step 4: Page and UI.** `apps/passport-dapp/index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Passport Prototype</title>
    <style>
      body { font: 15px/1.5 system-ui, sans-serif; max-width: 760px; margin: 2rem auto; padding: 0 1rem; }
      button { margin: 0 .5rem .5rem 0; padding: .5rem .9rem; }
      pre { background: #f4f4f6; padding: 1rem; overflow-x: auto; min-height: 6rem; }
      #status { font-weight: 600; }
    </style>
  </head>
  <body>
    <h1>Midnight Passport — prototype</h1>
    <p id="status">Not connected.</p>
    <div>
      <button id="create">Create Passport account</button>
      <button id="open">Open with passkey</button>
      <button id="rotate" disabled>Rotate encryption key</button>
      <button id="wallet">Connect built-in wallet</button>
      <button id="copy">Copy evidence</button>
    </div>
    <h2>Evidence</h2>
    <pre id="evidence"></pre>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
```

`apps/passport-dapp/src/main.ts`:

```ts
import './polyfills.js';
import type { PassportAccount, PassportConnectorAPI, PassportConnectorDescriptor } from '@midnight-ntwrk/mn-passport-protocol';
import { installShim } from './connector.js';

installShim();
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const evidence: { network: string; steps: unknown[] } = { network: 'undeployed', steps: [] };
const record = (name: string, data: Record<string, unknown> = {}) => {
  evidence.steps.push({ name, at: new Date().toISOString(), ...data });
  $('evidence').textContent = JSON.stringify(evidence, (_k, v: unknown) => (typeof v === 'bigint' ? v.toString() : v), 2);
};
const status = (text: string) => { $('status').textContent = text; };

let api: PassportConnectorAPI | undefined;
let account: PassportAccount | undefined;
const connector = async () => {
  const descriptor = (window as unknown as { midnight: { passport: PassportConnectorDescriptor } }).midnight.passport;
  return (api ??= await descriptor.connect('undeployed'));
};
const run = (fn: () => Promise<void>) => async () => {
  try { await fn(); } catch (e) {
    const err = e as { code?: string; message?: string };
    status(`Failed: ${err.code ?? 'Error'} — ${err.message ?? String(e)}`);
    record('error', { code: err.code, message: err.message });
  }
};
const opened = async (a: PassportAccount, how: string) => {
  account = a;
  ($('rotate') as HTMLButtonElement).disabled = false;
  record(how, { address: a.address, binding: a.bindingId, state: await a.state() });
  status(`Account ${a.address.slice(0, 12)}… is ${how}.`);
};

$('create').onclick = run(async () => {
  status('Creating…');
  const a = await (await connector()).createAccount({ userName: `passport-${Date.now()}`, onProgress: (s) => { status(s); record(`create:${s}`); } });
  await opened(a, 'created');
});
$('open').onclick = run(async () => { status('Opening…'); await opened(await (await connector()).openAccount(), 'reopened'); });
$('rotate').onclick = run(async () => {
  status('Proving on the service (≈ 30 s)…');
  const r = await account!.rotateEncryptionKey(crypto.getRandomValues(new Uint8Array(32)));
  record('rotate', { ...r, state: await account!.state() });
  status(`Rotated in transaction ${r.txHash.slice(0, 16)}….`);
});
$('copy').onclick = () => void navigator.clipboard.writeText($('evidence').textContent ?? '');
```

- [ ] **Step 5: Run the dev server and open it.** With the service from Task 10 running:

```bash
nix develop -c bash -c 'export PASSPORT_CONTRACT_DIR="$D"; pnpm prototype:dapp'
```

Expected: Vite serves `http://localhost:5173` with no import errors. Open it in a browser (the app's Browser pane works for the load check). The console has no `Buffer`, `assert`, WASM or `WebSocket` errors, and `window.midnight.passport.apiVersion` is `'0.1.0-prototype'`. If a module fails to load, read the error: a missing alias goes into `resolve.alias` the same way the four above do.

- [ ] **Step 6: Commit.**

```bash
git add apps/passport-dapp/index.html apps/passport-dapp/vite.config.ts apps/passport-dapp/src/polyfills.ts \
  apps/passport-dapp/src/shims apps/passport-dapp/src/main.ts apps/passport-dapp/src/connector.ts apps/passport-dapp/src/acc-module.ts
git commit -S -s -m "feat(dapp): Passport harness — create, open and rotate with a real passkey

Assisted-by: AI"
```

---

### Task 12: Built-in wallet (DApp Connector stand-in)

**Files:**
- Create: `apps/passport-dapp/src/wallet/dev-wallet.ts`
- Modify: `apps/passport-dapp/src/main.ts`, `apps/passport-dapp/index.html`
- Test: `apps/passport-dapp/e2e/dev-wallet.e2e.ts`

**Interfaces:**
- Consumes: `walletSeedFromPasskey` (Task 9); the service `/config` (`networkId`, `indexerUri`, `indexerWsUri`, `nodeUri`). The wallet never proves or pays.
- Produces: `window.midnight.devwallet` with `{ name, apiVersion: '4.1.0', connect(networkId) }`. `connect` returns `getConfiguration`, `getConnectionStatus`, `getShieldedAddresses`, `getUnshieldedAddress`, `getDustAddress`, `getUnshieldedBalances` and `getDustBalance`, matching the DApp Connector API's `ConnectedAPI` names. It is created by `createDevWallet(seed: Uint8Array, config): Promise<DevWallet>`.

- [ ] **Step 1: Probe the synced state's shape.** The reference reads only `state.shielded.coinPublicKey` and `state.shielded.encryptionPublicKey`. The address and balance fields come from this probe. With the localnet up, in `$D`, inside `nix develop`:

```bash
cd "$D" && WALLET_SEED=0000000000000000000000000000000000000000000000000000000000000001 MIDNIGHT_NETWORK=local npx --no-install tsx -e "
import { createWallet, syncWallet } from './src/node/wallet.ts';
import * as Rx from 'rxjs';
const ctx = await createWallet(process.env.WALLET_SEED); await syncWallet(ctx, 'probe');
const s = await Rx.firstValueFrom(ctx.wallet.state().pipe(Rx.filter((x) => x.isSynced)));
for (const part of ['shielded', 'unshielded', 'dust']) console.log(part, Object.keys(s[part]), Object.getOwnPropertyNames(Object.getPrototypeOf(s[part])));
await ctx.wallet.stop(); process.exit(0);"
```

Expected: the property and method names of each part. Use them for the three `// FROM PROBE` lines in Step 3; every other call in Step 3 is copied from the reference `createWallet`.

- [ ] **Step 2: Write the failing e2e test** `apps/passport-dapp/e2e/dev-wallet.e2e.ts`. It runs in Node against the localnet (Node 22 has `WebSocket`):

```ts
import assert from 'node:assert/strict';
import { createDevWallet } from '../src/wallet/dev-wallet.ts';

const config = await (await fetch(`${process.env.PASSPORT_SERVICE_URL ?? 'http://localhost:8787'}/config`)).json();
const seed = new Uint8Array(32).fill(0); seed[31] = 1; // the genesis-funded dev seed
const wallet = await createDevWallet(seed, config);
const api = await wallet.descriptor.connect('undeployed');
const cfg = await api.getConfiguration();
assert.equal(cfg.networkId, 'undeployed');
assert.equal((await api.getConnectionStatus()).status, 'connected');
assert.match((await api.getUnshieldedAddress()).unshieldedAddress, /^mn_addr_undeployed1/);
const balances = await api.getUnshieldedBalances();
assert.ok(Object.values(balances).some((v) => v > 0n), 'the genesis wallet holds NIGHT');
await assert.rejects(wallet.descriptor.connect('testnet'));
console.log('dev wallet: PASS');
await wallet.stop();
```

Run: `nix develop -c bash -c 'cd apps/passport-dapp && node --import tsx e2e/dev-wallet.e2e.ts'`. Expected: FAIL, cannot find `../src/wallet/dev-wallet.ts`.

- [ ] **Step 3: Implement** `apps/passport-dapp/src/wallet/dev-wallet.ts`. It's the reference `deriveKeys` and `createWallet`, minus the Node-only pieces (`ws`, `node:http`, Level storage), using the platform's `WebSocket`:

```ts
import * as ledger from '@midnightntwrk/ledger-v9';
import { NoOpTransactionHistoryStorage } from '@midnightntwrk/wallet-sdk-abstractions';
import { DustWallet } from '@midnightntwrk/wallet-sdk-dust-wallet';
import { WalletFacade } from '@midnightntwrk/wallet-sdk-facade';
import { HDWallet, Roles } from '@midnightntwrk/wallet-sdk-hd';
import { ShieldedWallet } from '@midnightntwrk/wallet-sdk-shielded';
import { createKeystore, PublicKey, UnshieldedWallet } from '@midnightntwrk/wallet-sdk-unshielded-wallet';
import * as Rx from 'rxjs';

export interface DevWalletConfig { networkId: string; indexerUri: string; indexerWsUri: string; nodeUri: string }

/** The synced facade state, typed to the fields this wallet reads. */
interface SyncedState {
  isSynced: boolean;
  shielded: { coinPublicKey: { toHexString(): string }; encryptionPublicKey: { toHexString(): string } };
  unshielded: { address: string; balances: Record<string, bigint> };   // FROM PROBE
  dust: { address: string; walletBalance(at: Date): bigint };          // FROM PROBE
}

/**
 * A stand-in for lace-sdk's Midnight wallet: the DApp Connector API subset
 * the harness uses (spec §5.5). It never proves or pays; the Passport flows
 * are sponsored by the service.
 */
export async function createDevWallet(seed: Uint8Array, config: DevWalletConfig) {
  const hd = HDWallet.fromSeed(seed);
  if (hd.type !== 'seedOk') throw new Error('invalid wallet seed');
  const derived = hd.hdWallet.selectAccount(0).selectRoles([Roles.Zswap, Roles.NightExternal, Roles.Dust]).deriveKeysAt(0);
  if (derived.type !== 'keysDerived') throw new Error('wallet key derivation failed');
  hd.hdWallet.clear();
  const keys = derived.keys;
  void ledger; // keeps the ledger WASM initialised before the facade uses it, as in the reference.
  const unshieldedKeystore = createKeystore({ kind: 'schnorr', secret: keys[Roles.NightExternal] }, config.networkId);
  const facade = await WalletFacade.init({
    configuration: {
      networkId: config.networkId,
      indexerClientConnection: { indexerHttpUrl: config.indexerUri, indexerWsUrl: config.indexerWsUri },
      // Required by the configuration type; never contacted, since this wallet proves nothing.
      provingServerUrl: new URL('http://localhost:6300'),
      relayURL: new URL(config.nodeUri.replace(/^http/, 'ws')),
      costParameters: { feeBlocksMargin: 100 },
      txHistoryStorage: new NoOpTransactionHistoryStorage(),
    },
    shielded: (c: never) => ShieldedWallet(c).startWithSeed(keys[Roles.Zswap]),
    unshielded: (c: never) => UnshieldedWallet(c).startWithPublicKey(PublicKey.fromKeyStore(unshieldedKeystore)),
    dust: (c: never) => DustWallet(c).startWithSeed(keys[Roles.Dust]),
  } as never);
  await facade.start({ shielded: keys[Roles.Zswap], unshielded: keys[Roles.NightExternal], dust: keys[Roles.Dust] } as never);
  const state = () => Rx.firstValueFrom(
    (facade.state() as Rx.Observable<SyncedState>).pipe(Rx.filter((s) => s.isSynced)),
  );

  const connected = {
    getConfiguration: async () => ({ indexerUri: config.indexerUri, indexerWsUri: config.indexerWsUri, substrateNodeUri: config.nodeUri, networkId: config.networkId }),
    getConnectionStatus: async () => ({ status: 'connected' as const, networkId: config.networkId }),
    getShieldedAddresses: async () => {
      const s = (await state()).shielded;
      return { shieldedCoinPublicKey: s.coinPublicKey.toHexString(), shieldedEncryptionPublicKey: s.encryptionPublicKey.toHexString() };
    },
    getUnshieldedAddress: async () => ({ unshieldedAddress: (await state()).unshielded.address }),        // FROM PROBE
    getDustAddress: async () => ({ dustAddress: (await state()).dust.address }),
    getUnshieldedBalances: async () => (await state()).unshielded.balances,
    getDustBalance: async () => ({ balance: (await state()).dust.walletBalance(new Date()) }),
  };
  return {
    descriptor: {
      name: 'Built-in dev wallet', apiVersion: '4.1.0', rdns: 'io.iohk.passport.devwallet',
      async connect(networkId: string) {
        if (networkId !== config.networkId) {
          throw Object.assign(new Error(`wallet is on ${config.networkId}`), { type: 'DAppConnectorAPIError', code: 'InvalidRequest' });
        }
        return connected;
      },
    },
    stop: () => facade.stop(),
  };
}
```

Add to `apps/passport-dapp/package.json` `dependencies`, at the exact versions in `$D/package-lock.json` (after Task 1 Step 1's cooldown check): `@midnightntwrk/ledger-v9`, `@midnightntwrk/wallet-sdk-abstractions`, `-dust-wallet`, `-hd`, `-shielded`, `-unshielded-wallet`, and `rxjs` `7.8.2`. Then run `nix develop -c pnpm install`.

- [ ] **Step 4: Run the e2e test.** Run: `nix develop -c bash -c 'cd apps/passport-dapp && node --import tsx e2e/dev-wallet.e2e.ts'`. Expected: `dev wallet: PASS`.

- [ ] **Step 5: Wire it into the page.** Add to `apps/passport-dapp/src/main.ts`. The PRF ceremony is its own WebAuthn prompt, so the user picks the passkey there:

```ts
import { walletSeedFromPasskey } from '@midnight-ntwrk/mn-passport-adapter-browser';
import { createDevWallet } from './wallet/dev-wallet.js';
import { SERVICE_URL } from './connector.js';

$('wallet').onclick = run(async () => {
  status('Deriving the wallet seed from your passkey (PRF)…');
  const config = await (await fetch(`${SERVICE_URL}/config`)).json();
  const picked = (await navigator.credentials.get({ publicKey: {
    challenge: crypto.getRandomValues(new Uint8Array(32)), rpId: 'localhost', userVerification: 'required',
  } })) as PublicKeyCredential;
  let seed = await walletSeedFromPasskey({ credentialId: new Uint8Array(picked.rawId), rpId: 'localhost', networkId: 'undeployed' });
  if (!seed) {
    seed = new Uint8Array(32); seed[31] = 1;
    record('wallet:prf-unavailable', { fallback: 'the standalone network dev seed' });
  }
  const wallet = await createDevWallet(seed, config);
  (window as unknown as { midnight: Record<string, unknown> }).midnight.devwallet = wallet.descriptor;
  const w = await wallet.descriptor.connect('undeployed');
  record('wallet', { configuration: await w.getConfiguration(), unshielded: await w.getUnshieldedAddress(), dust: await w.getDustAddress() });
  status('Built-in wallet connected through the DApp Connector API.');
});
```

- [ ] **Step 6: Check in the browser.** With the service and `pnpm prototype:dapp` running, click "Connect built-in wallet". Expected: the evidence shows `configuration.networkId: 'undeployed'` and an `mn_addr_undeployed1…` address. If the browser's authenticator lacks PRF, the dev-seed fallback is recorded instead.

- [ ] **Step 7: Commit.**

```bash
git add apps/passport-dapp/src/wallet/dev-wallet.ts apps/passport-dapp/src/main.ts apps/passport-dapp/e2e/dev-wallet.e2e.ts apps/passport-dapp/package.json pnpm-lock.yaml
git commit -S -s -m "feat(dapp): built-in PRF-seeded wallet behind the DApp Connector API

Assisted-by: AI"
```

---

### Task 13: One-command stack, documentation and the recorded run

**Files:**
- Create: `scripts/prototype-up.sh`, `apps/README.md`
- Modify: `package.json` (root script `prototype:up`)
- Create: `experiments/acc-0.35/results/x9-dapp-manual-run.md`

**Interfaces:**
- Consumes: everything above.
- Produces: `pnpm prototype:up` starts the localnet (ordered start-up), the service and the dapp, after the guard.

- [ ] **Step 1: The script** `scripts/prototype-up.sh`:

```bash
#!/usr/bin/env bash
# Starts the Passport prototype: localnet → service → dapp, inside the Nix shell.
#   PASSPORT_CONTRACT_DIR=<fetch-acc.sh output> PASSPORT_MANIFEST_SHA256=<hash> pnpm prototype:up
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
"$root/experiments/acc-0.35/guard.sh"
: "${PASSPORT_CONTRACT_DIR:?set PASSPORT_CONTRACT_DIR}" "${PASSPORT_MANIFEST_SHA256:?set PASSPORT_MANIFEST_SHA256}"

have=$(docker info --format '{{.MemTotal}}' | awk '{printf "%.0f", $1/1073741824}')
[ "$have" -ge 24 ] || { echo "prototype-up: Docker has ${have} GiB; P-256 proofs need ≥ 24 GiB." >&2; exit 1; }

compose=(docker compose -f "$root/infra/localnet/docker-compose.yml" -f "$root/infra/localnet/docker-compose.macos.yml")
[ -f "$root/infra/localnet/.env" ] || printf 'APP__INFRA__SECRET=%s\n' "$(openssl rand -hex 32)" > "$root/infra/localnet/.env"
"${compose[@]}" up -d --wait node proof-server
until [ "$(curl -s -H 'content-type: application/json' -d '{"id":1,"jsonrpc":"2.0","method":"chain_getHeader","params":[]}' http://localhost:9944 | node -e 'let s="";process.stdin.on("data",c=>s+=c).on("end",()=>{try{console.log(parseInt(JSON.parse(s).result.number,16))}catch{console.log(0)}})')" -ge 2 ]; do sleep 2; done
"${compose[@]}" up -d --wait indexer

export MIDNIGHT_NETWORK=local
(cd "$root" && pnpm prototype:service) &
service=$!
trap 'kill $service 2>/dev/null' EXIT
until curl -sf http://localhost:8787/config >/dev/null; do sleep 2; done
cd "$root" && pnpm prototype:dapp
```

Add the root script `"prototype:up": "bash scripts/prototype-up.sh"` and run `chmod +x scripts/prototype-up.sh`.

- [ ] **Step 2: Documentation** `apps/README.md`:

````markdown
# Passport prototype — apps

A prototype of the Midnight Passport DApp Connector API and the web app that
carries its heavy lifting. Design: [`docs/superpowers/specs/2026-10-06-passport-dapp-design.md`](../docs/superpowers/specs/2026-10-06-passport-dapp-design.md).

| App | What |
|---|---|
| `passport-service` | Serves the ACC's ZK artefacts (`/zk/acc`), proves with server-side keys (`/prove`), deploys in waves (`/deploy`), sponsors fees (`/sponsor/*`), and keeps the passkey-to-account registry (`/accounts`). Holds the only funded key. |
| `passport-dapp` | The harness at `http://localhost:5173`: create a Passport account with a passkey, open it after a reload, rotate its encryption key (a passkey-signed, server-proved call), and connect the built-in wallet. |

Everything runs in the Nix shell, so other Compact or Midnight stack versions on the machine are never used:

```sh
nix develop
export PASSPORT_REPO=/path/to/your/passport/checkout
D=$(experiments/acc-0.35/fetch-acc.sh 45721e1 | tail -1)
experiments/acc-0.35/compile.sh "$D" full && (cd "$D" && npm ci --ignore-scripts)
export PASSPORT_CONTRACT_DIR="$D"
export PASSPORT_MANIFEST_SHA256=$(shasum -a 256 "$D/contracts/managed/account/compiler/contract-manifest.json" | cut -d' ' -f1)
pnpm install && pnpm build
pnpm prototype:up        # Docker memory ≥ 24 GiB
pnpm prototype:e2e       # in another shell: the automated MVP run
```

For lace-sdk: import `createPassportConnector` from `@midnight-ntwrk/mn-passport-account` and supply your own
`passkey`, `chain` (or `createServiceChain` from `@midnight-ntwrk/mn-passport-adapter-browser` with your wallet's
providers in place of the sponsor), and `registry` seams. Or inject the descriptor with `injectPassportConnector`.
````

- [ ] **Step 3: Full gate.** Run: `nix develop -c bash -c 'pnpm install --frozen-lockfile && pnpm test && pnpm run test:apps && pnpm run lint && pnpm run format:check'`. Expected: all PASS.

- [ ] **Step 4: Recorded manual run with a real passkey.** Run `pnpm prototype:up`, open `http://localhost:5173` in a browser with a platform passkey, and:
  1. Click "Create Passport account" and approve the passkey.
  2. Reload the page, then click "Open with passkey".
  3. Click "Rotate encryption key" and approve.
  4. Click "Connect built-in wallet".
  5. Click "Copy evidence".

Paste the evidence into `experiments/acc-0.35/results/x9-dapp-manual-run.md`, under a heading with the date, browser, authenticator, network, account address, transaction hashes, and the steps.

- [ ] **Step 5: Commit and push.**

```bash
git add scripts/prototype-up.sh apps/README.md package.json experiments/acc-0.35/results/x9-dapp-manual-run.md
git commit -S -s -m "chore(prototype): one-command stack, app docs and the recorded passkey run

Assisted-by: AI"
git log --format='%h %G? %s' -5
git push origin refs/heads/passport-acc-prototype:refs/heads/passport-acc-prototype
```

Expected: every listed commit shows `G`.
