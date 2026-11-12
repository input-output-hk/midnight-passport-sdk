# Passport prototype: apps

## Local prototype UX milestone

The [execution map](../docs/prototype/ux-milestone.md) tracks the approved
Settings/Activity/Audit redesign. The local demo composes four navigation workspaces, a
responsive Activity panel/sheet and a dedicated Audit workspace using portable
`account/interaction` models. [The UI guide](../docs/site/demo-ui.md) maps every
action to its new location. **Passport account** now uses **Balances / Deposit /
Withdraw** pages: refresh/shielded reads stay with balances, one transfer form is
shown at a time, and the open ACC/network remains visible. Contract counters are
expandable. Deposit uses the configured demo funding wallet; navigation never
starts a transfer or credential request. Form values survive same-page tab and
workspace changes; Settings’ session-target shortcut opens Withdraw. The [optional React host example](../docs/site/react-example.md) uses synthetic
public snapshots only; the optional Lace Wallet reader has separate real-provider
qualification and grants no ACC authority.
These changes are source after RC7; keep existing launch commands and durable
operation state. Optional host renderers must not initiate account actions while
rendering, subscribing or cleaning up a presentation control.

Local source after RC7 adds a read-only **Name service · mock adapter** panel.
It composes `account/names` with an app-owned in-memory `PassportNameService`.
Try `alice.passport.test` or `bob.passport.test`; these synthetic records are
not deployed accounts, require no passkey and never set a transfer recipient.
See [the naming adapter guide](../docs/site/names.md) before replacing the mock.
No registration or naming backend is launched; published RC7 is unchanged.

A prototype of the Midnight Passport DApp Connector API and the web app that carries its heavy
lifting. Design: [`docs/superpowers/specs/2026-10-06-passport-dapp-design.md`](../docs/superpowers/specs/2026-10-06-passport-dapp-design.md).

| App                | What                                                                                                                                                                                                                                                  |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `passport-service` | Serves the ACC's ZK artefacts (`/zk/acc`), proves with server-side keys (`/prove`), deploys in waves (`/deploy`), sponsors fees (`/sponsor/*`) and keeps the passkey-to-account registry (`/accounts`). It also serves versioned config, binding-pinned artefacts, account hints, job-based prove/deploy and fee routes under `/v1`. It owns the fee sponsor; the optional funding wallet and user's built-in wallet are separate. Binds `127.0.0.1:8787`. |
| `passport-key-service` | Standalone Node container for restoring, verifying and HTTP-serving the pinned ACC keys. It has no sponsor wallet; see its [image and operations guide](passport-key-service/README.md). |
| `passport-funding-service` | Separate wallet-backed process for an authenticated, allowlisted unshielded deposit into a deployed ACC. See its [operations guide](passport-funding-service/README.md). |
| `passport-dapp`    | The harness at `http://localhost:5173`: create and reopen a Passport account with a passkey, and fund the open ACC when launched with `demo up --funding`. Both arms seal a random ACC viewing secret; roster-safe rotation still needs chain-backed sources. The built-in wallet is separate from the ACC. |

## Candidate consent and browser regression

The signed-out entry uses the upstream-inspired **Sign up / Log in** landing with local
Passport artwork and **Powered by Lace** branding. The same create/open/address
controls keep their existing consent and state handling; successful access opens
**Passport account → Balances**. **Demo tools** exposes Audit and Settings while
the landing rail is hidden. No automatic wallet connection, owner enrollment or
JubJub owner unlock follows login. Reviewed login does warm the bounded routine
reader/wallet lease; it does not grant owner authority. See the [UI guide](../docs/site/demo-ui.md).

Active-account **Log in** and known-address opening now combine passkey discovery
and both Lace PRF evaluations in one user-verified credential request, with the
`identify-and-unlock` blocking review. Both sealed-key checks run within the same
short-lived login scope. The demo's optional verified `onAccountOpened` hook derives
a wallet-seed copy and adopts routine reader/wallet material for the reviewed
10/15/30-minute lifetime before that scope ends. Raw PRF copies are cleared; no
authenticated owner lease or wallet connection starts. Other hosts must opt in.
Failed or stale login/adoption leaves routine keys locked. Missing PRF/cancellation refuses without
an automatic second request. Pending setup and actual P-256 transactions may still
need signatures. This is source-only, not published RC7 or measured provider UX.
See [the prompt comparison](../docs/site/passkey-prompts.md).

