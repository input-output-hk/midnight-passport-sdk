# Passport prototype: apps

A prototype of the Midnight Passport DApp Connector API and the web app that carries its heavy
lifting. Design: [`docs/superpowers/specs/2026-10-06-passport-dapp-design.md`](../docs/superpowers/specs/2026-10-06-passport-dapp-design.md).

| App                | What                                                                                                                                                                                                                                                  |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `passport-service` | Serves the ACC's ZK artefacts (`/zk/acc`), proves with server-side keys (`/prove`), deploys in waves (`/deploy`), sponsors fees (`/sponsor/*`) and keeps the passkey-to-account registry (`/accounts`). It also serves versioned config, binding-pinned artefacts, account hints, job-based prove/deploy and fee routes under `/v1`. It holds the only funded key. Binds `127.0.0.1:8787`. |
| `passport-key-service` | Standalone Node container for restoring, verifying and HTTP-serving the pinned ACC keys. It has no sponsor wallet; see its [image and operations guide](passport-key-service/README.md). |
| `passport-funding-service` | Separate wallet-backed process for an authenticated, allowlisted unshielded deposit into a deployed ACC. See its [operations guide](passport-funding-service/README.md). |
| `passport-dapp`    | The harness at `http://localhost:5173`: create and reopen a Passport account with a passkey, and fund the open ACC when launched with `demo up --funding`. Both arms seal a random ACC viewing secret; roster-safe rotation still needs chain-backed sources. The built-in wallet is separate from the ACC. |

## Documentation

The prototype's overview, the demo script, the flows, the key derivation and the limitations are in
[`docs/prototype/`](../docs/prototype/README.md). This file covers setup and operation.

## Prerequisites

- **Nix.** Everything runs in the repository's Nix shell (`nix develop`), so no other Compact or
  Midnight stack version on the machine is used. Each script starts with
  [`guard.sh`](../experiments/acc-0.35/guard.sh), which refuses to run outside it.
- **Docker with at least 24 GiB of memory** (Docker Desktop, Settings, Resources). P-256 proofs are
  k = 18 and need about 13.5 GiB each. Set `ACC_MIN_DOCKER_GIB` to change the check.
- **The ACC artefacts**, fetched and compiled with every key (about 12 GB, tens of minutes), as in
  [`experiments/acc-0.35/README.md`](../experiments/acc-0.35/README.md):

```sh
nix develop
export PASSPORT_REPO=/path/to/your/passport/checkout
D=$(experiments/acc-0.35/fetch-acc.sh 6458ed5 | tail -1)
experiments/acc-0.35/compile.sh "$D" full && (cd "$D" && npm ci --ignore-scripts)
export PASSPORT_CONTRACT_DIR="$D"
export PASSPORT_MANIFEST_SHA256=$(shasum -a 256 "$D/contracts/managed/account/compiler/contract-manifest.json" | cut -d' ' -f1)
pnpm install && pnpm build
```

## Environment

