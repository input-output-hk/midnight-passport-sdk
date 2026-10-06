# Passport DApp prototype — design

> **Status:** draft for review · 2026/10/06 · prototype (MVP), branch
> `passport-acc-prototype` of the fork. Not a source-of-truth doc: accepted
> parts move into `docs/` through `doc-sync` with an ADR each. Brought in line
> with the code after the final whole-branch review (C1, C2, I1, M1–M9).
> **Serves:** Lace epic LW-15579 (Passport smart account as the Lace account
> model), to unblock LW-15635 (passkey Passport account) **on the standalone
> network**. Evidence base: `experiments/acc-0.35` (X1–X7).

## 1. Goal

Give the Lace team a working **prototype of the Midnight Passport DApp
Connector API** that lace-sdk (lace-platform's library for browser apps, which
contains the Midnight wallet) can consume from this fork, together with a
**Passport web app** that does the heavy lifting: it distributes the ACC's ZK
artefacts over HTTP, proves the large circuits server-side, deploys accounts,
and sponsors fees, so nothing large or secret has to live in the browser.

The official Passport connector API does not exist yet; this one is a
prototype that it may borrow from.

### 1.1 MVP use case — new user, passkey first

1. The user creates a passkey in the web app.
2. A Passport account (the ACC) is deployed for it, fee-sponsored: the user
   holds no tokens.
3. The passkey is installed as the account's first device.
4. One transaction **authorised by the passkey** confirms.
5. After a page reload the **same passkey reopens the same account**.
6. A built-in Midnight wallet, derived from the passkey's PRF output (the Lace
   recipe v1, §5.4), is connected through the standard Midnight DApp Connector API to show that
   wallet integration works.

Mapping to LW-15635's definition of done, on the standalone network:

| LW-15635 item | Here |
|---|---|
| A passkey creates a Passport account, and a transaction from it confirms | Steps 1–4 |
| The fee sponsor ships no funded secret inside the web app | The sponsor key lives only in the service (§4.4); the built-in wallet's seed comes only from the passkey's PRF, with no fallback seed of any kind (§5.5) |
| The same passkey reopens the same account after a reload | Step 5 (§5.3) |
| Account keys are bound to the network | Network id in the registry key and in the MIP-0015 context of the account's encryption key (§5.4) |
| The run is recorded | The app's evidence panel plus an end-to-end script (§8) |

### 1.2 Out of scope (MVP)