The demo's navigation and account entry actions include app-owned SVG outlines.
They inherit the host theme and keep visible text labels; no icon library or
branding dependency is added to the SDK packages. See the
[UI guide](../docs/site/demo-ui.md#stable-navigation).

One combined operation/credential review precedes each actual passkey API call;
there is no extra generic dialog first. Creation includes the irreversible
maintenance-retirement acknowledgement in its first review. The `beforeCeremony`
hook pins actual purpose, attempt and RP; the host rechecks the captured lease
before/after approval and immediately before access. Cached routine reads and
wallet connection need no generic modal. Known owner withdrawal/export inputs
join the first actual credential review, with the captured route and exact inputs
checked again before POST/display. A matching scoped-grant transfer has no passkey
call and retains its standalone exact decision. Other late-bound device/grant
reviews remain separate. Retries still need fresh
approval; cancel never rolls back a submitted transaction or clears its unknown
outcome. The capability panel inspects proof plans, not readiness.

Run `nix develop -c pnpm run build` then `nix develop -c pnpm test:demo-browser` for isolated Chromium journeys across both owner-arm selections. This lane needs Chrome but no Docker/provider/live service. It uses the actual UI and mock credential API with synthetic connector/chain/wallet drivers. It owns an ephemeral server and intercepts all requests; it never changes a running demo. See [the use-case evidence map](../docs/site/use-case-coverage.md), [consent guide](../docs/site/consent.md) and separate native/provider recipes.


### Browser diagnostic groups

The default browser command retains all192cases across P-256/JubJub in their
original flow order. For a focused diagnostic, set one explicit arm and
`PASSPORT_DEMO_JOURNEY_GROUP` to `presentation`, `account-actions`,
`scoped-sessions` or `owner-safety`. Standalone groups create their prerequisites
through the UI; their bootstrap time is separate and earns no canonical case
credit. CI requires all eight cells plus an exact receipt-inventory aggregate.
See the [browser evidence guide](../docs/site/use-case-coverage.md#select-one-diagnostic-group)
and [CI policy](../docs/ci.md). Synthetic success does not establish provider or
native acceptance. Current agent commands/state rules are in the
[runbook](../docs/agent-runbook.md); historical guidance remains labelled and retained.

## Documentation

This file documents the reference demo's setup, environment and operation.
For reusable package integration, start with the [library guide](../docs/site/library-guide.md).
For UI flows and composition, use the [demo guide](../docs/site/demo-guide.md) and
[`docs/prototype/`](../docs/prototype/README.md). The demo's dialogs, local lease
policy and wallet worker are host choices, not automatic library behavior.

The [demo use cases](../docs/site/use-cases.md) cover the available browser scenarios.
After connecting the built-in wallet, **Refresh wallet balance** rereads its synced NIGHT,
token and DUST snapshot without another passkey prompt. This is a manual refresh; use it after
receiving an ACC withdrawal. **Refresh ACC state** updates the separate smart account.

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
| `VITE_PASSPORT_ARM`        | `p256`                         | Browser ACC authoriser arm, `p256` or `jubjub`. `pnpm demo up --arm jubjub` sets it for the dev page. Both modes expose create/open and reviewed sealed-key rotation. |
| `PASSPORT_SERVICE_HOST`    | `127.0.0.1`                    | Service bind address. A non-loopback host exposes the sponsor to whoever can reach it.                                   |
| `PASSPORT_SERVICE_PORT`    | `8787`                         | Service port. The dapp expects 8787 unless `VITE_PASSPORT_SERVICE_URL` says otherwise.                                   |
| `PASSPORT_MAX_DEPLOYS`     | `20`                           | Deploy cap per service process.                                                                                          |
| `PASSPORT_REGISTRY_FILE`   | `~/.midnight-passport/registry.json` | The passkey-to-account registry; the deployed set sits beside it as `registry.deployments.json`, and the v1 hint store is `registry.json.v1`. Kept outside the repository so accounts can be reopened later. Preserve them with their original chain; archive/reconcile unknown work before choosing fresh scoped state. |
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
The signed-out entry offers **Sign up** and **Log in**. There is no Overview
navigation item. Home returns an already-open account to **Balances** without
requesting credentials or resetting its state; in a fresh document it opens login.
All four multi-page workspaces use consistent page links in a persistent left rail.
Midnight wallet separates Built-in wallet and Lace Wallet. Audit separates Event log,
Requests & responses and Export JSON. Content and navigation scroll independently;
on compact screens use Menu to open the navigation drawer. Settings uses submenu
pages rather than top-level accordions. **Quick actions**
uses the reviewed login lease or an explicit unlock for 10/15/30 minutes, derives
JubJub grant children without repeated PRF prompts, and keeps critical owner
operations on the fresh-passkey path. A grant still needs separate owner approval;
unlocking alone does not authorize transfers. See [the guide](../docs/site/quick-actions.md).
Activity starts collapsed; its button sits beside the workspace title.
Below the entry actions, expand **Log in with an account address**: paste the public 64-character lowercase ACC address and
choose an already-enrolled passkey. This verifies its live device entry and sealed viewing key
without relying on the local directory hint. It cannot discover an unknown address or recover a
lost passkey. The requested and verified addresses appear in the operation trace.
**Read shielded holdings** opens the ACC's sealed inbox with the active routine reader
(or an explicitly reviewed fresh PRF request) and compares each
coin with the indexer's successful output event, exact Merkle index, and recorded ACC spend events.
Only still-unspent coins appear with public color, value and inbox position; the page and exported
log omit the viewing secret and coin nonce. This is separate from the unshielded balance shown in
the account card. A localnet shielded deposit is needed to populate the panel; the funding button
deposits unshielded assets. The panel clears after a later account action and requires a fresh read.
**Refresh ACC state** rereads live account counters and, with funding enabled, unshielded ACC
balances without another passkey prompt.
**Read grant roster** shows the live grant generation, nonce, public IDs and active/revoked status
from one ACC chain snapshot. **Recover pending grants** checks encrypted openings staged in this
browser against live commitments and resumes their sealed publication; unsettled IDs remain in
the operation log. Recovery/publication and sensitive opening export are critical
operations requiring fresh passkey approval, even under an unlocked full owner.
Public roster reads need no passkey. These actions do not create a grant or authorize
a grantee spend.

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
joiner public handoff. This browser retains openings for grants it issued in an encrypted local
journal bound to its passkey PRF. An active read grant whose opening is absent in this browser
blocks enrollment. For removal, copy the full target commitment from **Read device roster** into
**Device commitment to remove**, compare the displayed epoch and roster in the confirmation, then
sign. The SDK verifies and reseals every surviving reader and active read grantee before it removes
the target. If any opening or holding cannot be verified, removal stops. The operation spans
multiple transactions; after an uncertain result, inspect the live roster and inbox before
retrying. Clearing browser storage loses the local grant openings.

Choose **Audit → Requests & responses** to inspect the chronological public-field
trace. **Event log** and **Export JSON** have their own Audit pages. **Copy full log** includes that trace, Passport events (including deploy waves), account
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
it started and leaves their volumes, so a rerun resumes the same chain. For a fresh
disposable environment, select a new owned project and scoped state. Preserve the old
volumes, registries and original unknown intents; do not delete them to repair an error.

Open `http://localhost:5173` in a browser with a platform passkey. `prototype:e2e` writes its
evidence to `experiments/acc-0.35/results/x8-dapp-e2e.json`.

**No authenticator?** Under `pnpm prototype:dapp` (Vite dev only), open
`http://localhost:5173/?mockPasskey`. A dev-only mock (`src/dev/mock-passkey.ts`) replaces
`navigator.credentials` before the app loads, so the real UI path runs end to end: a WebCrypto
P-256 key, `wa-json134` assertions (37-byte authenticator data, flags UP+UV) and PRF as
HMAC-SHA256 under a random per-credential secret. The default fixture returns both
PRF results at create, so P-256 setup needs registration, its compatibility probe
and the two actual publication signatures, without another PRF request.
`?mockPasskey=noprf-results` returns only `prf.enabled` and adds one PRF request.
These are mock API-call budgets, not measured Google/iCloud sheet counts.
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
  and grant-target checks. The page supplies those sources and asks for a live-roster review before
  rotation. A missing device registration or read-grant recipient stops rotation before the key
  changes. See
  [`docs/prototype/keys.md`](../docs/prototype/keys.md).
- **Shielded holdings reads use a chain-backed source.** The browser checks the ACC output event,
  exact Merkle index and successful ACC input nullifiers before displaying an opened coin. If the
  indexer cannot provide any of these, the read fails closed. An already-spent output is omitted.
- **P-256 enrollment needs host discovery.** The account API can deliver a sealed key and add a
  second live P-256 device. If read grants are active, the host must supply verified holdings and
  complete grant targets so the account rotates its viewing and roster keys and reseals every
  grantee before giving the joiner a fresh key. The joining host can call
  `openAccountAt(address)` with its enrolled passkey. The demo exposes **Open by ACC address**;
  the cold-first path verifies the authentic sealed registration and live device before opening.
  It does not recover a lost passkey or discover an unknown address.
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
    first. Omitted `firstArm` retains the prototype's P-256 behavior. The browser selects P-256
    by default or JubJub through the CLI's `--arm jubjub` option.
  - _Grant publication._ Both account arms can issue and recover staged grants through host ports,
    settling sealed bookkeeping and read seals. The demo supplies a browser-local encrypted
    journal and live commitment readers. It exposes reviewed fixed-recipient unshielded spend
    grants, opening export/import, grantee spending, roster reads and recovery. The journal has
    authenticated pending/published status; legacy records are rechecked during recovery and upgraded
    on confirmed publication. It has no backup or cross-device synchronization; exported openings contain grant capability data
    and must be shared only with the intended holder.
  - _Grant revocation._ The page exposes selective revocation and revoke-all, with live roster
    confirmation. Read grants require rotation and complete surviving reader/grantee openings;
    unavailable openings refuse the operation. The page does not exercise Lace's hosted signer.
  - _Viewing-key rotation._ **Rotate sealed viewing key** reviews the live device count, verified
    holdings and active read grants before confirmation. The connector supplies chain-backed
    holding and grant sources and checks settlement. An empty inbox batch cannot validate the
    viewing key, so account opening requests an actual sealed entry.
  - _Read-grant delivery._ The reusable package can issue read grants and reseal their viewing
    capability during rotation. The demo's grant-issue form creates spend-only grants. Existing
    read grants can be preserved only when their complete openings are available to the host;
    otherwise rotation refuses before submission.
- **Manifest pin (R18).** The dapp bakes `PASSPORT_MANIFEST_SHA256` in when Vite starts and checks
  the service's `/v1/config` against it, refusing a mismatch (`ArtefactIntegrity`). It is never read
  from the service, which could otherwise vouch for its own tampered artefacts. The service
  verifies the same hash and every listed file at start-up. Changing the artefacts means
  restarting both.
- **Built-in wallet.** The browser's owned Worker hosts `HDWallet.fromSeed`, wallet
  subscriptions and synchronization. The page exposes its read-only descriptor as
  `window.midnight.devwallet`; Node probes use the direct runtime. The seed is derived
  from the passkey's root output, separately from the random sealed ACC viewing secret.
  Matching reviewed routine access can supply the seed without a new PRF request.
  This is the demo's read-only evaluation wallet, with separate external-wallet
  provider selection and qualification. Without PRF it fails with
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
viewing-key rotation. The standalone demo wires a browser-local encrypted opening store
and reviewed grant issue/export/import/spend/revoke/recovery controls in Settings → Permissions.
An opening created elsewhere remains unavailable unless explicitly imported or reconstructed
through the supported verified bookkeeping path.
Grant issue also reads the roster's auth nonce and refuses a change after signing, before it
stages an opening or submits the circuit.
The owner flow now names the creation lock choice and full grant context in its key-session
descriptor for hosted signers; the demo's local passkey authoriser ignores that display metadata.

- **A port is taken.** The preflight names the container or process. The Passport localnet
  publishes the node, indexer and proof server on host ports 19944, 18088 and 16300
  (`infra/localnet/ports.env`), so it runs beside another localnet on the Midnight defaults
  (9944/8088/6300). Identify the owner before acting: reuse a healthy intended stack or
  select free ports for your own. Never stop an unrelated session. To move your stack, edit `ports.env` and the URLs in `infra/networks/undeployed.env` together.
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
  (10 waves) can time out while the service keeps proving it. Inspect the original operation
  stage, request/job ID and service logs, then reconcile the same intent. A client timeout does
  not prove that no transaction was sent and must not trigger a replacement send.
- **Indexer requests fail in the browser.** The page queries the localnet indexer at
  `http://localhost:18088` from `http://localhost:5173`. Whether the indexer sends CORS headers has
  not been checked yet; look for a CORS error in the browser console before suspecting the
  connector.
- **Docker has too little memory.** Reserve at least 24 GiB before starting new proof work. Coordinate any engine restart with other stack owners; do not restart Docker as routine test cleanup. `/prove` otherwise
  reports `ProverUnavailable`.
- **Manifest hash does not match.** Compare the selected binding, compiler and artifact bytes with the independently trusted
  manifest pin. Do not change the trusted pin to match unexpected output. Restore the matching
  verified cache or use the canonical `compile.sh` invocation in a separate fresh build.
- **The service exits at start-up.** Its first line says why: usually missing artefacts or a
  hash mismatch.
- **Stale directory after an intentional chain reset.** Hint stores describe their original chain. Ordinary restarts preserve the chain volumes and accounts. After a deliberate fresh-chain reset, archive and reconcile the old registry, `registry.json.v1`, deployment log and transaction evidence before selecting fresh state. Do not delete registries, journals or unknown IDs to repair failed authentication or a timeout.

### Local durability milestone

The browser demo now falls back from its encrypted local grant journal to complete
published grant/object records using the selected original reader. It checks the
trusted origin and live commitments; missing, conflicting or inaccessible openings
remain refused. Another enrolled device need not possess the issuing reader's
grant opening. Full staged-opening export still requires the original journal.

Owner buttons continue to use the default account API. After an interrupted owner
mutation, reconcile the original transactions before retrying. Hosts can integrate
the new opt-in durable API, protected storage and authoritative/fenced submission
receipts using [the durability guide](../docs/site/durability.md). A browser reload
is not proof that a pending transaction failed. No remote deployment receipt service
or new backup/import UI is implied.

### Opt-in durable host RPC (RC7 preview)

The Node service can enable an authenticated host mutation route with
`PASSPORT_HOST_MUTATION_DIR`, `PASSPORT_HOST_MUTATION_KEY_FILE` and
`PASSPORT_HOST_MUTATION_TOKEN_FILE`. All three are required; use independent private
32-byte hex key/token files and retain the private journal mount across restarts.
The token belongs in the trusted wallet/host, never in a public `VITE_*` setting or
operation log. No existing sponsor/funding keys are reused or replaced.

The new `remoteHostMutationPorts` opt-in composition resumes the original saved
deployment and wave bytes. Default demo owner buttons are not migrated. Unknown
submissions, expired dispatches, missing constructor outputs and mismatched state
remain refused. See the [engineer guide](../docs/site/host-durability.md) for setup,
RPC, composition and offline-versus-live qualification limits.

### Built-in wallet lifecycle qualification

A stopped built-in wallet rejects existing API handles, late balance results and
new connections. Reconnect by creating a new instance with the existing approved
key source; stopping does not change the derivation recipe. Logical connection
status does not prove a fresh indexer connection. The opt-in `pnpm qualify run
wallet-reconnect` diagnostic and `survivor-reconnect` lifecycle suite check the actual
wallet composition against an owned standalone indexer outage and a fresh incoming
NIGHT credit. See the [live runbook](../docs/site/live-qualification.md#enrolled-survivor-and-wallet-reconnect).
These Node/software-fixture cases do not qualify real passkeys or seed-loss recovery.


### Opt-in durable host jobs (RC7 preview)

On top of the three host-mutation settings above, set `PASSPORT_HOST_JOB_DIR`,
`PASSPORT_HOST_JOB_KEY_FILE` and `PASSPORT_HOST_JOB_TOKEN_FILE`. Use distinct,
non-nested private journals and four independent private key/token values, separate
from the sponsor seed. Optional bounds are `PASSPORT_HOST_JOB_MAX_JOBS` (128),
`PASSPORT_HOST_JOB_MAX_ACTIVE` (8), `PASSPORT_HOST_JOB_EVENT_LIMIT` (32), and
`PASSPORT_HOST_JOB_COMPLETED_TTL_MS` (600000). Partial configuration fails startup.
`/healthz` advertises `hostJobs`; no token or private path is returned. The default
demo keeps its existing owner ports.

Jobs and direct host RPC share one executor, sponsor queue and process-local
deployment budget. Legacy/v1 sponsor balance/submit calls also use that queue.
SIGINT/SIGTERM drains HTTP, accepted jobs and queued wallet work; a 30-second
deadline exits nonzero with original-ID/journal retention guidance. The deployment
cap resets on restart; unknown work is never automatically replaced. For images,
retain both writable journals and mount four independent private files read-only
for the service UID. Published RC5 lacks this source feature.

[Engineer runbook](../docs/site/service-jobs.md) covers the low-level client,
`remoteHostJobPorts` owner composition, explicit recovery, resource bounds and
real HTTP/killed-process E2E commands. These tests use synthetic chain drivers,
not native proofs or real passkey providers. Legacy callback jobs remain volatile.

The opt-in public signer qualification harness is documented in
[`consumer-integration`](../docs/site/consumer-integration.md#public-source-signer-handlers).
It does not change the demo's default signer or enable unsupported hosted withdrawal/rotation
consent. An authorising-only new device still needs a separately supported reader-delivery flow
before it can view shielded holdings. Native acceptance requires an exact-source receipt.

Shielded deposit recovery is a next-candidate library composition with protected host storage and
read-only original sender/finality evidence. The demo funding service still exposes unshielded
deposits. No new service, wallet, token, policy or environment variable is enabled by that library
change; see [the recovery contract](../docs/site/shielded-deposit-recovery.md).

### Redacted HTTP diagnostics

The shared server exposes the optional `onRouteError({ status, headersSent })` configuration
callback (synchronous or async; failures are isolated and never awaited). Unexpected failures return generic `500` JSON; no raw exception is exported. After
headers are sent the response is destroyed, so clients reconcile uncertain original mutation IDs
rather than interpreting an incomplete stream as proof that nothing was sent. See the service
engineer guide for origin-form request-target rules.

## Source demo increment: consented JubJub sessions

After opening/funding an ACC, set the withdrawal asset and recipient. Under
**Settings → Sessions → Configure a new session**, choose 10/15/30 minutes and caps, then approve the
exact scope and fresh owner passkey ceremonies. Matching unshielded withdrawals
use the PRF-derived child without another credential access. Owner administration
and outside-scope spending still require fresh passkey consent. Hiding the tab,
reload, expiry and local lock dispose the signer; only chain expiry/revocation
ends copied authority. Public checkpoint metadata retains unknown submission
fences across reloads; never clear it to replay a transfer. No session private
key or grant opening is persisted.

The **Current session** card reports retained scope separately from draft target
and limit inputs. Exact public IDs and the recorded UTC deadline stay under
details; unknown outcomes still require reconciliation. Separate local Lock and
on-chain Revoke cards explain their different effects. Settings action cards,
capability/name form fields and external Lace balance facts use the same readable
spacing; no credential count, signer policy or SDK package export changes.

See [session setup and threat model](../docs/site/jubjub-sessions.md). The feature
is a source preview after RC7, not a change to published RC7 artifacts. Browser
journeys cover software credentials, actual session signing and synthetic chain
effects; native proof/provider qualification remains separate.

Session-enabled authenticated/value actions require browser Web Locks and serialize
same-origin tabs in one browser profile. Public reads and immediate local Lock
remain available. Unknown issue/spend/revocation records have independent public
operation UUIDs; stale display writes cannot erase them, and settled records stop
old tabs reopening completed fences. Never clear these records to retry an effect.
Cross-device coordination and durable operator reconciliation remain host concerns.

### Isolated native session qualification

`pnpm qualify plan consented-sessions-native` documents the opt-in session lane.
See [the review map](../docs/review/native-sessions/README.md) for the exact command,
source/key/readiness guards, private evidence and owned cleanup. It allocates fresh
ports 19964/18108/16320 and preserves retained/default localnets. Do not replay a
failed/unknown run. Source `b5eeff8` passes the declared both-arm software/native
profile; see its receipt for exact cases and observation recovery counts. Browser
consent, real providers and released artifacts remain separate tiers.


### Optional external Lace Wallet (local source)

See [the source connector guide](../docs/site/lace-wallet.md). Settings → Wallet
connections explicitly discovers/selects/reviews a public connector advertisement.
Only address/unshielded balances are read, in a separate external-wallet card.
No ACC permission, recipient autofill, signing or transfer follows connection.
Forget invalidates locally; extension permissions must be managed in the wallet.
The new adapter-browser/wallet subpath is absent from published RC7. Both-arm
synthetic browser cases qualify UI refusals, not an installed Lace extension.


### Authenticated full owner (local source)

Open the ACC, then Settings → Quick actions → **Unlock account**. Approve the pinned
PRF unlock and, on first P-256 use, explicit companion-owner enrollment. The stable
JubJub key uses Lace PRF output one and has full on-chain owner authority. The demo
requires fresh, credential-pinned PRF approval before each critical reviewed
operation, matching both owner and reader against the captured lease. This includes
owner transfers, administration, permission changes and sensitive opening recovery
or export. Multiple internal calls in the same operation share that approval; it
neither renews the lease nor permits fallback after expiry. Exact operation reviews
remain. This host rule supersedes the earlier all-owner-operations reuse policy; it
does not constrain a copied full-owner key on-chain.
**Unlock reading only** retains the earlier limited cache/grant behavior described
above. Local timeout is not removal of the durable full owner; a connected built-in
wallet also has a separate lifetime. Preserve pending enrollment markers and original
Audit IDs; no automatic replay after uncertainty. See
[owner authentication](../docs/site/authenticated-owner.md). Source-only preview;
no new provider/native/full Lace or published-package acceptance.

## Local-source package quality increment

The built-in wallet runs its SDK, HD derivation, indexer subscriptions and dust
sync in a dedicated browser worker. The page owns passkeys, consent and UI state;
stop terminates only its worker and rejects late reads. Node wallet probes use the
same runtime directly. No owner-key persistence or wallet spending is added.

Run `nix develop -c pnpm run test:background` for isolated Chromium worker and real
IndexedDB contract checks. Wallet CPU/balances are synthetic; a separate case
imports the actual SDK in a worker without opening a network wallet. This lane
never contacts a running demo. Full UI journeys remain `test:demo-browser`.
See [quality strategy](../docs/site/quality.md), [secret custody](../docs/site/secret-storage.md)
and the [local backlog](../docs/review/sdk-quality/README.md).

NIGHT readiness is independent of shielded/DUST progress. A pending DUST read no
longer holds the wallet action open: it has a separate status and timestamp, with
shared in-flight reads and stale-result fences across refresh/reconnect. DUST
failure does not hide a ready NIGHT balance. The browser journey deliberately
holds DUST pending and checks NIGHT plus usable wallet controls before releasing it.

### Opt-in job transport source follow-up

The default demo continues to use its existing transport. Hosts explicitly using
`remoteHostJobs` get bounded native JSON replies, discarded-body cleanup and
`void | Promise<void>` snapshot observers supervised by the caller's existing
deadline. A failed observer stops observation, not accepted durable work. Retain
original IDs and use explicit same-intent recovery. The service-owned queue now
matches its active capacity; injected shared queues keep host-owned backpressure.
Read the [job contract](../docs/site/service-jobs.md#source-preview-bounded-observation-and-admission).

### Source-only isolated lifecycle qualification

The opt-in `host-job-lifecycle-isolated-native` lane uses fresh owned containers and
state on ports 19964/18108/16320 with service 18798, independently of the running demo.
Its closed descriptor and stable native lease refuse endpoint/fixture substitutions
and concurrent qualification. Read the [qualification runbook](../docs/site/qualification.md#source-preview-isolated-populated-host-job-lifecycle)
for fresh-root requirements, signed frozen source/dependencies/key hashes, work and
cleanup deadlines, exact-owned cleanup and retained failure/unknown evidence.
Fake-stack tests are cheap guard coverage; they do not constitute a native run.
Never restart the user's stack or delete archived volumes/leases to run this lane.

For reusable contracts, start with [Library integration](../docs/site/library-guide.md)
and [Account keys and recovery](../docs/site/account-keys.md). For this application's
consent, worker and memory-lease choices, use [Demo composition](../docs/site/demo-guide.md).
Public circuit artifacts and their HTTP cache are documented in the separate
[proving-artifact guide](../docs/site/keys.md).


### Source hardening: request and holding identity

Reusable durable APIs pin the original invocation ID, signal/callback and explicit
cancelled-resume choice across asynchronous work; a different journal document
refuses before approval or writes. The Midnight holding source keeps owned coin
bytes from commitment through qualification, with isolated callback/return copies.
See [durability](../docs/site/durability.md#source-preview-pin-one-invocation) and
[holding ports](../docs/site/api.md#ports). The demo's default buttons still use its
existing account/consent composition; these library changes do not silently enable
durable mode, reconnect wallets or change approval policy. Native runs require a
matching frozen source receipt; synthetic tests alone do not qualify them.


### Library hardening versus demo composition — local source

Read the separate library and demo entry guides. Versioned proof/deploy clients
now bound total observation, and raw durable ports retain original-ID uncertainty
without POST replay. These are library transport contracts; they do not make the
default owner buttons durable or install a login/session policy. Generic V1 result
size and legacy synchronous sponsor behavior remain separate limits. P-256 grant
revocation uses typed internal phases with unchanged live checks/fresh approval.
The later extraction is not qualified by an earlier frozen native receipt.
Examples are strict-checked; the worker entry also has an exact-source execution
regression. Preserve all pending journals, account records and user service state.


### Library transport and installation checks (source after RC7)

The reusable V1 sponsor now bounds the whole observation only when an explicit
valid timeout is configured; the unset branch and legacy clients retain their
existing behavior. No POST is automatically retried. A timeout does not prove
that a value transaction was not submitted. Read the library HTTP client map in
`docs/site/service.md`; these are adapter contracts, not a change to demo wallet
or account authority. `docs/site/library-guide.md` identifies each persistence
owner separately from demo memory leases and journals.

After preparing all nine matching local tarballs in a fresh external application,
`scripts/consumer/installed-quality.mjs` checks installed declarations, actual
public-module imports and input hashes. It does not install or publish; follow
`docs/site/quality.md` for the required bundle/lock pins and output path. Keep
local installed-source results separate from released RC7 and native/provider
evidence. The demo remains one composition of these libraries.


### Funding-client intent ownership and browser timing (local source)

`remoteFaucet` now validates and captures the original deposit request before fresh
credentials, keeps its original ID for the wire and confirmation, and returns owned
validated receipt fields. Only an explicit timeout bounds credentials through body
observation; it never retries or invents an ID. See the library funding contract in
`docs/site/service.md`. The demo's proxy, allowlist, wallet and reservation recovery
policy are unchanged; an observation failure still needs original-ID reconciliation.

Synthetic browser receipts now include monotonic setup, per-arm, checkpoint and
cleanup timings, plus owned page/context counts. Checkpoint intervals include
intervening UI setup and actions; they are not isolated test durations. All cases
and consent assertions still run by default. Scheduling changes require measured
groups and exact coverage inventory; timing data alone is not a CI speedup.


### Library hardening and demo qualification (local source)

The reusable background port now observes failed async teardown without delaying
pending read rejection; the demo still owns its worker and UI lifecycle. Library
contracts live in `docs/site/background.md`; demo wiring is in the demo guide.
Grant bookkeeping now rejects missing required JubJub seal pairs before signing;
publication recovery keeps the original staged grant, never a replacement issue.
Read the API/grant-recovery guides before implementing a custom sealing adapter.

The opt-in installed-crypto tool checks six software/generated-contract cases on
an already prepared nine-package consumer. Follow `docs/site/quality.md` for exact
manifest/lock pins and fresh retained output. It does not start this demo, a wallet
or a proof stack; source tests, installed bytes and native/provider evidence remain
separate. No new release or deployed documentation is implied by local checks.


### Next-preview owner approval and duration

The shared routine/full-owner unlock control defaults to **10 minutes**; 15 and
30 minutes require selection. The separate scoped-transfer grant retains its own
expiry control. Full-owner unlock uses the existing blocking review to disclose
that code with page-memory access could copy the owner key and bypass UI approval;
local lock/expiry does not revoke copied authority. Login remains owner-free.
Fresh critical approval uses the RP scope captured by the original lease; expiry,
renewal, changed credential or replaced review refuses without another signer.
The reference connector remains localhost-pinned; real providers and deployment
origins require their own acceptance. See the authenticated-owner and consent guides.

<span id="source-preview-funding-inventory-after-rc8"></span>

### RC9: funding inventory

The reference funding service checks its existing wallet's spendable unshielded inventory
before any preparation/deposit, allowing up to five seconds for unshielded catch-up after
a confirmed deposit. It never retries a transfer or substitutes a stale balance while waiting.
Both services must run matching source and the same asset policy; restarting only the page does
not update a backend. Its private `/v1/faucet/assets` read is proxied to the demo with a
seven-second deadline to cover the wallet wait and transport. It exposes neither the bearer
token nor wallet balances. Empty or unsynchronized inventory disables deposits;
configured assets remain usable for ACC balance reads and withdrawals. Refresh ACC state updates
availability, and the backend checks it again inside the deposit queue. Provision custom tokens
on the current chain; a policy entry alone does not mint them. See the
[funding application's source-preview contract](passport-funding-service/README.md#source-preview-funding-inventory-admission-after-rc8).

Only a durably tombstoned no-submit refusal can clear that exact browser request ID and allow a
new explicit intent. Legacy pending/unknown requests stay intact. No automatic retry or token
mint occurs. These changes are included in RC9 and require matching reference services and
asset policy; RC8 packages/images retain their original behavior. Do not restart a user's existing stack merely
to update the UI or erase its funding records.

The RC9 reference policy admits 1–64 distinct assets consistently in both services
and the browser. Older balance responses, including failures, cannot overwrite a newer read
or a reopened account’s availability. Inventory reads remain bounded even when subscription
teardown throws.

An unavailable selected deposit asset stays selected with funding disabled; refresh never
switches it to another asset. A current availability-read failure also disables deposits
until a successful refresh, preserving the asset list and withdrawal choices.

<span id="source-preview-owner-signing-comparison-after-rc8"></span>

### RC9: owner signing comparison

Choose `VITE_PASSPORT_SIGNING_MODE=passkey|jubjub`, or open the canonical demo with
`?signing=passkey` / `?signing=jubjub`. Passkey remains the default; the existing
`VITE_PASSPORT_ARM=p256|jubjub` is accepted, but conflicting build settings refuse.
Repeated/invalid query modes also refuse. The mode is fixed for that document.
**Settings → Developer tools → Owner signing demo** shows the mode and new-page links.
These select the primary owner for account creation/opening, not an implicit conversion
of an existing ACC or a change to independent scoped grants.

JubJub mode uses the opt-in WebAuthn `jubjub-prf` registration profile. It derives the
same Lace output-1 signing key and registers it as the initial owner, sharing one PRF
scope across activation and sealed publications. Both outputs returned at registration
need only one credential `create`; otherwise one pinned PRF `get` is added. The strict
P-256 profile, probe and real setup signatures remain intact in passkey mode. API counts
are not provider sheet/touch measurements.

Sign-up reviews the selected owner and a bounded routine reader/wallet lease. Confirmed
creation invokes the opt-in `onAccountCreated` handoff inside its setup scope; the demo
adopts only derived reader/wallet material. No owner key/raw PRF is retained by this handoff,
no wallet connects automatically, and later critical operations still require fresh passkey
approval. Failed adoption does not undo creation: retain records and reopen/reconcile the
original account instead of creating a replacement. Tracked in
[#304](https://github.com/input-output-hk/midnight-passport-sdk/issues/304).

<span id="source-preview-consecutive-deposits-and-availability-recovery-after-rc8"></span>

## RC9: consecutive deposits and availability recovery

A confirmed deposit may temporarily put the funding wallet behind the indexer. The
browser re-observes a valid `unavailable` inventory at most twice after the first
GET, with one- and two-second pauses. Each observation has a 45-second deadline
through JSON decoding. This is read-only recovery: it never repeats a deposit POST,
changes a pending request ID or clears an unknown outcome. Insufficient stock is
not polled, and transport/malformed-response failures refuse immediately.

**Passport account → Deposit → Refresh availability** runs the existing public ACC
refresh action, without a passkey or page reload. It remains available after the
bounded checks end or a read fails. The selected token stays selected; an unavailable
selection is disabled rather than replaced with NIGHT. Superseded reads and page
exit cancel owned requests/waits, and account-identity/generation checks fence late
results. The backend still performs its queued inventory preflight before a send.

The synthetic Playwright funding recovery journeys exercise consecutive NIGHT and
custom deposits, separate balances, finite catch-up, mobile manual refresh, read
outages/insufficient stock and retained unknown IDs in both signing arms. Unit
contracts additionally cover stopped/late reads and a stalled response decoder.
These are UI/software evidence, not fresh native funds or provider qualification.

### Source-preview backend quality boundaries

Backend app TypeScript/JavaScript is included in the AST quality inventory. The
typed native ledger driver and loader now meet normal defaults, as do their new
operation modules. Funding/value policies reject oversized decimal
text before conversion. Host finality reads bound headers/body observations and
JSON bytes, validate successful records and retain unknown outcomes on refusal.
Neither a failed read nor a local timeout proves that a mutation did not submit.
These source checks do not qualify a new Docker image or native/provider flow.

## Reference host code structure

The demo composes typed action controllers and per-instance presentation models;
`app.ts` retains consent, receipt and lifecycle wiring. The Node service separates
reference module admission, typed v9 contracts, mutation preparation and retained
plan continuation. No runtime ledger constructor is replaced by a workspace import,
and a recovered plan retains its original key, bytes and waves. The
[quality review map](../docs/review/quality-debt-2026-11-10.md) distinguishes source,
offline-ledger, browser and native/image qualification.

## Wallet ownership when funding is enabled

The CLI forwards `PASSPORT_FUNDING_SEED_FILE` to the funding process. For a
concurrent demo, point it at a distinct, already-funded wallet and keep that
wallet’s persistent state separate from the sponsor. Both unset defaults select
the public standalone genesis seed; use that shared default only in sequential
single-wallet qualification with the other wallet process confirmed stopped.
There is no cross-process wallet lock. Configuring a token color does not mint it.
See the [funding image and operator guide](passport-funding-service/README.md).

## Midnames lookup source preview

The demo's optional Midnames reader uses the existing **Name service** panel.
Set all five build inputs in the [naming adapter guide](../docs/site/names.md#source-preview-midnames-210).
A configured lookup uses the registry's contract target and verifies the
deployed ACC binding before displaying it. The default remains the mock.

### Standalone Midnames claim recovery

An opt-in host can supply the demo's preparation adapter. The user reviews the
exact sponsor quote and explicitly approves preparation. The form saves the
quote and owner commitment before the sponsor request and accepts only a receipt
bound to both. After a lost response the original credential can recover or
import that receipt. The opt-in local demo loads an owner-side proving bundle
on the same localhost origin. It requests PRF from the open account's passkey
after quote approval and sends only proved bytes to the sponsor. See the
[owner and sponsor setup](../examples/midnames-local/README.md#send-an-acknowledged-receipt-from-the-browser).

On the pinned `standalone-0.35` registry with namespace `night`, the demo
can retain a sponsor's original public receipt and reconcile it after a lost
response. The form is under **Settings → Developer tools → Name service**.
It also checks availability against the configured registry and verifies the
open ACC's binding. A retained receipt takes precedence over availability.
The sponsor prepares the claim separately. The opt-in loopback fixture lets
the user acknowledge a saved receipt with **Send prepared claim**. See the
[receipt and recovery flow](../docs/site/names.md#recover-the-sponsors-original-claim-in-the-demo).

### Standalone shielded deposit by name

The independent Node sender example exercises the Midnames resolver and the
shielded ACC deposit through a funded wallet. Its fixtures show the exact
reviewed destination and verify the recipient holding. Follow the
[standalone recipe](../examples/midnames-local/README.md#run-the-shielded-deposit-by-name).

### Standalone ACC-to-ACC payment by name

The Node fixture demonstrates a named NIGHT payment using a controlled wallet
and a durable two-leg journal. The reference browser withdrawal remains a
separate wallet-address flow. See the
[standalone recipe](../examples/midnames-local/README.md#run-the-named-acc-to-acc-night-payment).

### Source preview browser grant relay

The standalone service can mount an authenticated relay for direct P-256 grant
requests. Configure the private grant sponsor, set `PASSPORT_BROWSER_GRANT_DIR`
to a separate private state directory, and set `PASSPORT_DAPP_ORIGIN` to the
canonical HTTPS origin of the issuer. The pinned WebAuthn profile requires a
21-byte origin and the full issuer hostname as RP ID. Route the relay paths
through the same-origin HTTPS frontend. Keep `/v1/mutations/` and its bearer
token on the private service boundary.

The relay issues a stateless, single-use owner challenge ticket and a five-minute session scoped
to the verified credential and account. Keep the session token in memory and
send it in the `PassportGrant` authorization header. The service checks live
P-256 enrollment and the original holder signature before admitting a nonce.
A device epoch change or observed removal invalidates the session. Before submitting, it checks the live owner again at the wallet's durable send
fence. Retain the original holder request and issue ID for reconciliation.
The host stores the proved call in its encrypted mutation journal. The browser
relay's separate state directory retains the nonce and exact host input digest.
The browser can read an original receipt after the grant expires.
Continuing a prepared send requires both the signed request and scope to be live.

The relay sponsors only the pinned fee-only owner issue circuit. The browser
still supplies the exact review and fresh owner circuit signature. The holder
must validate the returned opening against the signed request and live ACC.
The demo exposes a dedicated `/grant.html` entry in an opt-in build. Set
`VITE_PASSPORT_BROWSER_GRANT_RELAY=1` and pin two distinct canonical 21-byte
HTTPS origins with `PASSPORT_BROWSER_GRANT_ISSUER_ORIGIN` and
`PASSPORT_BROWSER_GRANT_HOLDER_ORIGIN`. Keep the network pin at `undeployed`.
Serve the same build at both origins. The page selects its role from the
origin pin. The default localhost app keeps its own passkey origin.

The issuer requires an active P-256 owner enrolled at the issuer origin with a
verified directory entry and PRF support. An owner credential enrolled at
`http://localhost:5173` cannot authenticate at this HTTPS origin. Provision
the owner with a host that configures the SDK for the issuer origin and its
full hostname as RP ID. The standalone grant page does not provision accounts.

On the issuer frontend, forward the relay, GET configuration and account
directory, proof creation/polling and pinned artifact reads to the trusted
service. The holder needs GET configuration and browser-reachable indexer
reads. Configure the service's `PASSPORT_PUBLIC_ZK_BASE_URL` to
`<issuer origin>/v1/zk/acc-s3r1.1` and provide browser-reachable indexer
URLs. Keep the grant sponsor's private mutation route and bearer on the
service boundary. The issuer's proof service receives the unproven
transaction, so use a trusted service on the isolated network. For local
development behind a TLS frontend, the optional
`PASSPORT_BROWSER_GRANT_PORT=<loopback service port>` sets up Vite forwarding
to an already running service. Configure the frontend to admit only the
methods and paths needed at each origin.

1. Open `/grant.html` at the holder origin. Enter the account and a fixed
   unshielded recipient, then review the asset, limits and expiry. The holder
   creates a separate passkey and signs the request before navigating in the
   same tab.
2. At the issuer origin, enter the requested ACC address and review its scope.
   **Approve permission** starts fresh owner verification, relay authentication
   and the exact circuit signature review. **Recover original request** can
   reconcile a previous attempt and may complete its retained submission.
   Reopen the original signed request from the holder tab if needed.
3. Return the permission in the same tab. The holder removes the callback
   fragment from the URL and uses **Verify permission** to check it against the
   original request and live ACC state. The verified opening is held in the
   page until you leave. Copying for a trusted client requires fresh approval
   from the original holder passkey and a new live ACC check.

The originating tab retains the signed request in session storage. On the
issuer, successful owner verification derives the key for the encrypted
IndexedDB opening journal. The issuer's latest selected signed request can be
reopened after reload. Raw PRF bytes, the session bearer, the private callback
and the opening stay out of browser logs and public operation evidence. Clearing
the holder's pending request does not revoke an on-chain permission.

Run `pnpm --filter passport-dapp test:grant-relay` with Chrome and OpenSSL.
The fixture exercises the pages across temporary HTTPS origins, virtual P-256
credentials, account mismatch and cancellation, reload and invalid callbacks.
A separate path in the fixture drops an accepted execute response and recovers
the original receipt with one simulated sponsor dispatch. Native proving
through the pages and real passkey providers still need qualification.

Every relay request uses JSON and goes to the issuer origin. The session
endpoints return their secrets with `Cache-Control: no-store`.

| POST path under `/v1/browser-grant/` | Request | Success |
| --- | --- | --- |
| `session/challenge` | `account`, `credentialId` | `challenge` (base64url), `ticket`, `expiresAt` (Unix seconds) |
| `session/verify` | The same account and credential, plus `challenge`, `challengeTicket`, `challengeExpiresAt`, and hex `authenticatorData`, `clientDataJSON`, `signature` | `session`, `expiresAt` |
| `claim` | `account`, exact signed holder `fragment` | Original `requestId` and `first` |
| `read` | `account`, exact signed holder `fragment` | Original `requestId` when retained |
| `execute` | `account`, `fragment`, `requestId`, `intentSha256`, hex `proved` | Confirmed `txHash` and optional `blockHeight`, or HTTP 202 |
| `reconcile` | `account`, `fragment`, original `requestId` and `intentSha256` | Same receipt, or HTTP 202 while the original remains unsettled |