| Variable                   | Default                        | Meaning                                                                                                                  |
| -------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| `PASSPORT_CONTRACT_DIR`    | required                       | The `fetch-acc.sh` output, the directory holding `contracts/managed`.                                                    |
| `PASSPORT_MANIFEST_SHA256` | required                       | SHA-256 of `compiler/contract-manifest.json`, 64 hex characters (see the manifest pin).                                  |
| `MIDNIGHT_NETWORK`         | `local` (set by `prototype:up`) | Selects `CONFIG.local` in the reference wave-deploy code the service reuses; `patch-endpoints.sh` makes that read the `MN_*` variables below. |
| `MN_NETWORK_ID`            | `undeployed`                   | The Midnight network id: lower-case letters, digits and hyphens.                                                         |
| `MN_NODE_URL`              | `http://localhost:$MN_NODE_PORT` (19944) | Node, `http` or `https`.                                                                                        |
| `MN_INDEXER_URL`           | `http://localhost:$MN_INDEXER_PORT/api/v4/graphql` (18088) | Indexer GraphQL, `http` or `https`.                                                    |
| `MN_INDEXER_WS_URL`        | `ws://localhost:$MN_INDEXER_PORT/api/v4/graphql/ws` | Indexer subscriptions, `ws` or `wss`.                                                             |
| `MN_PROOF_SERVER_URL`      | `http://127.0.0.1:$MN_PROOF_PORT` (16300) | Proof server, `http` or `https`.                                                                               |
| `PASSPORT_PUBLIC_NODE_URL` | `MN_NODE_URL` | Browser-reachable node URL advertised by the service. Set when its own `MN_NODE_URL` uses a container-only address. |
| `PASSPORT_PUBLIC_INDEXER_URL` | `MN_INDEXER_URL` | Browser-reachable indexer GraphQL URL advertised by the service. |
| `PASSPORT_PUBLIC_INDEXER_WS_URL` | `MN_INDEXER_WS_URL` | Browser-reachable indexer subscription URL advertised by the service. |
| `PASSPORT_PUBLIC_PROOF_SERVER_URL` | `MN_PROOF_SERVER_URL` | Proof server URL advertised by the service. |
| `PASSPORT_PUBLIC_ZK_BASE_URL` | Service's own `/v1/zk/<bindingId>` | Optional dedicated key service URL. Must be the exact pinned `/v1/zk/<bindingId>` URL; the app independently pins it as `artefactUrl`. |
| `VITE_PASSPORT_ARTEFACT_URL` | Service's own `/v1/zk/<bindingId>` | Demo build-time pin when the dedicated key service supplies browser artefacts. |
| `MN_NODE_PORT`, `MN_INDEXER_PORT`, `MN_PROOF_PORT` | 19944, 18088, 16300 | The localnet's host ports (`infra/localnet/ports.env`); only the defaults of the URLs above.                |
| `PASSPORT_NETWORK_ID`      | `undeployed`                   | Build-time pin of the dapp (read by `vite build`/`dev`) and the e2e: the network the page is bound to. `prototype:up` sets it from `MN_NETWORK_ID`. A service on another network is refused (`NetworkMismatch`). |
| `VITE_PASSPORT_ARM`        | `p256`                         | Browser ACC authoriser arm, `p256` or `jubjub`. `pnpm demo up --arm jubjub` sets it for the dev page. Both modes expose create/open; the rotate button is hidden. |
| `PASSPORT_SERVICE_HOST`    | `127.0.0.1`                    | Service bind address. A non-loopback host exposes the sponsor to whoever can reach it.                                   |
| `PASSPORT_SERVICE_PORT`    | `8787`                         | Service port. The dapp expects 8787 unless `VITE_PASSPORT_SERVICE_URL` says otherwise.                                   |
| `PASSPORT_MAX_DEPLOYS`     | `20`                           | Deploy cap per service process.                                                                                          |
| `PASSPORT_REGISTRY_FILE`   | `~/.midnight-passport/registry.json` | The passkey-to-account registry; the deployed set sits beside it as `registry.deployments.json`, and the v1 hint store is `registry.json.v1`. Kept outside the repository so accounts can be reopened later. Delete all three when you reset the chain. |
| `PASSPORT_SPONSOR_SEED`    | the localnet genesis dev seed, on `undeployed` only | The sponsor wallet's seed. The default is public knowledge and funded on the localnet only; another network requires this or `PASSPORT_SPONSOR_SEED_FILE`. |
| `PASSPORT_SPONSOR_SEED_FILE` | unset | Path to a file containing the sponsor wallet's 32-byte lowercase hex seed. Preferred for the service image; mutually exclusive with `PASSPORT_SPONSOR_SEED`. |
| `PASSPORT_DEMO_FUNDING_ENABLED` | unset | Set to `1` by `demo up --funding`. Enables the localnet-only browser funding route on the Passport service; requires the token and asset policy files described in the funding service guide. |

The service validates its `MN_*` URLs at start-up and compares them with the reference client's
`CONFIG`. `GET /config` and `GET /v1/config` advertise the corresponding `PASSPORT_PUBLIC_*`
URLs when set, or the `MN_*` URLs otherwise. The browser must be able to reach the advertised
node and indexer URLs directly.

### The Midnight stack

One file per stack, `infra/networks/<name>.env`, holds the five `MN_*` values.
`infra/networks/undeployed.env` is the local Docker localnet, with the URLs written out in full
(a test keeps it in step with `ports.env`). `infra/networks/testnet.env.example` is a template
with placeholder URLs for a hosted stack; copy it to `testnet.env` and fill it in. Testnet is
not ready to run: it needs hosted artefacts, a reachable proof server and a real sponsor
(LW-15635). Select a stack with `MIDNIGHT_STACK=<name> pnpm prototype:up` (default `undeployed`).
The script sources the file, starts the Docker localnet only for `undeployed`, and exports
`PASSPORT_NETWORK_ID` for the dapp. The sponsor seed default is localnet-only: any other stack
needs `PASSPORT_SPONSOR_SEED_FILE` or `PASSPORT_SPONSOR_SEED`, or the service refuses to start.

