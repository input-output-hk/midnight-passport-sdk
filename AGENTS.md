# AGENTS.md: run the Passport DApp prototype

This guide is for people and coding agents who check out the `passport-acc-prototype` branch and
want to run the Midnight Passport DApp demo themselves. Everything runs inside the repository's Nix
shell.

**What the demo does:**

- A person creates a Midnight Passport account with only a passkey: no tokens, no recovery phrase.
- The service deploys the account contract (ACC), proves every transaction, and pays the fees.
- The page publishes sealed ACC viewing keys and reopens the account after a reload.
- A read-only wallet, seeded from the same passkey, stands behind the Midnight DApp Connector API.
- The page drives the Passport account API (which the prototype called the "DApp Connector API")
  and draws its progress from the account API's progress events.

**Background reading:**

- [`docs/prototype/`](docs/prototype/README.md): the overview, the demo script, the flows, the keys,
  the limits, and the architecture compared with the SDK proposal.
- [`apps/README.md`](apps/README.md): every environment variable and script.
- [`docs/site/getting-started.md`](docs/site/getting-started.md): library installation and a minimal browser host.
- [`docs/site/use-cases.md`](docs/site/use-cases.md): demo prerequisites, actions and expected results.

## Latest local owner-authentication policy

The latest policy requires passkey access for login and fresh approval for critical
operations, including when a JubJub full-owner session is already active. This
supersedes the earlier local policy that reused that owner for administration
without another credential request. Read [the owner guide](docs/site/authenticated-owner.md)
and [the credential-path audit](docs/review/credential-policy/README.md).

Verified login may warm an explicitly reviewed **10/15/30-minute routine lease**.
The demo opts in through `onAccountOpened` and `BrowserLoginKeys.deriveWalletSeed()`
inside the login PRF scope; other hosts opt in themselves. Retain only derived
wallet seed/reader material, never raw PRF outputs or an owner key in this routine
lease. Failed/stale adoption, hidden tab, page exit, lock and expiry invalidate it.
Login neither enrolls/unlocks a full owner nor connects a wallet. Routine holdings
and wallet connection may reuse the lease; public reads, wallet refresh, funding
and external Lace connection need no Passport passkey.

Full-owner mode still uses the existing deterministic Lace PRF-output-1 JubJub
owner, not a scoped child. Explicit first-time P-256 companion enrollment grants
durable FULL on-chain ownership; the host's fresh-approval rule and local timer do
not restrict that contract authority. Check the live entry and unique sealed reader.
Before each critical reviewed operation, obtain a fresh credential-pinned PRF
assertion and match its derived owner and reader to the captured lease. Reuse that
approval only within the same logical operation, never extend the lease or silently
fall back. Critical operations include owner transfers, device/key/grant changes,
sensitive opening export and pending-grant recovery/publication. Separately approved
bounded grant transfers keep their zero-request path only inside the exact scope.

Preserve pending enrollment attempts, original IDs, scope/expiry and unknown-result
fences. Never enroll/replay after uncertainty, switch a stale approved route to
P-256, or clear a user journal. Original P-256 directory/counter state stays
independent. Creation still needs the strict probe and real P-256 setup signatures;
older durable creation transcripts may safely refuse the changed scope rather than
being rewritten. Key/SDK and synthetic-browser tests do not qualify native proofs,
real providers or full Lace. Never enroll an owner on a real account automatically.

## Consent and reproducible browser journeys (source preview after RC7)

The demo uses one combined operation/ceremony review before each actual credential
API call. `reviewDemoAction` prepares frozen context without opening a dialog;
`beforeDemoCeremony` shows the operation, actual purpose, selected lifetime and
retry number in `#ceremony-dialog`. There is no generic `#consent-dialog` first.
Creation must acknowledge permanent maintenance-authority retirement before the
first credential is created. Every subsequent access/retry still requires fresh
approval. Check the captured routine lease before/after approval and after paint;
expiry refuses without a credential or fallback. Routine cached reads/wallet
connection show no generic modal. Known owner withdrawal/export inputs now join
the first actual derive/sign review; captured route, account, amount/recipient or
grant ID are checked again immediately before POST/display. Matching scoped-grant
transfers have no credential call, so retain their separate exact decision. Other
late-bound device/grant reviews remain separate. Do not remove required decisions
merely to reduce dialog counts. Cancellation cannot undo submitted effects;
retain original IDs and reconcile unknowns. Provider UI and multi-transaction
P-256 signatures remain separate from app dialog counts.

**SDK capabilities and proof plans** is advisory public-package inspection. It does
not load a credential or call a prover, and does not certify runtime readiness.
See [consent](docs/site/consent.md) and the
[use-case evidence map](docs/site/use-case-coverage.md).

Run all existing action-button journeys with synthetic credentials and a synthetic
account/chain driver, without a running demo or Docker:

```sh
nix develop -c pnpm run build
nix develop -c pnpm test:demo-browser
```