- The existing-wallet scenario ("add a passkey to an existing Midnight
  wallet"); grants, recovery, withdrawals.
- A public testnet: the standalone localnet only (LW-15635 itself targets
  testnet; this unblocks the same flow locally).
- Wiring into lace-platform: the fork stays self-contained; lace-sdk imports
  the packages and replaces the built-in wallet with its own.
- Publishing packages (FS-0.9 owns that); refactoring `mn-passport-contract`
  onto the 0.35.0 binding (FS-0.9 T1–T3).

## 2. Constraints from the evidence

| Constraint | Source | Consequence |
|---|---|---|
| The ACC (`45721e1`, 52 circuits) has 12.2 GB of prover keys; 15 single keys exceed 256 MB | X6 | Keys never travel to the browser; they stay on the service's disk |
| Our Nix build equals the contract team's in all 162 published hashes | X6 | The service may generate its artefacts from the pinned revision and pin the manifest hash |
| P-256 account proofs need about 13.5 GiB in the proof server; 8 GiB fails | X7 | The service's proof server runs with Docker memory ≥ 24 GiB |
| `activate_initial_device_with_p256(pk, salt, policy)` takes no signature and is k = 14 | ACC source | Activation is cheap; the first heavy proof is the first passkey-signed call |
| The WebAuthn profile `wa-json134` requires a 134-byte `clientDataJSON` and a **21-byte origin** | `webauthn.ts` | The dev origin is `http://localhost:5173` (exactly 21 bytes) |
| midnight-js 5's proving seam is `prove(serializedPreimage, keyLocation, overwriteBindingInput)` and the proof server's `/prove` takes the preimage plus key material | `midnight-js-http-client-proof-provider` | A browser `ProvingProvider` can forward the preimage and key location only; the service attaches the keys |
| Deploying exceeds a block; the reference deploys in 10 waves within a 15,000-verifier-byte budget, with hand-built maintenance updates | X7, `wave-deploy.ts` | Deployment is a service job |
| The SDK forbids versions younger than 7 days without a recorded exception | `CLAUDE.md` | Each pre-release dependency gets a recorded `minimumReleaseAgeExclude` entry, or waits |

## 3. Architecture

```mermaid
flowchart LR
  subgraph Browser["Browser — apps/passport-dapp (origin http://localhost:5173)"]
    UI[Harness UI]
    Shim["window.midnight.passport<br/>(adapter-browser shim)"]
    Acc["mn-passport-account<br/>connector implementation"]
    Wallet["Built-in wallet<br/>(DApp Connector API, PRF-seeded)"]
    PK[Passkey<br/>WebAuthn wa-json134]
  end
  subgraph Service["apps/passport-service (Node)"]
    ZK["GET /zk/acc/*"]
    Prove["POST /prove"]
    Deploy["POST /deploy"]
    Sponsor["POST /sponsor/*"]
    Reg["/accounts registry"]
  end
  Disk[("Artefacts<br/>pinned 45721e1")]
  subgraph Net["infra/localnet"]
    Node[node] --- Idx[indexer]
    PS[proof server]
  end
  UI --> Shim --> Acc
  Acc --> PK
  Acc --> ZK & Prove & Deploy & Sponsor & Reg
  UI --> Wallet
  ZK --> Disk
  Prove --> Disk
  Prove --> PS
  Deploy --> Node
  Sponsor --> Node
  Acc -. reads .-> Idx
```

### 3.1 Units

| Unit | Responsibility | Depends on |
|---|---|---|
| `packages/protocol` (existing) | Adds the **prototype connector types**: `PassportConnectorAPI`, its request/response shapes, error codes, `PASSPORT_CONNECTOR_VERSION = '0.1.0-prototype'`. Types and constants only. | — |
| `packages/account` (new, `@midnight-ntwrk/mn-passport-account`) | The connector **implementation**, platform-neutral: MVP flows (create, open, rotate), the device-entry counter scan and the P-256 challenge through the artefact's pure circuits (handed in as the `pureCircuits` seam), the registry client, and the checks that treat the registry as an untrusted hint (§5.3). Talks to the chain, the registry and the passkey through injected seams (§4.2); it assembles no transaction itself. | `protocol` |
| `packages/adapter-browser` (new) | Browser seams: WebAuthn `wa-json134` passkey adapter (create credential with an enrolment probe, identify with proof of ownership, assertion, PRF); the **chain seam** `createServiceChain`, which assembles and submits calls over midnight-js 5 (`submitCallTx`; a `ProvingProvider` that delegates to `/prove`; the service's sponsor as wallet and node provider; an indexer reader; `FetchZkConfigProvider` verifying against the app's manifest pin); `fetch` clients for the service; and the **shim** `injectPassportConnector(window, connector)`. | `account`, `contract`, `protocol` |
| `apps/passport-service` (new, Node) | ZK artefact host, delegated prover, deploy job, fee sponsor, account registry. Holds the only funded key. | the localnet, the pinned artefacts |
| `apps/passport-dapp` (new, Vite) | Harness UI; hosts the built-in wallet (a stand-in for lace-sdk's); injects the connector through the shim; shows evidence. | `adapter-browser`, `account`, `protocol` |

`scripts/dependency-graph.mjs` gains `account: ['protocol']` and
`'adapter-browser': ['account', 'contract', 'protocol']`; `apps/*` join the
pnpm workspace and stay outside the graph, which governs packages only.

## 4. Interfaces

### 4.1 Prototype Passport DApp Connector API (`protocol`)

```ts
export const PASSPORT_CONNECTOR_VERSION = '0.1.0-prototype';

export interface PassportConnectorAPI {
  readonly apiVersion: typeof PASSPORT_CONNECTOR_VERSION;
  /** Network the connector is bound to, e.g. 'undeployed'. */
  readonly networkId: string;
  /** Creates a passkey, deploys an ACC for it, installs it as the first device. */
  createAccount(options: CreateAccountOptions): Promise<PassportAccount>;
  /** Asks for an existing passkey and reopens its account on this network. */
  openAccount(): Promise<PassportAccount>;
}

export interface CreateAccountOptions {
  readonly userName: string;
  readonly onProgress?: (step: CreateAccountStep) => void;
}

export type CreateAccountStep =
  | 'passkey-created' | 'deploying' | 'deployed' | 'activating' | 'active';

export interface PassportAccount {
  readonly address: string;
  readonly networkId: string;
  readonly bindingId: string; // the artefact revision, e.g. 'acc-45721e1'
  /** Live state read from the indexer. */
  state(): Promise<PassportAccountState>;
  /** MVP passkey-authorised call: rotates the account's encryption key. */
  rotateEncryptionKey(newKey: Uint8Array): Promise<PassportTxResult>;
}

export interface PassportAccountState {
  readonly booted: boolean;
  readonly authNonce: bigint;
  readonly deviceEpoch: bigint;
  readonly entryCount: number; // not a device count (erratum 8)
  readonly specVersion: number;
}

export interface PassportTxResult {
  readonly txHash: string;
  readonly blockHeight?: number;
}

export type PassportErrorCode =
  | 'UserCancelled' | 'UnsupportedAuthenticator' | 'AccountNotFound'
  | 'ArtefactIntegrity' | 'ProverUnavailable' | 'SponsorRejected'
  | 'NetworkMismatch' | 'InternalError';

export interface PassportError extends Error {
  readonly type: 'PassportConnectorError';
  readonly code: PassportErrorCode;
}
```

Discovery mirrors the DApp Connector convention: the shim sets
`window.midnight.passport = { name, apiVersion, connect(networkId) }`, and
`connect` returns the `PassportConnectorAPI`. lace-sdk can either inject the
same object or import `createPassportConnector(seams)` from `account` and wire
its own seams.

### 4.2 Seams the implementation consumes (`account`)

```ts
export interface PassportSeams {
  readonly networkId: string;
  readonly bindingId: string;              // the artefact revision, e.g. 'acc-45721e1'
  readonly pureCircuits: AccPureCircuits;  // the generated module's pure circuits the MVP calls
  readonly passkey: PasskeySeam;           // WebAuthn in the browser; a software ES256 signer in the e2e
  readonly chain: ChainSeam;               // adapter-browser's createServiceChain over midnight-js
  readonly registry: RegistrySeam;         // HTTP client for /accounts
  random(length: number): Uint8Array;      // cryptographically secure
  // The account's X25519 enc_key for the passkey just created: in the browser, the passkey's
  // PRF root through the Lace recipe v1 and MIP-0015 (§5.4), one more prompt at create.
  encryptionKey(credential: PasskeyCredential): Uint8Array | Promise<Uint8Array>;
}

export interface PasskeySeam {
  create(userName: string): Promise<PasskeyCredential>;   // { credentialId, publicKey, policy }
  identify(): Promise<PasskeyIdentity>;                   // the discoverable-credential prompt
  sign(credential: PasskeyCredential, challenge: Uint8Array): Promise<PasskeySignature>;
}
export interface PasskeyIdentity {
  readonly credentialId: Uint8Array;
  /** True only when identify's own assertion verifies under this key and policy (§5.3). */
  owns(publicKey: P256PublicKey, policy: WebAuthnPolicy): boolean;
}

export interface ChainSeam {
  deploy(args: { boot: Uint8Array; encKey: Uint8Array }):
    Promise<{ address: string; txHashes: readonly string[] }>;  // txHashes: submission ids (§4.3)
  readLedger(address: string): Promise<AccLedgerView | undefined>; // booted, authNonce, deviceEpoch, hasEntry, …
  call(address: string, circuit: MvpCircuit, args: readonly unknown[]): Promise<PassportTxResult>;
}

export interface RegistrySeam {
  put(networkId: string, record: AccountRecord): Promise<void>;
  get(networkId: string, credentialId: Uint8Array): Promise<AccountRecord | undefined>;
}
```

### 4.3 Service HTTP API (`apps/passport-service`)

All JSON over HTTP; binary values are hex. CORS lets only the dapp origin **read** an answer,
which on its own does not stop any page the user visits from **sending** a "simple" request (a
`text/plain` POST needs no preflight). So the service also answers `415` to any request other than
`GET`, `HEAD` or `OPTIONS` whose `content-type` is not `application/json`, which forces a CORS
preflight that only the dapp origin passes, and `421` to any `Host` other than `127.0.0.1`,
`localhost` or `[::1]` at its port, or `PASSPORT_SERVICE_HOST` when set, which defeats DNS
rebinding. The adapter's clients always send `application/json`.

| Endpoint | Request | Response | Notes |
|---|---|---|---|
| `GET /config` | — | `{ networkId, bindingId, manifestSha256, indexerUri, indexerWsUri, nodeUri, zkBaseUrl, coinPublicKey, encryptionPublicKey }` | The connector checks `networkId`, refuses an app pin that is not 64 hex characters, and checks `manifestSha256` against that build-time pin, refusing a mismatch (`ArtefactIntegrity`). Deriving the pin from the contract binding is future work (Ruling R18). The network id and endpoints are the reference client's fixed localnet values (the service refuses to start with others); `zkBaseUrl` is the service's own `/zk/acc` under the checked `Host`; `coinPublicKey` and `encryptionPublicKey` are the sponsor wallet's, which midnight-js's wallet provider reports. The endpoints are not pinned (see the known limitations) |
| `GET /zk/acc/{compiler,zkir,keys}/…` | — | the file, `application/octet-stream` | Layout `FetchZkConfigProvider` expects; immutable cache headers, manifest `no-cache`. Prover keys are served (for completeness and other consumers) but the dapp never fetches them |
| `POST /check` | `{ preimage, keyLocation }` (hex, string) | `{ result: (string\|null)[] }` | midnight-js `ProvingProvider.check`: bigints as decimal strings, `undefined` as `null`. Circuit allow-listed (below) |
| `POST /prove` | `{ preimage, keyLocation, overwriteBindingInput? }` (hex, string, decimal string of at most 80 digits) | `{ proof }` (hex) | midnight-js `ProvingProvider.prove`: resolves `keyLocation` to the circuit, attaches its ZKIR and keys from the account bundle, calls the proof server. Allow-listed to the binding's circuits. One proof at a time (a P-256 proof needs about 13.5 GiB) |
| `POST /sponsor/balance` | `{ tx }` (hex; proven, unbound transaction) | `{ tx }` (hex; balanced, finalized) | The wallet provider's `balanceTx`: adds Dust fees from the sponsor wallet. Subject to the sponsor policy (below) |
| `POST /sponsor/submit` | `{ tx }` (hex; finalized) | `{ txId }` | The node provider's `submitTx` |
| `POST /deploy` | `{ boot, encKey }` (32 bytes each, hex) | `{ address, txHashes[] }` | `txHashes` carries each wave's **submission id** (what `submitTx` returns), not the hash of the transaction as included; the name stays for the prototype. Constructor inputs only; the service fills the recovery-at-birth defaults (a random JubJub key whose secret is discarded, a zero wrap, a 3-day veto window), runs the 10 waves and retires the authority in the last. Answers when the waves finish; the connector's `onProgress` steps carry the progress |
| `PUT /accounts/{networkId}/{credentialId}` | `{ credentialId, address, publicKey, salt, policy, status: 'deployed'\|'active' }` | `204`, or `409` if write-once violated | Write-once except `deployed` → `active`; returns `409` for any other transition or field change. Proof of possession required in production. The registry (§5.3) |
| `GET /accounts/{networkId}/{credentialId}` | — | `{ credentialId, address, publicKey, salt, policy, status }` or `404` | |

#### Service policy

Errors: a foreign `Host` is `421`; a body-carrying request that is not `application/json` is
`415`; a malformed or oversized body is `400` or `413`; a policy refusal is `403`;
the deploy cap is `429`; a full queue is `503`; a failure of the proof server, the
wallet or the chain is `502`. The `/sponsor/*` and `/deploy` `502` bodies are generic
and the detail is logged on the service.

- **Circuit allow-list.** `/check` and `/prove` accept a `keyLocation` that is a bare
  circuit id or midnight-js's canonical `contract:<address>/<circuit>?vk=<hash>`, and
  only when the circuit is one of the binding's. Anything else is `403`, before the
  queue. The set is the circuits that have both a prover key and compiled ZKIR in the
  compiler manifest, which is pinned by hash and verified at start-up. The delegated
  proving registry covers the account bundle only.
- **Sponsor policy: calls only.** `/sponsor/balance` balances only a transaction that:
  - is a standard transaction (no rewards claim) with at least one contract action,
    every one of them a **call** to a Passport account this service **deployed** and
    that is **registered** on its network (deploy and maintenance actions are refused);
  - carries **no unshielded offer** (guaranteed or fallible, of any content), **no
    Dust action** (registration or spend) and **no shielded offer**;
  - and, as defence in depth, moves nothing but Dust: in segment 0 and in every intent
    and fallible-offer segment, every non-Dust imbalance is zero.

  The offers are refused outright, not only when they carry value, because the wallet
  signs without checking owners: `signRecipe` on an unbound recipe signs every intent
  segment, and the unshielded wallet's `addSignaturesToOffer` puts the sponsor's
  signature on every input of the guaranteed and fallible offers, whoever owns it. A
  net-zero offer (an input that is the sponsor's NIGHT, an output paying the client the
  same) would pass an imbalance check and spend the sponsor's funds; a Dust
  registration shares the signed segment data and could redirect the sponsor's Dust
  generation. Bytes that do not deserialise as an unbound transaction are `400`. The
  guard sits in the service's balance step, not around the wallet provider, because the
  reference wave deploy balances its own deployment and maintenance transactions
  through that provider. The deployed set is persisted beside the registry file.
- **Deploy cap.** At most `PASSPORT_MAX_DEPLOYS` (default 20) `/deploy` requests per
  service process, failures counted, then `429`. Deployments share the proof queue, so
  one never overlaps a 13.5 GiB proof; the queue refuses a ninth waiting job with `503`.
  The queue has no per-job timeout in the prototype, so a proof server that never
  answers wedges it until the service restarts.
- **Binding.** The server listens on `127.0.0.1`. `PASSPORT_SERVICE_HOST` overrides
  it, and a non-loopback host exposes the sponsor to whoever can reach it. The `Host`
  check and the JSON content type (above) keep cross-site pages out of a loopback service.
- **Endpoints.** The network id and the indexer, node and proof-server endpoints are the
  ones the reference client hard-codes (`CONFIG.local`). `PASSPORT_NETWORK_ID`,
  `PASSPORT_INDEXER_URI`, `PASSPORT_INDEXER_WS_URI`, `PASSPORT_NODE_URI` and
  `PASSPORT_PROOF_SERVER_URI` may only restate them, and the service compares them with the
  reference at start-up, so `/config` never advertises a chain the sponsor does not use.
- **Dust races.** `/sponsor/balance` and `/deploy` are not coordinated, so a balance
  and a deployment wave running together can pick the same Dust. The loser fails at
  submit and no funds are lost; the client retries.

**Production requirements (not built in the prototype).** Authenticated sessions
(a signed-in passkey or a dApp credential) on `/prove`, `/sponsor/*` and `/deploy`;
per-client rate limits; spending caps per client and per day on the sponsor; proof of
possession on `PUT /accounts`; a per-job timeout on the proof queue; durable deploy
counters (the cap resets on restart); TLS in front of the service; and the indexer and
node endpoints **pinned at build time**, like the manifest, instead of taken from `/config`
(final review M6).

**Known limitations (recorded, not fixed).**

- *Untrusted ledger source (M6).* The browser reads the ledger through the indexer `/config`
  names. The artefacts are pinned and the ledger source is not, so a fully compromised service
  can fake the ledger: the §5.3 checks defend against a stale or poisoned registry, not a lying
  indexer.
- *Timeouts and queue position (M7).* The adapter gives up on `/prove` after 10 minutes and
  reports `ProverUnavailable`. A rotation queued behind a `/deploy` (10 waves) can exceed that
  while the service keeps proving; retry once the deployment has finished.
- *Indexer CORS (M8).* The browser queries `http://localhost:18088/api/v4/graphql` (the Passport localnet's host port, `infra/localnet/ports.env`) from origin
  `http://localhost:5173`. Whether the localnet indexer sends CORS headers is unverified; check
  it on the first manual run before suspecting the connector.

### 4.4 Secrets and authority

- The **sponsor key** (the localnet's genesis seed) and the **maintenance
  authority key** exist only in the service process. The authority is
  generated per deployment and **retired in the last wave**, so a deployed
  account can never be upgraded: the irreversible choice the epic's risk 12
  asks to record. A later decision can keep it instead.
- The **passkey's private key** never leaves the authenticator. The
  account's authority is the passkey's P-256 key (installed by activation).
- The **wallet seed** and the account's **encryption key** come from the
  passkey's PRF root (output #2, the Lace recipe v1, §5.4); they never authorise
  the ACC (AUTH-7: the authoriser is independent of the wallet seed).

## 5. Flows

### 5.1 Create (MVP)

1. `connect('undeployed')` → `GET /config`; refuse on network mismatch, and refuse a
   malformed app pin or a manifest mismatch (`ArtefactIntegrity`).
2. Passkey: `browserPasskey({ rpId: 'localhost', origin: 'http://localhost:5173' }).create`
   makes a **discoverable** (resident) ES256 credential, so §5.3 can find it
   without a stored id → credential id, P-256 public key. Then an **enrolment
   probe**: one throwaway assertion proves the authenticator produces the exact
   `wa-json134` material (flags, 37-byte authenticator data, origin, ES256)
   before anything is deployed. Create therefore asks for the passkey **twice**.
   A third prompt is the PRF ceremony (§5.4), which derives the account's
   encryption key; a passkey without PRF fails here with
   `UnsupportedAuthenticator`, before anything is deployed. PRF output adds
   authenticator extension data, which `wa-json134` rejects, so it cannot share
   the probe. Create therefore asks for the passkey **three times**.
3. Generate `salt`; take the encryption key from step 2; compute
   `boot = derive_boot_commitment_with_p256(salt, pk, policy)` with the
   artefact's pure circuit.
4. `POST /deploy` with the constructor arguments → address (≈ 10 waves).
5. `PUT /accounts/undeployed/{credentialId}` with status `deployed`, **before**
   activation: the salt it records is the only way to activate the account. The
   write is idempotent, so it is retried up to 3 times with backoff before
   `createAccount` fails.
6. Build `activate_initial_device_with_p256(pk, salt, policy)`; prove through
   `/prove` (k = 14); submit through `/sponsor/balance` and `/sponsor/submit`.
7. `PUT` the record again with status `active`; return the `PassportAccount`. If
   step 6 or 7 fails, the `deployed` record lets `openAccount` finish the job
   (§5.3).

### 5.2 Transact (MVP)

`rotateEncryptionKey(newKey)`: read `auth_nonce` from the indexer; compute
`challenge_rotate_enc_key_with_p256(address, pk, newKey, authNonce)` with the
pure circuit; ask the passkey for an assertion over it; build
`rotate_enc_key_with_p256(newKey, auth)`; prove through `/prove` (k = 18,
≈ 30 s, ≈ 13.5 GiB on the service's proof server); submit through
`/sponsor/balance` and `/sponsor/submit`.

### 5.3 Reopen after reload

`openAccount()`: a discoverable-credential assertion (`identify`) returns the
credential id and an `owns(publicKey, policy)` proof over that same assertion;
`GET /accounts/undeployed/{credentialId}` returns the record. The registry is the
MVP's discovery mechanism and an **untrusted hint** (Ruling R10(b)). Before the
record is returned, or marked active, all of these must hold, else
`AccountNotFound`:

1. the record's credential id is the picked one, and `owns(record.publicKey,
   record.policy)` is true: the identify assertion verifies under the record's key
   and policy, so a record naming some other account and that account's key fails
   here, with no extra prompt;
2. a ledger exists at `record.address` (read from the indexer);
3. for an `active` record, or a `deployed` record whose ledger is already booted,
   the passkey's device entry is found by the 0..63 counter scan
   (`derive_device_entry_with_p256`, the same scan rotate uses).

A `deployed` record whose ledger is booted and holds the passkey is adopted without
activating again (activation landed but its answer or the registry write was lost).
A `deployed` record on an unbooted ledger is activated: the boot commitment binds pk,
salt and policy on chain, so a mismatched record cannot activate someone else's
account; its entry is checked before the record is marked active. `AccountNotFound`
is the code for every failure: for the caller each means "no account this passkey can
open here", with the same remedy, and none is a defect of the connector.

The checks trust the indexer (§4.3 known limitations, M6). The epic's A6 (discovery
on a new device) is a later decision — a name lookup or chain scan.

### 5.4 Network binding and the Lace key recipe

The registry is keyed by `networkId`, and the connector refuses a service whose
`networkId` differs from its own.

The secrets below the passkey follow the **Lace recipe v1** (lace-platform
main, LW-15585 / LW-15584 / LW-15635), in
`packages/adapter-browser/src/lace-recipe.ts`, so the same passkey yields the
same wallet and the same account key here as in Lace:

1. **One PRF ceremony** on the user's credential (`allowCredentials`) evaluates
   two salts, each `SHA-256(utf8(label))`: `first` at
   `lace-passport/prf/authoriser/v1`, `second` at `lace/prf/root/v1`. No PRF, or
   no results, is `UnsupportedAuthenticator`; there is **no fallback seed**.
2. **Seed** from the root (output #2):
   `entropy = HKDF-SHA256(root, salt = empty, info = 'lace/hkdf/wallet-entropy/v1', 32)`;
   `words = entropyToMnemonic(HKDF-SHA256(entropy, salt = 'lace', info = 'wallet-seed', 32))`
   (24 English words); `seed = mnemonicToSeedSync(words)` (64 bytes). Every
   intermediate byte array is zeroed.
3. **Account encryption key**: MIP-0015 v1 `deriveSymmetricSecret(seed,
   domain = 'lace-passport:acc-enc:v1', context = '<networkId>/0')`, a SLIP-0021
   walk then HKDF-SHA256, ported verbatim from lace-platform; the account's
   `enc_key` is the X25519 public key of that secret. It is the network binding
   of the account's keys (the open MIP-0015 point in LW-15635), and it is
   reproducible from the passkey, so nothing stores it.
4. **Rotation targets** have no Lace recipe yet: `rotateEncryptionKey` takes a
   random key, a prototype extension.

The wallet seed itself is not network-bound, as in Lace: the network separates
wallets through address encoding and the wallet's network id.

**Divergence from Lace (recorded, no change).** Lace's ACC authoriser is a
JubJub key derived from PRF output #1. This prototype uses the ACC's P-256
WebAuthn arm, where the passkey signs each call itself, so output #1 is
evaluated (to keep the ceremony identical to Lace's) but unused.

### 5.5 Built-in wallet

An in-page wallet built on the Midnight wallet SDK against the standalone
node and indexer, seeded from the passkey's PRF output, exposed as
`window.midnight.devwallet` with the standard DApp
Connector `InitialAPI` / `ConnectedAPI` subset the harness uses:
`connect('undeployed')`, `getConfiguration`, `getConnectionStatus`,
`getShieldedAddresses`, `getUnshieldedAddress`, `getDustAddress`, the three
balance getters. The harness shows these to prove wallet integration. The ACC
flows do not depend on the wallet: fees are sponsored.

The seed is the passkey's 64-byte BIP-39 seed (§5.4), handed to the wallet SDK's
`HDWallet.fromSeed`. Lace has no phrase-derived Midnight wallet in scope, so this
is the prototype's stand-in. The PRF output comes from its own WebAuthn ceremony
at wallet connect: the user first picks the passkey, then confirms the PRF
evaluation, so connecting asks for the passkey twice. When the authenticator has
no PRF, connecting fails with `UnsupportedAuthenticator` on every network: it
never opens a different, empty wallet, and the web app never carries the genesis
(sponsor) seed (§1.1). This supersedes Rulings R22 and R24 (the random fallback).

## 6. Errors

The connector maps failures to `PassportErrorCode` (Ruling R16(b) for the service
statuses):

| Failure | Code |
|---|---|
| WebAuthn `NotAllowedError` or `AbortError`, or a dismissed prompt | `UserCancelled` |
| No ES256 key, or an enrolment probe outside `wa-json134`; no PRF (or no PRF results) at create or at wallet connect | `UnsupportedAuthenticator` |
| `404` from the registry; a record failing the §5.3 checks; no contract at the address | `AccountNotFound` |
| `ZkArtifactIntegrityError`; an app pin that is not 64 hex characters; a `/config` manifest that is not the pin | `ArtefactIntegrity` |
| Prover (`/prove`, `/check`): any 5xx (`502` fault, `503` full queue), the 10-minute `/prove` timeout, or an unreachable service | `ProverUnavailable` |
| Prover: `400` or `403` (a malformed request or a circuit outside the binding: a defect in the adapter) | `InternalError` |
| Sponsor (`/sponsor/*`, `/deploy`): `403` (policy), `429` (deploy cap) or any 5xx | `SponsorRejected` |
| Sponsor: any other 4xx, or a transport fault (no answer at all, which is not a refusal) | `InternalError` |
| `/config` on another network | `NetworkMismatch` |
| Anything else | `InternalError` |

The service fails closed when its artefact directory does not match the pinned
manifest hash, and refuses circuits or contracts outside the binding.

## 7. Repository layout and build

```
apps/passport-service/   Node HTTP server (no framework beyond node:http), tests
apps/passport-dapp/      Vite app, port 5173; built-in wallet under src/wallet
packages/account/        connector implementation (platform-neutral)
packages/adapter-browser/ WebAuthn, fetch clients, delegated ProvingProvider, shim
packages/protocol/       + connector types
```

- Artefacts: produced by `experiments/acc-0.35/compile.sh <dir> full` from the
  pinned revision `45721e1`; the service reads them from
  `PASSPORT_ARTEFACT_DIR` and checks the manifest hash at start-up. The dapp
  bundles the generated contract module from the same directory, copied first
  into `apps/passport-dapp/src/acc/generated/` (`scripts/sync-acc.mjs`, run
  before `dev`, `build`, `test` and `e2e`), so that its `compact-runtime` import
  resolves the workspace's copy, the one midnight-js uses.
- Everything runs in the Nix shell; the localnet from `infra/localnet` with
  Docker memory ≥ 24 GiB.
- One command starts the stack: `pnpm prototype:up` (localnet, service, dapp).

## 8. Testing

| Level | What | Status |
|---|---|---|
| Unit (`node --test`, repo style) | Connector flows against fake seams, including the §5.3 registry checks and the deployed-record retry; error mapping; WebAuthn and PRF against a software authenticator; service routes, the `Host` and content-type guards, the registry and the sponsor policy against a fake proof server and node; the shim; the wallet seed policy (fails closed); the Lace recipe and MIP-0015 against Lace's own vectors | Exists; runs in CI (`pnpm test`, `pnpm test:apps`) |
| Runtime identity (offline) | `apps/passport-dapp/e2e/runtime-identity.e2e.ts`: the generated module, synced into the dapp (`src/acc/generated`, imported as `#acc`), and midnight-js share one `compact-runtime`, with no resolve hook or dedupe | Exists; runs in `test:apps` when `PASSPORT_CONTRACT_DIR` is set, else skips |
| Integration | The service against the real localnet: `/zk` serves byte-identical files under the pinned manifest, `/prove` proves `activate_initial_device_with_p256`, `/deploy` deploys | Pending (R12): `apps/passport-service/test/reference.it.test.ts` covers the deploy leg behind `PASSPORT_IT=1` and has not yet run against a localnet |
| End-to-end script | `apps/passport-dapp/e2e/mvp.e2e.ts`: drives create → activate → rotate → reopen through the real connector with a software ES256 authenticator under `wa-json134` (as the contract team's tests do), records network, address, deploy submission ids and transaction hashes. A preflight stops it before any deploy if two `compact-runtime` copies are loaded | Script exists; the recorded run (R20, `experiments/acc-0.35/results/x8-dapp-e2e.json`) is pending |
| Manual, recorded | The same flow with a real passkey in a browser at `http://localhost:5173`; evidence (address, hashes, steps) exported from the app into `experiments/acc-0.35/results/` | Pending |
| Browser, no authenticator | `http://localhost:5173/?mockPasskey` under Vite dev: a dev-only mock replaces `navigator.credentials` (WebCrypto P-256, `wa-json134` assertions, PRF as HMAC-SHA256, persisted in `localStorage`), with a "MOCK PASSKEY — dev only" banner; excluded from production builds. `e2e/mock-passkey.e2e.ts` checks it against `browserPasskey`'s enrolment probe and `assertionMaterial` | Mock and its check exist (`test:apps`); a full run needs the localnet |

## 9. Delivery

Small, reviewable commits on `passport-acc-prototype`, in this order:
protocol types → service (zk, config, registry) → service (prove) → service
(deploy, sponsor) → account (create/open/rotate) → adapter-browser (passkey,
clients, shim) → dapp (wallet, UI, evidence) → end-to-end script → recorded
manual run. The implementation plan breaks these into tasks.

## 10. Risks and open questions

| # | Item | Mitigation / owner |
|---|---|---|
| R1 | The midnight-js 5 / wallet SDK pre-releases are young (7-day rule) and their browser builds may need polyfills | Record exclusions; the passport PWA demo runs the wallet SDK in a tab, so a known path exists |
| R2 | Building ACC calls in the browser needs the generated module and the wave-deploy helpers, which live in the contract team's TypeScript, not in a package | The dapp bundles the generated module from the pinned artefact build; `adapter-browser` assembles calls over midnight-js 5, and `account` reaches the pure circuits through a seam; the service reuses the reference wave-deploy logic |
| R3 | Sponsoring a transaction built elsewhere (balance with the sponsor's dust, then submit) | Balance on the service with the sponsor wallet's balancing API (`/sponsor/balance`, then `/sponsor/submit`), under the sponsor policy of §4.3; fall back to the service building the whole call if needed |
| R4 | Docker memory for P-256 proofs | Documented ≥ 24 GiB; `/prove` reports `ProverUnavailable` clearly |
| Q1 | Retire the authority at deploy (default) or keep it? | Owner decision (epic risk 12) |
| Q2 | Registry vs WebAuthn largeBlob vs name lookup for reopening on a new device | Later (epic A6, risk 14) |
| Q3 | Does lace-sdk inject `window.midnight.passport` or import the factory? | Both supported; Lace team to choose |