The reference client must read the same stack. `experiments/acc-0.35/patch-endpoints.sh <dir>`
(run by `fetch-acc.sh`) rewrites `CONFIG.local` in its `wallet.ts` and the indexer fallback in
`capture.ts` to read the `MN_*` variables, falling back to the ports. Rerun it on an already
patched tree to upgrade an older patch; it is idempotent.

## Running

```sh
PASSPORT_REPO=/path/to/passport nix develop -c pnpm demo up  # pinned export, build, then all services
pnpm demo check          # preflight only
pnpm demo setup          # prepare the ACC without starting services
pnpm prototype:up        # localnet, then service, then dapp; Ctrl-C stops the service and the localnet
pnpm prototype:service   # the service alone (localnet already up)
pnpm prototype:dapp      # the dapp alone, at http://localhost:5173
pnpm prototype:e2e       # in another shell: the automated MVP run with a software passkey
```

`pnpm demo up` is the presenter entry point. It uses the ACC revision and compiler-manifest SHA-256
from the released contract binding, exports the reference source, compiles the keys on first use,
verifies or restores missing keys, installs and builds dependencies, and launches `prototype:up` plus the standalone key service at
`127.0.0.1:8788`. It reuses a compiled tree on later runs. The browser still reads its artefacts
through the Passport service on 8787; the separate key service is available to backend consumers.
Pass `--contract-dir` to reuse a prepared export, `--no-key-service` to skip that service,
`--mock-passkey` for the dev-only mock URL, or `--open` to open the page. The key service verifies
the whole key cache before it reports ready, so even a rerun may pause there. The CLI refuses busy
ports without stopping their occupants. See [AGENTS.md](../AGENTS.md) for prerequisites and the
manual setup path.

`demo up --funding` also starts the separate funding wallet. Supply
`PASSPORT_FUNDING_TOKEN_FILE` and `PASSPORT_FUNDING_ASSETS_FILE` as in the
[funding service guide](passport-funding-service/README.md), with NIGHT and/or another unshielded
asset held by that wallet. The page then shows **Fund Passport account** and an asset selector;
open an ACC before clicking it. The Passport service forwards a fixed deposit of up to 10 smallest
units of the selected asset while keeping its bearer token out of the browser.
The account card reads unshielded NIGHT and test-token balances separately. The button shows the
confirmed balance and keeps a separate request ID per asset across retries.
With funding enabled, **Withdraw from Passport account** uses the account SDK's owner-authorised
unshielded flow. Enter a positive smallest-unit amount and a full `mn_addr_…` user address for the
current network. The page fetches the live ACC balance, rejects an amount above it, then displays
the network, ACC, asset, amount and destination for explicit confirmation before asking for passkey
consent. It logs the confirmed transaction and rereads the ACC balance. The built-in wallet only
reads addresses and balances; receiving an asset there does not give this demo wallet a send button.
After an indeterminate submit error, inspect the live ACC and recipient before trying again.
The page also has **Open by ACC address**: paste the public 64-character lowercase ACC address and
choose an already-enrolled passkey. This verifies its live device entry and sealed viewing key
without relying on the local directory hint. It cannot discover an unknown address or recover a
lost passkey. The requested and verified addresses appear in the operation trace.
**Read shielded holdings** opens the ACC's sealed inbox with the current passkey and compares each
coin with the indexer's successful output event, exact Merkle index, and recorded ACC spend events.
Only still-unspent coins appear with public color, value and inbox position; the page and exported
log omit the viewing secret and coin nonce. This is separate from the unshielded balance shown in
the account card. A localnet shielded deposit is needed to populate the panel; the funding button
deposits unshielded assets. The panel clears after a later account action and requires a fresh read.
**Refresh ACC state** rereads live account counters and, with funding enabled, unshielded ACC
balances without another passkey prompt.