Chrome must be installed (`CHROME_BIN` may select it). The runner owns an ephemeral
Vite server and fresh browser contexts; intercepted localhost:5173 requests never
reach an existing demo. This is UI/consent coverage, not native proof/provider
acceptance. Both owner-arm selections run. Receipts use fresh ignored `review/`
paths. `nix develop -c pnpm test:coverage` now records all executable authored package
source coverage with an 80% global/per-package floor; it is outside fast required CI.
The local source after RC7 adds opt-in **Consented JubJub session** controls (#281).
Read [the session guide](docs/site/jubjub-sessions.md). Set the withdrawal asset and
recipient, choose 10/15/30 minutes and caps, then authorize the session with the
open account's passkey. Matching unshielded withdrawals use a separate PRF-derived
child under an expiring grant; critical owner actions still use a fresh passkey.
Hidden tab/pagehide/reload/expiry locks the key; local lock is not chain revocation.
Renew by revoking the prior known grant. Unknown issue/spend fences survive reload:
do not clear site data to retry. Browser Web Locks serialize authenticated/value
actions across same-profile tabs; missing coordination refuses those actions.
Independent per-intent public records retain issue/spend/revocation unknowns;
stale tabs cannot clear them by overwriting display metadata. The session feature is not in published RC7 and
has native source qualification at `b5eeff8` for both software owner arms,
with the actual controller/SDK, a fresh faucet asset and real expiry. Provider,
browser/native combined and released-artifact acceptance remain separate. Existing
browser tests cover these controls with real signing guards and synthetic drivers.

## 1. What you need

### Quick actions and Settings navigation (local source)

Read `docs/site/quick-actions.md`. Settings is now a set of submenu pages, not
top-level details/summary accordions; tests must navigate the actual selected
page before accessing controls. `#settings/sessions` is Quick actions.
Reviewed login or an explicit 10/15/30-minute PRF unlock caches routine
reading/wallet material only in memory. PRF owner output is zeroed; critical
device/key/grant owner flows must still use fresh passkey approval. `routineViewingKey` is read-holdings-only; never
route writes or owner signing through it. Transfers use the existing separately
issued capped grant and retain unknown-spend/no-fallback/revoke-first guards.
Lock/hidden/page-exit/expiry disposes the routine cache and its grant children;
this does not revoke a chain grant or disconnect an already running wallet.
Keep source-native, browser/synthetic and real-provider evidence separate.

### Stable navigation follow-up (local source)

Read `docs/site/demo-ui.md`. All four multi-page workspaces use one shared page-link
controller; wallet has Built-in/Lace pages and Audit has Event log/Requests/Export.
Outside the signed-out entry screen, desktop groups remain visible with independent navigation/content scrolling. On
compact screens open Menu before clicking navigation; its modal drawer owns the
same DOM nodes and restores focus. Use `[data-workspace-page]`/`aria-labelledby`
to find the actual page control in browser journeys. Audit trace/JSON are pages,
not details/summary disclosures. Navigation never starts credential/account/wallet
work. Keep stable viewport geometry, drafts, deep links, explicit consent and
unknown-intent fences; test actual pointer/keyboard navigation, not hidden mutations.

### Landing entry page (local source)

The signed-out entry uses **Sign up / Log in**, retaining the existing
create/open/address IDs and consent handlers. There is no Overview menu item:
normal navigation contains Passport account, Midnight wallet, Audit and Settings.
The brand Home link opens Account balances after a verified account open; it
returns to the login entry when no account has been opened in this document.
Navigation never logs out, changes credentials or starts authentication. Its rail and mobile Menu are hidden; use **Demo tools →
Settings** to enter the regular navigation, or **Demo tools → Audit** to inspect
an entry failure. Successful create/open/openAt selects Account Balances through
the successful `opened()` path only. Navigation, stored hints and generic state
refreshes never authenticate, enroll/unlock an owner or connect a wallet. Preserve
address drafts and unknown IDs; the landing is presentation, not a logout boundary.

### Single-request active login (local source)

Both account arms now wrap `openAccount`/`openAccountAt` in the credential port's
optional `withLoginSession`. The browser adapter uses one discoverable assertion
with both unchanged Lace PRF salts (`identify-and-unlock` consent), retaining its
outputs through the sequential sealed-key checks and optional verified account-opened
hook. P-256 `owns()` verifies
original signed client/authenticator bytes. A JubJub account has no enrolled
P-256 key: bind the trusted provider's PRF-derived JubJub key to its live entry
and sealed reader; do not claim independent ES256 verification for that path.
Both paths validate challenge/RP/origin/UV. Never pass extension-bearing login material
to strict ACC `wa-json134` signing or relax the enrollment/signing probe. Cancel,
missing PRF and bad proofs never trigger implicit fallback/retry. Login does not
enroll/unlock an owner or connect a wallet. The demo explicitly adopts only routine
seed/reader material before this scope closes; the SDK does not enable that cache
for other hosts automatically. Known-address P-256 recovery must work as the first
open on a fresh adapter, validating its authentic sealed registration and assertion.
Keep pending activation/publication
signatures and uncertain-ID handling intact. Actual-core tests use real software
ES256/PRF with a fake chain; browser journeys use a synthetic account driver.
Neither establishes live-provider sheets/touches or native proof acceptance.

### Approved UX milestone (local source)

Follow [the execution map](docs/prototype/ux-milestone.md) and milestone #3, issues
#287–#294. The optional `account/interaction` subpath supplies public immutable
presentation models; existing demo progress consumes its arithmetic. It starts
no credential, timer or transaction. The local demo now has an authentication entry and four workspace groups,
including Settings, dedicated Audit and responsive Activity controls; the owner follow-up
places progress/results/purpose explanations in Activity, with no floating banner
or global progress panel. Blocking consent remains separate. Read [the UI guide](docs/site/demo-ui.md).
Optional React/Lace Wallet wiring has separate acceptance gates. Keep the current branch, blocking consent,
session/unknown-intent fences and running user demo intact. No `lace-sdk` work or
new native/full Lace claim in this milestone. These exports are absent from RC7.

### Optional React host example (local source)

Read [the React example guide](docs/site/react-example.md). The development-only
`/examples/react-activity.html` entry uses synthetic public snapshots under
StrictMode. Hook/renderers import without mounting a browser app; foundation
packages gain no React dependency. React/ReactDOM and types are app dev-only,
pinned past the dependency cooldown. After dependency edits run the full frozen
workspace install so sibling optional-peer links remain valid. Use the existing
demo server or a separate free frontend port for the synthetic example; actual
passkeys still need their canonical origin. No SSR/React Native/lace-sdk claim.

### Optional external Lace Wallet (local source)

Read [the connector guide](docs/site/lace-wallet.md). Settings → Wallet connections
has explicit discovery, selection and review; the public4.0.x/4.1.x read subset
only. Wallet-reported unshielded balances stay separate from the built-in wallet
and ACC. No credential, ACC authority or value operation follows a connection.
Forget is local, not permission revocation. Tests inject an owned synthetic
provider; never operate a real user extension during automated qualification.

### Local naming adapter example (after RC7)

The **Name service · mock adapter** panel resolves `alice.passport.test` and
`bob.passport.test` in memory on the configured demo network. No open account,
credential, funding or name creation is involved. Its addresses are synthetic,
not deployed ACCs; never fund them. The panel never changes a transfer recipient.
The reusable interface is `account/ports`' `PassportNameService`; the checked
helper is `account/names`. The mock stays in the app. See
[`docs/site/names.md`](docs/site/names.md). Neither export is in published RC7.

| Requirement                                                                                                     | Why                                                                                                         |
| --------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| macOS or Linux with [Nix](https://nixos.org/download) (flakes enabled)                                          | The shell pins Node, pnpm and Compact 0.35.0. A global `compact` is refused.                                |
| Docker with **at least 24 GiB memory** (Docker Desktop: Settings → Resources → Memory)                          | A P-256 proof needs about 13.5 GiB on the proof server.                                                     |
| About 15 GB free disk, and about 8 GB RAM for key generation                                                    | The 52-circuit ACC has 12 GB of prover keys.                                                                |
| A local checkout of the Passport planning workspace (the passport contract repository; ask the team for access) | The contract source is exported from revision `6458ed5`.                                                    |
| Chrome or Safari, with a passkey saved in **Google Password Manager or iCloud Keychain**                        | The account needs the WebAuthn PRF extension. Chrome's "Chrome profile" store has no PRF and is refused.    |
| Free ports 19944, 18088, 16300, 8787, 8788 and 5173                                                                   | The Passport localnet uses its own host ports, so it runs beside another Midnight localnet on the defaults. |

## 2. One-command setup and launch

From the `passport-acc-prototype` branch, with Docker running and a local checkout of
`midnightntwrk/passport` that contains revision `6458ed5`:

```sh
PASSPORT_REPO=/path/to/passport nix develop -c pnpm demo up
```

The CLI exports the pinned ACC, compiles its 52 circuits and keys if needed, checks the compiler
manifest, verifies or restores missing keys, installs the reference client dependencies, builds the SDK, then starts the localnet,
Passport service, browser page, and standalone key server. The first build needs about 15 GB disk
and tens of minutes; later runs reuse the compiled output and verify the key cache. Open
`http://localhost:5173/` (or pass `--open`). `--mock-passkey` prints the mock URL. Ctrl-C stops the
services this command started while preserving the localnet volumes.

`pnpm demo check` tests the toolchain, Docker memory, and required ports without changing state.
`pnpm demo setup` prepares the ACC without starting services. Pass `--contract-dir /path/to/contract`
to reuse an existing compiled export, or `--no-key-service` to skip the separate key server. The
browser still gets contract metadata and artefacts through the Passport service on port 8787; the
key server on port 8788 is for a proof server or other backend consumer.

### Agent startup checklist

1. Read this file, then check the branch, working tree, Docker containers and port listeners.
   Do not switch over somebody else's changes or start a second wallet on an occupied port.
   The key service needs 8788 by default (skip with `--no-key-service`); funding needs 8789 with `--funding`.
2. If a demo is running, read `http://127.0.0.1:8787/healthz`, `/v1/config` and, when enabled,
   `http://127.0.0.1:8789/healthz`. Expect `undeployed`, `acc-s3r1.1` and the manifest pin below.
   Verify `http://localhost:5173/` loads, and reuse a healthy stack at the intended source.
3. For a stopped demo, run `nix develop -c pnpm demo check`, then the launch command above.
   For funding, set the token/policy variables below and include `--funding` in that check.
   Add `--contract-dir /absolute/path/to/contract` to reuse an existing export. Do not recompile
   or regenerate every prover key when the pinned cache is already valid.
4. After code changes, restart only processes you started, by recorded PIDs, using the same
   network, contract pin, registry and funding files. Do not reset the chain, delete passkeys,
   clear browser storage or remove reservation files as a routine startup fix.
5. Record the source SHA, commands, service URLs, log locations and owned PIDs in the handover.
   A `200` from the page alone does not establish readiness: wait for checked config and any
   requested funding service while their wallets synchronise.

### Enable localnet NIGHT funding

Prepare the token and NIGHT asset policy once using the
[funding guide](apps/passport-funding-service/README.md). Reuse existing private files; do not
replace the token or policy during a routine restart. Then run:

```sh
PASSPORT_REPO=/path/to/passport \
PASSPORT_FUNDING_TOKEN_FILE="$HOME/.midnight-passport/funding-token" \
PASSPORT_FUNDING_ASSETS_FILE="$HOME/.midnight-passport/funding-assets.json" \
nix develop -c pnpm demo up --funding
```

Add `--mock-passkey` for a development-only credential or `--arm jubjub` for that authoriser arm.
For a presentation use a real PRF-capable provider at exactly `http://localhost:5173/`.
Create/open an ACC, connect the built-in wallet, deposit `10`, withdraw `1` to that wallet's
unshielded address and choose **Refresh wallet balance**. Expect ACC `9` and recipient balance to increase by `1`
after indexer sync, in **smallest units**, not whole NIGHT. Refresh reuses the wallet without
a passkey prompt. **Refresh ACC state** updates the separate contract view; **Copy full log**
exports public evidence. Preserve an uncertain funding request ID and use the operator inspection
and reconciliation tools before retrying. Do not start a second transfer under a new ID.

### Container and platform notes

The service and funding images need a Linux-prepared reference client's `node_modules` as well
as the pinned contract export. Do not bind-mount macOS dependencies into Linux or reuse an
unverified old dependency volume. Either install dependencies within a Linux-prepared export and mount that entire tree
read-only as shown in the image guides, or prepare a dedicated Linux volume with `npm ci`
from the export's lockfile and mount it read-only at the export's `node_modules` path. Keep writable state, token
and policy mounts separate. The default runtime UID/GID is `10001`; an explicit `--user` override must retain access to the mounts. See the [image guides](apps/README.md)
for exact mounts and public URL overrides. Custom internal and published ports must match because
the Host guard validates the port.

The key image's `x86_64-linux` derivation needs a Linux builder; a macOS `aarch64-darwin` Nix
cannot build it directly. Prefer the signed-tag Linux CI build. The local demo CLI can restore
keys through the pinned macOS toolchain without building an image.

## 3. Manual setup

```sh
git clone https://github.com/input-output-hk/midnight-passport-sdk.git
cd midnight-passport-sdk
git switch passport-acc-prototype
nix develop                          # or: direnv allow

export PASSPORT_REPO=/path/to/your/passport/checkout
git -C "$PASSPORT_REPO" fetch        # make sure revision 6458ed5 is present

# Export the contract tree into experiments/acc-0.35/work/ (git-ignored). This also patches the
# exported reference client so it reads the Passport localnet's ports.
D=$(experiments/acc-0.35/fetch-acc.sh 6458ed5 | tail -1)

# Compile the contract with every prover and verifier key: about 22 minutes, 12 GB, on the host.
experiments/acc-0.35/compile.sh "$D" full

export PASSPORT_CONTRACT_DIR="$D"
export PASSPORT_MANIFEST_SHA256=77fb9c17b0d59047456c43115d9a58f5cb99a226ee73b6b974fd724930c3153f
```

Check that your build matches the pinned hash. The build is byte-reproducible across machines, but
only through `compile.sh`'s canonical invocation:

```sh
shasum -a 256 "$D/contracts/managed/account/compiler/contract-manifest.json"
# expect 77fb9c17b0d59047456c43115d9a58f5cb99a226ee73b6b974fd724930c3153f
```

Put the two `export`s in your shell profile, or in `.envrc.local` if you use direnv, so later shells
have them.

## 4. Run the demo manually

```sh
nix develop -c pnpm prototype:up
```

`prototype:up` runs these steps in order:

1. Checks the toolchain, the contract directory and the manifest hash.
2. Installs the contract tree's dependencies, the first time only.
3. Builds the workspace.
4. Checks Docker memory and that the ports are free. It names whatever holds a port, and never stops it for you.
5. Starts the node and the proof server, then the indexer once the chain reaches block 2.
6. Starts the service on `127.0.0.1:8787`.
7. Starts the page on `http://localhost:5173`.

Ctrl-C stops all of it and keeps the chain's data.

Open **exactly** `http://localhost:5173/`. Use `localhost`, not `127.0.0.1`: the passkey and the
contract's WebAuthn profile are bound to that origin.

| Step                                                     | Passkey prompts                                          | Takes                                                                    |
| -------------------------------------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------ |
| **Sign up**                                       | Provider-dependent; includes PRF and two signed inbox publications | 10 deploy waves, activation, then two signed sealed-key publications |
| Reload the page, then **Log in**              | 1 credential API request; provider UI can vary           | Reads the live ACC key and opens the sealed envelope |
| **Open by ACC address** with an already-enrolled passkey | 1 credential API request; provider UI can vary           | Opens the known ACC without a local directory hint; does not recover a lost passkey |
| **Rotate sealed viewing key**                             | Provider-dependent owner signature ceremonies             | Reviews live devices, holdings and read grants, then reseals a fresh secret before the ACC key switch |
| **Connect built-in wallet**                              | 0 with a matching routine lease; otherwise 1 reviewed PRF request | seconds; no ACC authority follows a connection |
| **Refresh wallet balance** | none | Waits for wallet sync (up to 120 s); no wallet recreation or seed derivation. |
| **Copy full log** | none | Copies public operations and balance snapshots as JSON; no secrets. |

The page shows a progress bar and an event log with each step's start, end, duration and any error,
taken from the account API's progress events; the deploy's bar still fills against a 3-minute
estimate until the service reports its waves.

**Without a real authenticator:** use a fresh isolated browser profile and open `http://localhost:5173/?mockPasskey`. This dev-only mock
keeps its keys in `localStorage`, so it is only for testing. `?mockPasskey=noprf-results` exercises
the 3-prompt path.

## 5. Run the automated end-to-end test

With `prototype:up` running, open a second shell with the same two variables set:

```sh
nix develop -c pnpm prototype:e2e
```

This historical deterministic-key test drives the legacy seam composition with a software
passkey through create, rotate, reopen and rotate again. It writes
`experiments/acc-0.35/results/x8-dapp-e2e.json` and should end with `MVP e2e: PASS`.
It does not validate the current browser's sealed P-256 flow.

For the current browser's real WebAuthn path, install Chrome and run the CDP virtual-authenticator
check while the demo is up. The default is quick and checks no-PRF and cancellation before any
deployment. The opt-in full run creates an ACC, rotates its sealed viewing key, reloads, reopens,
checks an unrelated credential is refused for the pinned wallet, connects that wallet, and rotates
again. It can take several minutes and uses only virtual credentials, never your real passkeys.

```sh
nix develop -c pnpm --filter passport-dapp virtual-authenticator
PASSPORT_VIRTUAL_E2E_FULL=1 nix develop -c pnpm --filter passport-dapp virtual-authenticator
```

Chrome may append a GREASE member to `clientDataJSON`. The adapter retries that exact known
variant up to five times without changing signed data; an unknown format is still refused. The
ACC's strict `wa-json134` profile remains a compatibility limit for real passkey providers.

## 6. Preserve state across restarts

| State | Location | Restart and investigation contract |
| --- | --- | --- |
| Chain accounts, contracts and balances | The selected localnet's Docker volumes | Stop only owned compute; retain the volumes and original network identity. |
| Passkey-to-account hints | `PASSPORT_REGISTRY_FILE` (default `~/.midnight-passport/registry.json`) and its `.v1` file | Hints are untrusted. Preserve them and verify the live ACC and sealed reader before adopting an account. |
| Sponsor deployment allowlist | The registry's sibling deployment log (default `registry.deployments.json`) | Preserve it with the corresponding chain; it is separate from owner authority. |
| Passkey | The selected credential provider | Use the enrolled credential. Deleting it can remove the remaining account access path. |
| Host account records and grant/recovery journals | Browser stores and configured service state | Preserve original IDs, pending attempts and unknown outcomes. Reload is not permission to replace an intent. |
| Development-only mock credential | The page's mock `localStorage` entry | Use a fresh isolated browser context for tests; never clear a real demo profile as a test reset. |

A fresh disposable chain is a separate environment, with a new owned project and
fresh scoped state. Before any intentional retirement, archive/reconcile the old
state and unknown transactions. Never delete registries, passkeys, journals or
volumes to repair a failed login, timeout or ordinary restart. The active owner
may have other sessions using the same Midnight stack.

## 7. Troubleshooting

| You see                                                          | Do this                                                                                                                                                            |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `guard: …`                                                       | You are outside the Nix shell. Run `nix develop`.                                                                                                                  |
| `prototype-up: port … is taken by …`                             | Identify the recorded owner; reuse a healthy intended stack or choose free ports. Stop only your owned resources. Configure a separate stack through `infra/localnet/ports.env` and `infra/networks/undeployed.env`. |
| `Docker has N GiB; P-256 proofs need at least 24`                | Arrange sufficient capacity before new work. A Docker restart affects other sessions and needs owner approval; do not restart it automatically.                                                                                                                 |
| `PASSPORT_MANIFEST_SHA256 does not match`                        | The contract wasn't built with `compile.sh … full` from the `6458ed5` export, or the build is incomplete. Rebuild.                                                 |
| `UnsupportedAuthenticator: … does not support the PRF extension` | Create the passkey in Google Password Manager or iCloud Keychain, not the Chrome profile store. Check the recorded stage; never infer the absence of a prior submission from this error alone. |
| `The authenticator does not match the wa-json134 profile`        | Your browser produced data outside the contract's fixed profile. Inspect the recorded stage and original pending IDs; do not replace submitted work. A new credential attempt needs fresh review.                                      |
| `This is not the passkey this account was created with`          | Pick the passkey you created the account with.                                                                                                                     |
| `AccountNotFound` after a chain reset                            | Check the original chain identity and enrolled ACC. Archive/reconcile old evidence before selecting fresh scoped state; never delete journals to bypass the failure.                                                                    |
| `ProverUnavailable` after about 10 minutes                       | Inspect the original operation stage/ID and service logs. A timeout may leave work running; reconcile that intent before any new send.                                                                         |

## 8. Rules for coding agents working on this branch

### Product adoption direction — 2026/11/04

The primary outcome is reusable account packages for Lace and other partners,
adoptable by layer. Follow [the partner plan](docs/partner-adoption-plan.md) and
issue275 for application-contract→deployed ACC integration. Do not make outgoing
custom ACC builds or replacement of Lace orchestration a prerequisite for package
reuse. Keep partner business logic, host consent and credential ownership explicit.

The RC7 `mn-passport-export-compact` command exports a verified compiler
dependency from the published contract package. It is absent from historical RC6. The
[reference application](examples/application-acc/README.md) uses installed public
packages, a constructor-pinned ACC and fixed merchant policy. Its compiler/offline
checks are opt-in and establish no native proof, wallet credit or provider support.
Use fresh external consumer roots; preserve failures and their original receipts.
Do not start native qualification below the existing15GiB free-disk guard, regenerate
all ACC keys unnecessarily or touch unrelated Docker resources to free capacity.

Use independent Codex CLI review when Claude is quota-limited; the owner explicitly
authorized this fallback. Bind review to the exact committed head and re-review
substantive fixes. The signing, full local gate and hosted CI requirements below
still apply. Keep the current primary branch and Obsidian checkpoint updated.

### Next milestone working agreement — 2026/10/20

Continue on the branch already checked out; the owner explicitly requested the current
branch, not `main`. Prepare work locally. Prefer coherent **5k–10k authored changed lines
per PR**, with smaller signed commits and a review map. Do not pad diffs; this instruction
supersedes the historical 400/600-line split rules in local skills and plans.

The next milestone focuses on supported-subset stability, binding/recovery and revocation
semantics, interruption safety and reproducible consumer qualification. See [CI policy](docs/ci.md)
and issues #227–#244. Keep exact-value shielded withdrawal guards and describe compatibility
from actual evidence. A breaking binding/API change triggers a version-axis decision.

Keep milestone decisions, important redacted receipts and handovers in the owner's Midnight
Obsidian vault, under `Initiatives/07 Midnight Passport ACC/SDK milestones/`. Update its
`Current checkpoint.md` and artifact index after meaningful progress. Public docs remain here;
private consumer notes stay in the vault. Never copy wallet state, tokens, passkeys, proof
witnesses, giant prover keys or private source snapshots into it.


- **Use Nix for every command:** `nix develop -c …`. Never call a global `compact`, `node` or
  `pnpm`. The scripts' `guard.sh` refuses any toolchain outside the Nix store.
- **Run the checks locally before every commit.** Pull requests also run the checks in
  `.github/workflows/pr-checks.yml`.

  ```sh
  nix develop -c bash -c 'pnpm run lint && pnpm run format:check && pnpm run build && pnpm test \
    && pnpm run test:apps && pnpm --filter passport-service exec tsc --noEmit -p . \
    && pnpm --filter passport-funding-service exec tsc --noEmit -p . \
    && pnpm --filter passport-dapp exec tsc --noEmit -p .'
  ```

- **Workflow edits.** In addition to the full Node gate, run the pinned-nixpkgs
  `actionlint` command in [CI policy](docs/ci.md#workflow-expression-validation)
  before pushing. Require every core check to exist and pass at the current head;
  image-only green checks cannot stand in for a workflow that failed to start.

- **Commits.** Use conventional commits, made with `git commit -S -s` (GPG signature plus DCO
  sign-off), and end the message with an `Assisted-by: AI` trailer. Never add a `Co-Authored-By`
  trailer that names a model. Check `git log --format='%h %G?' -1` shows `G` after each commit.
- **Fork only.** Push branches and open pull requests only in `input-output-hk/midnight-passport-sdk`,
  against `passport-acc-prototype`. Never push, open issues or comment anywhere upstream.
- **Leave other people's processes alone.**
  - Don't stop other Docker stacks or localnets. The Passport stack has its own ports.
  - Stop a process you started by its PID. Never use `pkill` patterns.
- **Never commit secrets.** No real network stack file (`infra/networks/*.env` other than
  `undeployed.env` is git-ignored), no sponsor seed, no passkey or PRF material, and no prover keys.
- **Keep the docs in step.** When a flow, an endpoint or a prompt count changes, update
  `docs/prototype/` and `apps/README.md` in the same pull request.

### Qualification for the stability milestone

Run `nix develop -c pnpm qualify list` and `plan foundation` before qualification.
The engineer guide is `docs/site/qualification.md`; the local review map is
`docs/review/stability-foundation/README.md`. Use fresh evidence paths in the vault
or a private ignored directory. Missing inputs, skipped tests and unimplemented
cases never become qualified passes. Three matching foundation runs establish
repeatability only for that declared scope, not release/provider acceptance.

### Durable host-job transport checks (RC6 opt-in)

Host-job integration is opt-in; do not switch the default browser demo to it or put
its operator bearer token in browser storage. Read `docs/site/service-jobs.md` for
three job settings in addition to the three host-mutation settings, independent
keys and non-nested retained journals. Do not replace existing private files.
`/healthz` advertises `hostJobs` only when configured. SIGINT/SIGTERM drains work
for up to 30 seconds; a timeout is unknown, never permission to replay a send.

After `nix develop -c pnpm run build`, run:

```sh
nix develop -c node --test tests/remote-host-jobs.test.mjs tests/host-jobs-http.test.mjs tests/host-jobs-process.test.mjs
nix develop -c pnpm --filter passport-service exec node --import tsx --test test/host-jobs-config.test.ts test/host-jobs-e2e.test.ts
```

These own ephemeral subprocesses and synthetic private journals only. They do not
need Docker, live wallets or existing qualification fixtures. Record this as real
transport/process coverage with fake chain drivers, never native/provider or
released-image acceptance. Keep the full local gate before each signed commit.

### Where things are

| Path                               | What                                                                                                                                       |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `packages/protocol`                | Connector API types, error codes                                                                                                           |
| `packages/account`                 | Connector flows (create, open, signed calls) behind injected seams; platform-neutral                                                       |
| `packages/keys`                    | Portable implementation of Lace's key recipe and ACC encryption-key source                                                                    |
| `packages/adapter-webauthn`        | WebAuthn passkey and PRF, with credential, key-source and P-256 authoriser ports                                                             |
| `packages/adapter-service`         | Fetch clients for proving, sponsorship, deployment, directory and checked config                                                           |
| `packages/adapter-midnight-js`     | The Midnight call pipeline over injectable prover, sponsor and submitter ports                                                              |
| `packages/adapter-browser`         | Browser composition root, `window.midnight.passport` shim and `./prototype` compatibility exports                                         |
| `apps/passport-service`            | Artefact host (`/zk`), transaction prover (`/prove-tx`), fee sponsor (`/sponsor/*`), wave deploy (`/deploy`), account lookup (`/accounts`) |
| `apps/passport-dapp`               | The demo page, the built-in wallet, the mock passkey, the e2e scripts                                                                      |
| `infra/localnet`, `infra/networks` | The Passport localnet and the Midnight stack configuration (one file per network)                                                          |
| `experiments/acc-0.35`             | Fetch, compile and run scripts for the contract, plus run records `results/x1–x9`                                                          |
| `docs/superpowers/specs/`          | The prototype spec and the publishing design for the SDK packages                                                                          |


### Native durable-job qualification checkpoint — 2026/10/27 UTC

Read `docs/review/native-host-jobs/README.md` and `docs/site/service-jobs.md` before
running the opt-in `host-jobs-native` / `host-jobs-image-native` suites. Both arms
have source-native and local production-image acceptance at the exact signed
sources in the receipt. Published RC5 is unchanged. The local image is Linux/amd64
emulated on arm64, with separately prepared Linux reference dependencies.

Image durable journals use fresh retained Linux ext volumes. A previous macOS
bind-state attempt is unqualified and retains an original unknown job; do not
replay it or replace its ID. Use a fresh root ending `image-v1` through `image-v999`;
existing container/volume/root names are refused. The production service always
runs non-root; only fresh-volume metadata preparation uses root. Observer copies
contain immutable encrypted revisions only and never drive work. Back up the
actual volume plus private owner fixture/keys, as the matching service UID/GID.

Retain intentional negative-case unknown intents. A missing host/job record never
proves no send. Keep source, compiled outputs and reference inputs frozen during
native runs, then verify end hashes before editing. Stop only exact owned worker
PIDs and the dedicated qualification containers; retain ledger/key/state volumes.
Slow proof/image suites remain outside fast CI. Current next scope is job-backed
enrollment/removal/rotation with survivor/grants/holdings and wallet reconnect.


### Job-backed populated lifecycle qualification — 2026/10/28

Read `docs/review/job-backed-lifecycle/README.md` and the final section of
`docs/site/service-jobs.md` before the opt-in `host-job-lifecycle-native` and
`host-job-lifecycle-image-native` suites. Fresh roots only; existing fixtures,
unknowns and chain/key volumes must be retained. The new image lane requires
Linux/arm64 and its separately prepared locked ARM64 dependency cache; old
creation qualification remains Linux/amd64. Use actual production entrypoint and
Linux ext state volumes, non-root service UID/GID, read-only keys/reference.

Source post-submit host exits and image owner-result observation loss followed
by container KILL are different boundaries. Require original IDs and fresh
circuit-bound job history. Standalone grant/mint/deposit setup and wallet credit
are not job-backed. Stop the host sponsor before either standalone wallet. Wallet
reconnect uses the private synthetic account owner seed, not a real provider;
never print/copy that seed or imply ACC viewing secrets derive an HD wallet.
Audit frozen signed source/runtime/reference before editing; preserve failures.


The first job-backed lifecycle run stopped at host-capacity guard; read its
partial receipt before claiming acceptance. Free at least **15 GiB before native
qualification** even with a valid key cache. Source-v1 retains a running original
Jubjub target-enrollment job after real submission. Preserve it and inspect/
reconcile that same intent; do not execute a replacement or reuse the failed root
for a fresh pass. Docker shutdown was requested by exact owned IDs but became
unresponsive; verify actual state, and leave unrelated stacks alone. Full
lifecycle/P-256/image/wallet acceptance is still pending, not released.


After the approved Docker restart, original enrollment recovery passed separately;
source-v1 remains a failed full suite. Source-v2 exposed a stale/forked indexer and
node rejection 171. Read the new readiness incident in the review map. Require
`dedicatedIndexerReadiness()` before native wallet setup: HTTP 200, height 1 and
wallet `isSynced` alone do not prove indexer currency. The archived indexer
container `mn-passport-qual-20261023-indexer-before-fork-20261028` and original
`mn-passport-qual-20261023_indexer-data` volume are retained. The canonical cache
uses the original service name/port with a new recorded ID and volume
`mn-passport-qual-20261023_indexer-canonical-20261028`; do not delete either history
or recreate the old stale binding with Compose. Node/prover IDs and chain remain
unchanged. Preserve the source-v2 unknown; never repair it by replacing its send.


### Latest lifecycle status — 2026/10/29

The partial-run and Docker incident notes above are historical. Read the final
review map and receipt: fresh source-v4/image-v3 completed both arms locally.
Keep all original failed/unknown fixtures and archived indexer data. Grant
bookkeeping is publisher-reader encrypted: fetch the confirmed seal via its
publisher and deliver it to the independent grantee; owner ACC access alone
does not recover a survivor's bookkeeping. Preserve the stated source/image
interruption boundaries and software/provider/release limits. Stop only recorded
owned compute and keep all state/dependency/key volumes.


### Installed candidate consumers — 2026/10/30

The opt-in `consumer-installed` suite requires a fresh private consumer outside
this checkout, prepared with `scripts/qualify-installed-consumer.mjs prepare`.
Read the installed-candidate section of `docs/site/consumer-integration.md`.
Use all nine checked local tarballs, retain the lock/config and immutable run
receipts, and replay a supplied hash-pinned lock offline in a second fresh app.
The harness checks installed SDK bytes, actual HTTP/process kills and synthetic
hosted-consent refusals. Its fake chain and host never qualify native proofs,
real passkey providers, registry provenance or full Lace. Do not add installs to
fast required CI, delete unknown fixtures, or publish private install logs/locks.


### Current published host consumer qualification

Read `docs/site/consumer-integration.md`'s current published host section before
`scripts/qualify-host-consumer.mjs prepare|run`. Use a fresh external private root,
the nine actual RC6 tarballs, an independently verified release receipt/hash and
an exact public host archive SHA-256/SRI. The dependency example is a tested
consumer composition, not a workspace dependency upgrade or a full-wallet promise.
Prepare installs exact registry versions with scripts/hooks disabled; optionally
replay a supplied hash-pinned lock offline. Keep auth in temporary user configuration,
never package.json, logs or committed files. Failed roots stay intact.

`run` requires the externally recorded `CONSUMER_CONFIG_SHA256`. It rechecks all
installed host/SDK bytes and physical runtimes before any host import and again
at the end. Run `pnpm qualify run consumer-host-integrity --output <new-receipt>`
under Nix for a source-fingerprinted outer receipt. The thirteen public-host protocol
cases use a synthetic request transport, not signer handlers or a signer browser.
Current wider host grant types require an explicit JubJub check; never cast or
relabel a secp256k1 grantee. Consent needs `hostedJubjubAuthoriser` plus validated
host constructors. Preserve unsupported rotation/withdrawal refusals. Source,
actual published package, native and real-provider tiers remain distinct.


### Public host/native qualification (local, opt-in)

Use `pnpm qualify plan consumer-host-native` and the
[consumer integration guide](docs/site/consumer-integration.md#public-package-native-orchestration-lane).
This lane uses the authenticated RC6/current-public-host consumer; it imports no
private Lace implementation. It requires signed clean source, existing verified
prover keys, fresh private output below the consumer root, and the stopped retained
qualification stack. It starts/stops only owned IDs, preserves all volumes and
failed/unknown fixtures, and forbids user sponsor-seed overrides. Never run a second
genesis wallet alongside it or delete a stale lease without inspecting its owner.
The actual host proves its operations; the SDK ports in this lane are read-only.
Type/guard tests are not a live pass. Keep real-provider/page, native SDK hosted
mutations, production image and full-compatibility qualification separate. Publish
only public receipts/hashes; synthetic secrets and sealed record history stay private.

### Public-source remote signer qualification

Read `docs/review/public-signer/README.md` and the consumer guide before
`consumer-signer-protocol` / `consumer-signer-native`. The public npm entry exports the client,
not handlers: build the separately pinned **public** source with the audited builder. Do not
import private implementation or cast unsupported consent to a different flow. Use fresh external
supplemental-dependency/build/run roots and preserve every failure. Protocol uses real handlers/
crypto/native MessageChannel, simulated windows and fake chain. Native adds one authorising-only
SDK enrollment after the existing native baseline; no reader/viewing-key delivery. Do not claim
browser/provider/full-hosted-lifecycle compatibility. Keep existing signed-source, capacity,
lease, finality, retained unknowns and owned-resource cleanup requirements.

### Actual public-source browser boundaries

The opt-in `consumer-signer-browser` lane and `docs/review/browser-signer/README.md` now retain
19 actual Chromium boundary cases at their measured signed source. This includes a real allowed-
origin non-opener port offer before the opener handshake, isolated descriptor/account/circuit/
commitment refusals, overlap, failed callback teardown, navigation, and explicit fresh-client
reconnect preserving the virtual device key. These are fake-chain/virtual-credential results.
Use fresh external output roots; no Google/iCloud restoration, reader delivery, production page,
or browser/native combined proof is established. New receipts export path digests, not local
runtime paths. An interrupted run must retain its failure stage and honest resource states.
The native parent/worker input schema is checked offline before Docker starts; never confuse
redacted path identity with the worker's private runtime path supplied in its controlled environment.

The strengthened 2026/11/03 browser receipt also admits an unchanged in-scope authorisation
before each isolated refusal. Its navigation probe issues an actual old-port request; the pinned
public host leaves it pending until close. Explicit fresh-client consent never replays it. Read
#272 and the review map before claiming navigation recovery. Copied-root integrity controls
require a valid-copy baseline and the intended rejection reason. Latest same-source interruption
control closes all created resources and preserves an honestly absent attacker server.

### Isolated session qualification — 2026/11/05

Read `docs/review/native-sessions/README.md` before the opt-in
`consented-sessions-native` suite. It owns a fresh random project and fresh volumes
on ports 19964/18108/16320; never stop/reconfigure archived/default indexers or reuse
their volume/endpoint. The stable wallet lease is shared with older lanes. Retain
failed/unknown roots and transaction bytes; source/runtime/reference/key pins must
match at the end. Native synthetic credentials/faucet-token tests do not establish
real providers, NIGHT funding, browser/native combination or released packages.


### Activity and passkey prompt comparison — local follow-up

Read docs/site/passkey-prompts.md and demo-ui.md. Activity now owns progress,
operation results and transient explanations. Keep contextual balance freshness
and form validation beside their fields. A collapsed Activity trigger must flag
unknown/failed/blocked attention; durable guards remain enforced. Each approved
credential call reveals its explanation in Activity before two rendering frames,
and refuses if it cannot be visible. Mobile automatic-purpose sheets close only
when that operation ends; user-opened sheets are not auto-dismissed. Never count
a consent dialog as a native passkey call. Compare P-256 signatures/PRF/retries
with pinned upstream per-action JubJub source; do not claim measured live parity.

### SDK quality tranche — local source 2026-11-07

Read `docs/review/sdk-quality/README.md`, `docs/site/quality.md` and ADRs 0015–0017.
Coverage uses all executable authored sources in all nine public packages, with
80% lines/functions/branches globally and per package. Run `nix develop -c pnpm
run test:coverage` before release; do not substitute loaded-only measurements.
`lint` includes AST budgets, and TypeScript rejects unused declarations. Never
regenerate/increase legacy budgets just to pass; give a reviewed rationale.

`nix develop -c pnpm run test:background` owns an ephemeral browser/server and tests
worker/IndexedDB contracts. It imports the actual wallet SDK in a worker, but
uses synthetic wallet CPU/balances and establishes no live sync/proof/provider
acceptance. The browser demo now runs the wallet SDK/dust runtime in a dedicated
owned worker. Credential prompts and consent remain on the UI thread. Stop only
the owned worker, never another Midnight stack.

`account/authorization` provides explicit per-operation consent with a pinned
signing route; expiry refuses without fallback and dispatched receipts survive.
`account/ports` adds optional SecretStore and BackgroundPort seams. The memory
secret store is ephemeral; the browser IndexedDB adapter requires explicit
plaintext opt-in. Never automatically persist an owner key or PRF output.


### Library docs and demo composition — overnight local source

Start with `docs/site/library-guide.md` for integration/ownership/error contracts,
and `docs/site/demo-guide.md` for the reference app's wiring/defaults. The source
preview is separate from published RC7. Keep public API snippets strict-checked
against the matching source; render Jekyll and check local links after guide changes.
Do not imply demo memory leases, funding UI, navigation or worker creation are SDK
defaults. Typed internal JubJub rotation phases preserve publication/recheck/switch/
observation/authority ordering; new modules use default AST budgets. Checked service
config now has bounded deadline/body admission; legacy discovery keeps its plainGET
shape. Read `docs/review/overnight-quality/README.md` and actual focused test receipts
before making broader qualification claims. Do not reset user state to run tests.

### Narrow P-256 signing and source consumer checks — overnight follow-up

The browser adapter's P-256 `withdraw-unshielded` key-session scope pins ownership
without eagerly loading PRF material. The normal software-authenticator path makes
one fresh strict transaction-signature request. Other key-session flows and public
`prf.withSession` retain eager derivation; retries always need fresh review. This
is neither assertion replay nor reuse of a login signature. See
`docs/research/2026-11-08-p256-sign-only.md` and the prompt guide.

After building, `nix develop -c node scripts/consumer/preview-quality.mjs --output
/private/tmp/<fresh-directory>` copies all nine declared package outputs outside
the checkout, resolves their public exports in neutral ES2022, DOM and WebWorker
TypeScript contexts, and imports them in Node without browser globals. The parent
directory must exist and the output must not. It reuses fingerprinted physical
external dependencies; it does not install packages or qualify registry tarballs.
Keep that source-preview receipt distinct from installed/released-consumer checks.

### Executable library documentation contracts

`pnpm run lint` now checks every TypeScript fence in `docs/site` and both example
modules against actual public source exports. The checked inventory is
`docs/examples/checked-snippets.json`; register a new example's neutral, DOM,
WebWorker or Node target. Keep complete examples free of hidden globals; deliberate
fragments need a reason and remain visible in the receipt. `nix develop -c pnpm
run test:docs` runs this alone. For hashes and Markdown-line diagnostics, use
`nix develop -c node scripts/docs/snippets.mjs --json` with a fresh ignored output.
It compiles without executing code, loading credentials or starting a host.
Source compilation is separate from actual installed/released-package evidence.
The library guide owns API contracts; demo guides describe its chosen composition.

### Isolated populated lifecycle — local source after RC7

Read `docs/site/qualification.md#source-preview-isolated-populated-host-job-lifecycle`
before `host-job-lifecycle-isolated-native`. This is a fresh owned source stack,
not permission to use the archived legacy indexer or another session's demo.
The closed descriptor pins loopback ports 19964/18108/16320 plus service 18798;
all workers validate it before private setup. Use the shared stable wallet lease,
a new private output and clean signed/built/frozen source plus physical dependencies.
Cached images and all key bytes are verified; no pulling/regeneration is required.
Only exact newly recorded IDs may be controlled, with bounded process/container
cleanup. Preserve stopped containers, volumes, failed/unknown fixtures and pending
IDs. Incomplete cleanup retains its lease for reconciliation. Offline fake-stack
checks are not a native pass; both-arm populated results require actual receipts.
The normal user demo and every unrelated Midnight stack remain outside this lane.

Private account key/recovery contracts now live in `docs/site/account-keys.md`;
`docs/site/keys.md` covers public proving artifacts. Neither sets the demo's login,
routine lease or owner-approval policy. Keep those host decisions in the demo docs.


### Rendered documentation gate

Pages now runs deterministic Python link-checker fixture tests, then verifies
rendered local href/src targets and HTML anchors before artifact upload. See
`docs/site/README.md` for repository-pinned Python commands and a fresh JSON receipt.
This is separate from required fast PR checks and from the TypeScript example gate.
The checker never fetches external URLs, cannot qualify deployed Pages, and is not
a CSS/layout check. Rerender/check links and inspect desktop/mobile layout after
navigation/content changes; do not infer current rendering from an older receipt.


### Durable invocation and verified coin ownership — local source

Durable `run`/`resume` capture original ID, signal/callback and explicit cancelled
resumption choice before awaits. Use primitive canonical IDs and boolean choices;
foreign journal documents refuse before consent/writes. Do not mutate options to
redirect a pending call. Keep original IDs and uncertainty fences. The holding
adapter owns admitted coin bytes before commitment/history, gives the nullifier
callback a separate copy and returns fresh qualified nonce/color arrays. Complete
HoldingIndexer methods, unique positions and spent checks remain required. Read
`docs/site/durability.md` and `docs/site/api.md`; these are source hardening, not a
new release or demo policy. Root's full gate/review and frozen native receipt still
need the actual final source; earlier unit/type results are not native acceptance.


### Isolated native startup inside Nix

For the isolated populated lifecycle lane, use `nix develop -c env -u LD_DYLD_PATH
pnpm qualify run host-job-lifecycle-isolated-native ...`. The pinned shell adds
that metadata variable; the unchanged loader-override guard otherwise refuses
before resources are created. Keep other inherited loader/seed/preload overrides
forbidden. Retain failed receipts, use fresh roots, and never delete an occupied
lease or touch unrelated containers to retry. Read the qualification guide.


### Optional installed-source quality (local source after RC7)

Use `scripts/consumer/installed-quality.mjs` only with an already prepared fresh
external application, all nine local tarballs and independently pinned manifest/lock
hashes. Follow `docs/site/quality.md`. The runner checks actual public JS/JSON imports,
strict Node/DOM/WebWorker fixtures and public documentation against installed
declarations; it refuses workspace SDK resolution and input drift. It does not
pack, install, publish, generate keys, start services or establish registry provenance.
Retain failed outputs and original build/pack/install receipts. Keep the copied-dist
preview distinct: that lane resolves every runtime export and imports selected
integration modules, with reused rather than installed external dependencies.

`remoteV1Sponsor` explicit timeout now covers one whole observation, including
encoding and bodies. Unset timeout still delegates to legacy behavior. No automatic
POST retry or durable recovery query follows an observation failure. Preserve
public typed errors even if encoding consumes the budget before dispatch. Read
the HTTP selection map before substituting legacy and versioned clients.