To add a second sealed device, open the demo in another browser profile at the same `localhost`
origin. Put the owner ACC address in **Open by ACC address** and select **Prepare joining device**.
That browser creates a new passkey and displays public handoff JSON plus its SHA-256 fingerprint.
Copy the JSON to **Joining device public handoff JSON** on the owner browser. Select **Read device
roster**, then **Enroll joining device**. Compare the fingerprint on both screens before consenting
with the owner passkey. The page confirms the enrollment transaction and checks the new commitment
in the live ACC roster. On the joining browser, use **Open by ACC address** with its new passkey.
The handoff contains only ACC address, network, binding, public reader/authoriser keys and the P-256
WebAuthn policy. If delivery is interrupted, reread the roster and reopen with the joiner; a
confirmed entry is authoritative. Retry enrollment only if the entry is absent, using the same
joiner public handoff. An active read grant without a durable opening blocks enrollment; device
removal remains unavailable in this browser until every live reader and read-grant target can be
verified and resealed.

Expand **Operation trace (requests and responses)** to inspect the chronological public-field
trace. **Copy full log** includes that trace, Passport events (including deploy waves), account
state and built-in wallet addresses and balances; raw transaction bodies and secret material are
excluded. Start a fresh page session before create/open if you need the complete sequence.

The standalone key service defaults to all 52 circuits. For a smaller JubJub owner cache, set
`PASSPORT_KEY_PROFILE=jubjub-owner-v1`; its `/v1/profile` endpoint lists the ten available circuits.
Set `PASSPORT_KEY_CORS_ORIGINS` to comma-separated browser origins when serving an application such
as Lace. The [key service guide](passport-key-service/README.md) describes the cache and HTTP paths.

`prototype:up` checks, in order: the Nix toolchain, the two required variables (and that the hash
matches the manifest on disk), Docker memory, and that ports 19944, 18088, 16300, 8787 and 5173 are
free (for another stack, only 8787 and 5173, and no Docker). If one is taken it names the occupant (container or process) and exits; it never stops
anything for you. `bash scripts/prototype-up.sh --check` runs only the port check. It then starts
the node and proof server, waits for block 2 (the indexer's SPO client fails on a chain still at
genesis), starts the indexer, then the service, then the dapp. On exit it stops only the containers
it started and leaves their volumes, so a rerun resumes the same chain. To reset the chain, run
`experiments/acc-0.35/run.sh "$D" down` and delete the registry file and its `.deployments.json`.

Open `http://localhost:5173` in a browser with a platform passkey. `prototype:e2e` writes its
evidence to `experiments/acc-0.35/results/x8-dapp-e2e.json`.

**No authenticator?** Under `pnpm prototype:dapp` (Vite dev only), open
`http://localhost:5173/?mockPasskey`. A dev-only mock (`src/dev/mock-passkey.ts`) replaces
`navigator.credentials` before the app loads, so the real UI path runs end to end: a WebCrypto
P-256 key, `wa-json134` assertions (37-byte authenticator data, flags UP+UV) and PRF as
HMAC-SHA256 under a random per-credential secret. As Google Password Manager is expected to, it answers
both PRF salts already at create, so create asks twice; `?mockPasskey=noprf-results` answers only
`prf.enabled` at create, so the third prompt (the separate PRF ceremony) can be clicked through.
Its credentials, private keys and PRF secrets
included, are kept in `localStorage` (`passport-dev:mock-passkey:v1`) so that "Open with passkey"
works after a reload; a discoverable prompt picks the newest one. The page shows a "MOCK PASSKEY —
dev only" banner and the evidence records `"passkey": "MOCK …"`. Production builds do not contain
the mock. `pnpm --filter passport-dapp test` checks it against `browserPasskey`'s enrolment probe
and `assertionMaterial`.

## What to know

- **Save the passkey in a PRF-capable provider: Google Password Manager or iCloud Keychain.**
  The account and the built-in wallet need the WebAuthn PRF extension. When Chrome asks where to
  save the passkey, do not pick the "Chrome profile" store: it has no PRF, and neither do some
  security keys. Create asks for PRF and refuses, right after the first prompt and before
  anything is deployed, any provider that does not confirm it (`UnsupportedAuthenticator`, "choose
  a PRF-capable provider").
- **Passkey prompts vary by provider and account state.** Create first makes a credential and
  checks its signing profile, then obtains a PRF reader key and publishes two sealed entries with
  P-256 signatures. Open starts with a discoverable passkey picker, then uses the PRF to open the
  live ACC envelope. A resumed create may need more signing prompts to publish missing entries.
  Subsequent prompts are pinned to the account credential (`allowCredentials`). The enrolment
  probe checks the `wa-json134` material; PRF cannot share that assertion because its extension
  data would change the signed profile. PRF outputs remain in memory only and are zeroed after use.
- **No PRF at a later prompt.** If the wallet's PRF ceremony gets no output, the error says the
  passkey has no PRF, or is a different passkey from the account's: choose the account's own
  passkey, saved in Google Password Manager or iCloud Keychain.
- **Reopening checks the directory.** The directory is only a hint. `openAccount` uses a record only
  when the passkey you picked owns the record's key, a contract exists at its address, and that
  contract holds the passkey as a device. Anything else is `AccountNotFound`, which after a chain
  reset usually means a stale directory (see Troubleshooting). The demo can discover an old
  deterministic-key hint, but the current sealed-key browser composition refuses it until a
  migration path exists. For disposable localnet accounts, create a fresh passkey and account.
- **The ACC secret is random and sealed.** The passkey PRF root derives a network-specific X25519
  reader key under `lace-passport:reader:v1`, while the ACC's random viewing secret determines
  `enc_key`. The browser publishes a type `0xd1` device envelope and P-256 type `0xd5`
  registration with the passkey's WebAuthn policy. The wallet seed remains independent. The account
  API can rotate this secret or remove an enrolled passkey with live-reader, chain-backed holding
  and grant-target checks. The
  page hides rotation until it supplies those host sources. See
  [`docs/prototype/keys.md`](../docs/prototype/keys.md).
- **Shielded holdings reads use a chain-backed source.** The browser checks the ACC output event,
  exact Merkle index and successful ACC input nullifiers before displaying an opened coin. If the
  indexer cannot provide any of these, the read fails closed. An already-spent output is omitted.
- **P-256 enrollment needs host discovery.** The account API can deliver a sealed key and add a
  second live P-256 device. If read grants are active, the host must supply verified holdings and
  complete grant targets so the account rotates its viewing and roster keys and reseals every
  grantee before giving the joiner a fresh key. The joining host can call
  `openAccountAt(address)` with its passkey; the demo does not yet expose that address-based flow.
- **The service binds loopback** (`127.0.0.1`). CORS lets only the dapp origin read its answers,
  which on its own does not stop a cross-site page from sending a request. So the service also
  answers `415` to any POST or PUT whose `content-type` is not `application/json` (that forces a
  CORS preflight, which only the dapp origin passes) and `421` to any `Host` other than
  `127.0.0.1`, `localhost` or `[::1]` at its port, or `PASSPORT_SERVICE_HOST` when set (DNS
  rebinding).
- **Sponsor policy** (spec section 4.3):
  - _Calls only._ `/sponsor/balance` balances only a standard transaction whose every contract
    action is a call.
  - _Deployed accounts only._ Each call must target a Passport account this service deployed and
    that is registered on its network in the v1 directory or legacy registry. Deploy and maintenance actions are refused.
  - _Fee-only._ No unshielded offer, no Dust action and no shielded offer, and no non-Dust
    imbalance in any segment.
  - _Deploy cap._ At most `PASSPORT_MAX_DEPLOYS` requests through `/deploy` and `/v1/deploy`
    combined per service process, failures counted, then `429`. The count resets on restart.
  - _First arm._ `/deploy` accepts `firstArm: "p256" | "jubjub"` and installs that arm's verifier keys
    first. Omitted `firstArm` retains the prototype's P-256 behavior. The SDK connector currently
    selects P-256; the JubJub account flow is a separate release gate.
  - _Grant publication._ Both account arms can issue and recover staged grants through host ports, settling sealed bookkeeping and read seals. The host must provide a live `grantCommitments` source; publication compares the staged opening with the ACC object and read-key commitments at the signing nonce. This demo page does not configure a grant journal or expose grant controls yet.
  - _Grant revocation._ The reusable package rotates before revoking a read grant or clearing every grant; revoke-all seals the new secret to devices only. The demo page has no grant controls yet.
    Read issue and revoke-all rotate inside their owner key session; the page does not exercise Lace's hosted signer.
    The sealed P-256 package flow can also rotate away from live read grantees before clearing the
    grant map or selectively revoking one read grant; the browser demo does not configure its
    verified holding and read-target sources.
  - _Read-grant delivery._ The reusable package can prepare sealed records for active read grantees; this demo does not yet run grant-aware rotation or publish those records.
- **Manifest pin (R18).** The dapp bakes `PASSPORT_MANIFEST_SHA256` in when Vite starts and checks
  the service's `/v1/config` against it, refusing a mismatch (`ArtefactIntegrity`). It is never read
  from the service, which could otherwise vouch for its own tampered artefacts. The service
  verifies the same hash and every listed file at start-up. Changing the artefacts means
  restarting both.
- **Built-in wallet.** An in-page wallet built with `HDWallet.fromSeed` from the passkey's
  BIP-39 seed (above), exposed as `window.midnight.devwallet`. Lace has no phrase-derived
  Midnight wallet in scope; this is the prototype's stand-in. Without PRF it fails with
  `UnsupportedAuthenticator`: there is no fallback seed, so it never opens a different, empty
  wallet, and the web app never carries the genesis (sponsor) seed. The ACC flows do not depend
  on the wallet: fees are sponsored.

## Production requirements (not built)

Authenticated sessions (a signed-in passkey or a dApp credential) on `/v1/prove-tx`, `/v1/sponsor/*` and
`/v1/deploy`; per-client rate limits; spending caps per client and per day on the sponsor; proof of
possession on `PUT /v1/accounts`; a per-job timeout on the proof queue; durable deploy counters (the
cap resets on restart); TLS in front of the service; and the indexer and node endpoints pinned at
build time, like the manifest. Today the browser takes them from the service's `/v1/config`, so a
compromised service could fake the ledger that `openAccount`'s checks read.

## Troubleshooting

The packaged JubJub grant source is `createMidnightGrantSource` in
`mn-passport-adapter-midnight-js`. A host supplies the pinned ACC binding, same-network public-data
provider, and durable read-key openings. It reads the live grant map and checks opening hashes for
viewing-key rotation; the standalone demo does not yet wire a grant opening store or grant UI.
Grant issue also reads the roster's auth nonce and refuses a change after signing, before it
stages an opening or submits the circuit.
The owner flow now names the creation lock choice and full grant context in its key-session
descriptor for hosted signers; the demo's local passkey authoriser ignores that display metadata.

- **A port is taken.** The preflight names the container or process. The Passport localnet
  publishes the node, indexer and proof server on host ports 19944, 18088 and 16300
  (`infra/localnet/ports.env`), so it runs beside another localnet on the Midnight defaults
  (9944/8088/6300). A clash usually means a stale run: stop it yourself, then retry. To move the
  stack, edit `ports.env` and the URLs in `infra/networks/undeployed.env` together.
- **`localhost` or `127.0.0.1`.** Open the dapp at exactly `http://localhost:5173`: the passkey's
  relying party and the ACC's origin binding are tied to that origin, and `127.0.0.1` will not
  work. The service listens on `127.0.0.1` only. If the browser or Node resolves `localhost` to
  `::1` first and fetches to `http://localhost:8787` are refused, start the dapp with
  `VITE_PASSPORT_SERVICE_URL=http://127.0.0.1:8787`.
- **`guard:` errors.** You are outside the Nix shell. Run `nix develop`.
- **`two compact-runtime copies are loaded`.** The dapp imports the generated `acc-s3r1.1`
  module through `#acc` from `mn-passport-contract`. That package pins the same
  `compact-runtime` peer used by midnight-js. Run `pnpm --filter passport-dapp test` to check
  runtime identity offline. The service still reads its contract artefacts from
  `PASSPORT_CONTRACT_DIR`.
- **`ProverUnavailable` after about 10 minutes.** The dapp gives up on `/prove` after 10 minutes,
  but proofs and deployments share one queue on the service. A rotation queued behind a `/deploy`
  (10 waves) can time out while the service keeps proving it. Wait for the deployment to finish,
  then retry.
- **Indexer requests fail in the browser.** The page queries the localnet indexer at
  `http://localhost:18088` from `http://localhost:5173`. Whether the indexer sends CORS headers has
  not been checked yet; look for a CORS error in the browser console before suspecting the
  connector.
- **Docker has too little memory.** Raise it to at least 24 GiB and retry. `/prove` otherwise
  reports `ProverUnavailable`.
- **Manifest hash does not match.** Recompute `PASSPORT_MANIFEST_SHA256` from the artefacts you
  compiled. It is only reproducible from the canonical `compile.sh` invocation.
- **The service exits at start-up.** Its first line says why: usually missing artefacts or a
  hash mismatch.
- **Stale directory after a chain reset.** The hint stores are only valid for the chain they were written on. `prototype:up` stops the localnet with its volumes kept, so accounts survive a restart. If you drop the volumes (`docker compose … down -v`, or `experiments/acc-0.35/run.sh`, which starts fresh), delete `~/.midnight-passport/registry.json`, `registry.json.v1` and `registry.deployments.json`, or opening fails with `AccountNotFound`.
