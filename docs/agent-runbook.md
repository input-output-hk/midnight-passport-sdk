# Agent runbook

Read [AGENTS.md](../AGENTS.md) first. This reference selects the current commands
and operation-specific guards. It grants no permission to start a stack, install,
publish, use a credential or move value. Follow the owner's current scope and use
Nix. For library work start with the [library guide](site/library-guide.md); the
[demo guide](site/demo-guide.md) describes this application's optional composition.

Published RC8, historical releases, later source previews and retained qualification
receipts have separate versions. The [unchanged guidance snapshot](review/agent-guidance/README.md)
preserves historical commands, original pins and incident notes. Its old “next”
scopes and pending/PASS descriptions are not current-head acceptance. Consult exact-source review maps for acceptance; this consolidation does not
report a new browser, consumer, native or release pass.

## Demo prerequisites

The demo creates/reopens a passkey-controlled ACC, publishes sealed viewing keys
and connects a separate read-only HD wallet. The optional service proves and pays
fees. Installing library packages alone does not supply this backend or wallet.
See [apps configuration](../apps/README.md) and the
[prototype design](prototype/README.md).

| Requirement                                                                                                     | Why                                                                                                         |
| --------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| macOS or Linux with [Nix](https://nixos.org/download) (flakes enabled)                                          | The shell pins Node, pnpm and Compact 0.35.0. A global `compact` is refused.                                |
| Docker with **at least 24 GiB memory** (Docker Desktop: Settings → Resources → Memory)                          | A P-256 proof needs about 13.5 GiB on the proof server.                                                     |
| About 15 GB free disk, and about 8 GB RAM for key generation                                                    | The 52-circuit ACC has 12 GB of prover keys.                                                                |
| A local checkout of the Passport planning workspace (the passport contract repository; ask the team for access) | The contract source is exported from revision `6458ed5`.                                                    |
| Chrome or Safari, with a passkey saved in **Google Password Manager or iCloud Keychain**                        | The account needs the WebAuthn PRF extension. Chrome's "Chrome profile" store has no PRF and is refused.    |
| Free ports 19944, 18088, 16300, 8787, 8788 and 5173                                                                   | The Passport localnet uses its own host ports, so it runs beside another Midnight localnet on the defaults. |


## Demo setup and launch

For an authorized demo launch, with Docker running and a local contract checkout
that contains revision `6458ed5`, preserve the SDK branch already checked out:

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
[funding guide](../apps/passport-funding-service/README.md). Reuse existing private files; do not
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
and policy mounts separate. The default runtime UID/GID is `10001`; an explicit `--user` override must retain access to the mounts. See the [image guides](../apps/README.md)
for exact mounts and public URL overrides. Custom internal and published ports must match because
the Host guard validates the port.

The key image's `x86_64-linux` derivation needs a Linux builder; a macOS `aarch64-darwin` Nix
cannot build it directly. Prefer the signed-tag Linux CI build. The local demo CLI can restore
keys through the pinned macOS toolchain without building an image.

## Manual contract fallback

Use only when an existing verified export/cache is unavailable. The clone/switch
commands below describe a **fresh checkout**, not permission to switch the active
branch or fetch during a local-only/offline task. Do not regenerate valid keys.

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

## Manual demo launch

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
| **Refresh wallet balance** | none | Uses the host wallet deadline; see the demo guide. No wallet recreation or seed derivation. |
| **Copy full log** | none | Copies public operations and balance snapshots as JSON; no secrets. |

Current navigation, Activity and combined credential review are described in
[demo-ui](site/demo-ui.md) and [consent](site/consent.md). The older standalone
progress-bar description is retained only in the historical snapshot. Never
infer credential calls or live provider sheets from app dialogs/progress.

**Without a real authenticator:** use a fresh isolated browser profile and open `http://localhost:5173/?mockPasskey`. This dev-only mock
keeps its keys in `localStorage`, so it is only for testing. `?mockPasskey=noprf-results` exercises
the 3-prompt path.

## Legacy and virtual-authenticator checks

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

## Preserve state across restarts

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

## Troubleshooting

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

## Credential and UI compatibility details

Before changing either arm, read [consent](site/consent.md),
[owner authentication](site/authenticated-owner.md),
[prompt paths](site/passkey-prompts.md) and the
[credential audit](review/credential-policy/README.md).

- Both arms wrap openAccount/openAccountAt in optional withLoginSession. Browser
  login uses one discoverable assertion with both unchanged Lace PRF salts and
  retains outputs only through sequential sealed-key checks and the optional
  verified account-opened hook. P-256 owns() verifies original signed
  client/authenticator bytes; JubJub binds the trusted provider's derived key to
  its live entry/sealed reader. Do not claim independent ES256 verification there.
- Both validate challenge/RP/origin/UV. Never feed extension-bearing login material
  to strict ACC wa-json134 signing or weaken enrollment/signing probes. Cancel,
  missing PRF and bad proofs do not trigger implicit fallback/retry. Known-address
  P-256 recovery must work first on a fresh adapter, validating its sealed
  registration/assertion; retain pending signatures, counters and original IDs.
- Optional routine adoption runs through onAccountOpened and
  BrowserLoginKeys.deriveWalletSeed() before the login PRF scope closes. Only
  derived seed/reader material is retained for reviewed 10/15/30 minutes; no owner
  or raw PRF. Local lock/hidden/pagehide/reload/expiry disposes the cache and grant
  children, not an already-running wallet or an on-chain permission.
- Critical operations still need fresh owner approval. Sessions use a separate
  PRF-derived capped child for exact matching unshielded transfers. Renewal first
  revokes the prior known grant; unknown issue/spend/revocation fences survive
  reload. Web Locks serialize same-profile authenticated/value actions; missing
  coordination refuses them. Per-intent records must not be overwritten by stale
  display metadata. Preserve scope, independent P-256 state and no owner fallback.
- One actual credential call has one combined review. Verify captured lease before
  and after review/paint; expiry refuses. Owner withdrawal/export review contains
  exact route/account/network/binding/amount/recipient or grant ID and is checked
  before POST/display. Scoped transfers retain a separate exact decision with
  zero credential requests; other late-bound administration may need separate
  reviews. Creation explicitly retires maintenance authority in the demo.
- The P-256 unshielded-withdrawal scope pins ownership without eager PRF loading;
  its normal software-authenticator route obtains one fresh strict signature.
  Other key sessions/public prf.withSession stay eager. Recognized retries need
  fresh approval; this is neither assertion replay nor login-signature reuse.
  See [sign-only research](research/2026-11-08-p256-sign-only.md).
- Navigate actual selected pages in browser tests. There is no Overview item;
  successful verified opened() selects Account→Balances. Brand Home returns to
  entry before an account has been opened in this document and Balances afterward.
  Hints, navigation/public deep links and state refreshes never authenticate,
  enroll/unlock an owner, connect a wallet or log out. Preserve drafts/unknown IDs.
- Four workspaces use shared page-link controls; compact Menu moves the same nodes
  into a focus-restoring modal drawer. Audit trace/JSON are pages, not accordions.
  Activity owns progress/results/purpose; contextual balance freshness/form errors
  stay beside fields. Collapsed Activity signals unknown/failed/blocked attention.
  Approved credential purpose must be visible before two render frames or refuse;
  automatic mobile sheets close on completion, user-opened sheets do not.
- Source ES256/PRF tests use fake chain; browser journeys use synthetic drivers.
  Neither establishes real provider sheets/touches or native proof acceptance.
  Compare prompts only with pinned per-action upstream evidence, never assumed parity.

### Optional examples remain host choices

[React](site/react-example.md) is a development-only StrictMode synthetic entry
at /examples/react-activity.html. React/types are app dev-only; foundation packages
have no React dependency. Hooks/renderers import without mounting. After dependency
changes run the full frozen workspace install to preserve optional-peer links.
Use an existing demo or free frontend port; actual passkeys still require canonical
origin. No SSR/React Native/lace-sdk or new native/full Lace acceptance follows.

[External Lace reader](site/lace-wallet.md) uses explicit discovery, selection and
review for the public 4.0.x/4.1.x read subset. A connection grants no ACC authority,
credential request or transfer. Forget is local, not permission revocation. Never
automate a real user's extension; use an owned synthetic provider.

[Mock names](site/names.md) resolve alice.passport.test/bob.passport.test in memory.
They are not deployed ACCs: never fund them or change a transfer recipient on
resolution. The reusable seams are account/ports PassportNameService and account/names;
the mock remains in the app. These source examples/exports are absent from RC7.

## Source verification commands

The complete precommit gate and signing/CI rules remain in [AGENTS](../AGENTS.md).
After building, choose additional commands by the changed boundary:

```sh
nix develop -c pnpm run build
nix develop -c pnpm test:demo-browser
nix develop -c pnpm run test:coverage
nix develop -c pnpm run test:background
```

- Browser journeys require Chrome (CHROME_BIN may select it), own ephemeral Vite
  and fresh synthetic contexts and intercept localhost:5173 without reaching an
  existing demo. Keep complete case order/both arms. Setup/checkpoint/cleanup
  timings are monotonic intervals including intervening UI/assertions, not isolated
  case durations; do not omit consent or shorten waits to meet timing targets.
- Coverage is all executable authored source in all nine public packages, with 80%
  global/per-package lines/functions/branches. AST budgets require reviewed reasons,
  never blind regeneration. The explicit-any metric separately traverses all parsed
  JSDoc blocks and counts `any` and `*` once per actual type token. Documentation
  function types do not affect executable complexity. This does not detect
  inferred/JSON.parse `any` or establish JSDoc unsafe-cast parity.
  Read [quality](site/quality.md),
  [SDK review](review/sdk-quality/README.md) and ADRs 0015–0017.
- Background checks own an ephemeral browser/server and actual wallet SDK worker
  with synthetic CPU/balances; no live wallet sync/proof/provider acceptance.
  Keep passkeys/review on the UI thread; close only the owned worker. Background
  client shutdown preserves Closed/Unavailable reads; server stop unsubscribes,
  does not own its port and does not stop running handlers. A local routine lock
  is not complete wallet-runtime erasure/shutdown.
- account/authorization pins explicit reviewed operation/route and refuses expiry
  without fallback while retaining dispatched receipts. SecretStore is optional;
  memory storage is ephemeral and IndexedDB plaintext needs explicit opt-in.
  Keep private account-key custody in [account-keys](site/account-keys.md), public
  proving artifact/hash/cache infrastructure in [keys](site/keys.md).

### Documentation and copied-source preview

```sh
nix develop -c pnpm test:docs
nix develop -c node scripts/docs/snippets.mjs --json
nix develop -c node scripts/consumer/preview-quality.mjs --output /private/tmp/<fresh-directory>
```

[Site instructions](site/README.md) own the exact pinned Python fixture/rendered-link
commands. Lint checks every site TypeScript fence and both example modules through
`docs/examples/checked-snippets.json`; declare ES2022/DOM/WebWorker/Node targets.
Complete examples inject host capabilities; intentional fragments need reasons.
JSON diagnostics include Markdown lines/hashes. Compilation does not execute,
install, authenticate or qualify released packages. Build the current VitePress site and check local href/src/
anchors, then inspect desktop/mobile layout; link checking never fetches external
URLs, checks CSS or establishes deployed Pages. Do not reuse an older render receipt.

The copied-output preview requires an existing parent and new output, resolves
public exports in neutral/DOM/Worker TypeScript and imports selected modules in
Node without browser globals. It copies all nine declared outputs and reuses
fingerprinted physical dependencies. It **does not install** or establish tarball/
registry provenance. Source snippets remain distinct from installed declarations.

### Durable host-job transport (opt-in)

After `nix develop -c pnpm run build`, run:

```sh
nix develop -c node --test tests/remote-host-jobs.test.mjs tests/host-jobs-http.test.mjs tests/host-jobs-process.test.mjs
nix develop -c pnpm --filter passport-service exec node --import tsx --test test/host-jobs-config.test.ts test/host-jobs-e2e.test.ts
```

Read [service-jobs](site/service-jobs.md) before configuring its three job settings,
three mutation settings, independent keys and nonnested retained journals. Never
replace private files or put bearer tokens in browser storage. Jobs are opt-in,
not the default demo. /healthz advertises hostJobs only when configured;
SIGINT/SIGTERM drains up to 30 seconds, then uncertainty is not permission to retry.
These tests own synthetic private journals/processes; no Docker/live-wallet/retained
fixture is needed and no native/provider/released-image claim follows.

## Qualification selection

Run `nix develop -c pnpm qualify list` and `plan foundation` first, then read
[qualification](site/qualification.md) and the matching review map. Use fresh
private/ignored evidence paths; preserve failures. Missing inputs/skips/unimplemented
cases are not passes. Three matching foundation runs prove declared repeatability,
not release/provider acceptance. The [archive index](review/agent-guidance/README.md)
records historical unknown jobs, indexers and interrupted scopes; read it before
handling retained resources. No historical pending/PASS sentence overrides actual
source-bound receipts or authorizes a replacement send.

### Installed local and published consumers

Read [consumer integration](site/consumer-integration.md) and
[quality](site/quality.md) before preparing/running these opt-in lanes.

| Lane | Required input and distinct evidence |
| --- | --- |
| consumer-installed | Fresh external private consumer via scripts/qualify-installed-consumer.mjs prepare; all nine checked local tarballs, lock/config/immutable receipts, second fresh app with supplied hash-pinned offline lock. Real HTTP/process kills and synthetic consent, not native/providers/registry provenance. Not fast required CI. |
| consumer-host-integrity | scripts/qualify-host-consumer.mjs prepare/run uses nine actual RC6 tarballs, independent release receipt/hash and exact public-host archive SHA-256/SRI. This is that pinned composition, not a workspace upgrade/full wallet promise. |
| installed-quality | scripts/consumer/installed-quality.mjs uses a prepared external app, all nine tarballs and independent manifest/lock hashes. Actual public JS/JSON imports, strict Node/DOM/Worker fixtures/docs against installed declarations; no workspace resolution/input drift, pack/install/publish/keys/services. |
| installed-crypto | scripts/consumer/installed-crypto.mjs requires the same four pins and fresh direct-child output. Six software/generated-contract public-export cases, actual selected dependency resolutions, owned child closure and before/after byte audit. Narrow Node feature probes do not relax import-only browser guards. |

Published-host prepare installs exact registry versions with scripts/hooks disabled;
optional supplied pinned-lock replay is offline. Auth stays in temporary user config,
never package.json/logs/commits. Failed roots stay intact. Run requires externally
recorded CONSUMER_CONFIG_SHA256 and checks host/SDK bytes plus physical runtimes
before import and after. Use `pnpm qualify run consumer-host-integrity --output
<new-receipt>` under Nix for its source-fingerprinted outer receipt. Thirteen public
host protocol cases use synthetic requests, not browser/signing handlers. Wider
host grant types require an explicit JubJub check: no secp256k1 relabel/cast;
consent requires hostedJubjubAuthoriser and validated constructors. Preserve
unsupported rotation/withdrawal refusals and distinct evidence tiers.

### Source-preview release acceptance and mounted images (#236/#313)

Read [release acceptance](../docs-site/operations/release-acceptance.md) and its
[review map](review/release-acceptance/README.md) before running `release:accept`
or `qualify:mounted`. These commands use closed, independently hash-pinned private
plans; examples in `scripts/release/` record RC9 or deliberately unfilled pins.
They do not publish, create tags, update issues or authenticate real passkeys.

Freeze the current signed/built runner and physical inputs. Distinguish runner,
SDK artifacts, private publisher and docs deployment commits. Actual registry
work requires authorized package/attestation access, a fresh external private
root and temporary user auth; never expose private archives as public assets.
Native requires explicit `PASSPORT_MOUNTED_NATIVE=1`, `PASSPORT_RC_LOCALNET=1`,
`MN_NETWORK_ID=undeployed`, 15 GiB free disk, 24 GiB Docker memory, verified
cached keys and prepared pinned Linux reference dependencies. The lane uses the
existing stable native lease and dedicated node/indexer/proof ports19964/18108/
16320 plus application ports18790/18791. A busy lease or port refuses. Leave
owner-requested demos, archived indexers and other sessions untouched.

Mounted allocation/start intents are fsynced before dispatch. An unknown create
or not-yet-observed start blocks later allocations/starts; an earlier stopped
snapshot does not resolve a delayed Docker side effect. Inspect and reconcile
the original journal/daemon/IDs. Never adopt an unrelated object by name, delete
an occupied descriptor, clear a lease or replay an account/funding operation.
The source client saves a private synthetic identity and original intent before
dispatch, but interrupted creation is not an automatic resumable-account API.

The final fence includes source/dist, physical SDK/reference trees, binding,
streamed keys and Linux dependency-volume bytes/identity. Cleanup-time fingerprint
helpers also require closure. PASS/exit0 requires functional assertions, unchanged
inputs, every own compute resource freshly quiescent and exact acquired-lease
release. Drift or unknown compute retains the lease. Retain stopped containers,
the two fresh chain volumes, service/funding/config volumes, the prepared Linux
dependency volume, original IDs and failed/unknown records. No prune/reset.

The deterministic fault/transport tests belong to normal root tests. Actual
registry, two-build reproducibility, Docker, native proof and deployed Pages are
slow opt-in work, never required fast PR jobs. Current source does not retroactively
upgrade RC9 private-helper evidence or establish real-provider/full Lace acceptance.


### Native and public-source signer lanes

All native lanes require clean signed/built/frozen source and physical inputs,
existing verified keys, capacity, fresh private roots, shared stable wallet lease,
readiness/finality and original IDs. Never run another genesis wallet alongside,
reuse a retained failed root or infer no send from missing records. Only newly
recorded owned resources may be controlled; retain chain/key/state volumes.

| Lane | Required read / arm and resource limits |
| --- | --- |
| host-jobs-native / host-jobs-image-native | [Native host jobs](review/native-host-jobs/README.md), [service jobs](site/service-jobs.md). Historical creation image used Linux/amd64 emulated on arm64 with Linux-prepared locked deps; image state uses Linux ext volumes/nonroot. Fresh roots image-v1…image-v999; existing names refuse. Root only prepares fresh-volume metadata. Observer encrypted-revision copies never drive work; back up actual volume+private owner fixtures as matching UID/GID. |
| host-job-lifecycle-native / host-job-lifecycle-image-native | [Job-backed lifecycle](review/job-backed-lifecycle/README.md). Populated image needs Linux/arm64 locked ARM64 deps, actual production entrypoint, Linux ext state/nonroot, readonly keys/reference. Source post-submit host exit and image observation-loss→KILL are different fault windows. Require circuit-bound original-ID history. Standalone grant/mint/deposit/wallet credit is not job-backed. Stop host sponsor before standalone wallet; reconnect synthetic private owner seed is not a real provider or HD seed derived from ACC viewing secrets. |
| consumer-host-native | [Public host orchestration](site/consumer-integration.md#public-package-native-orchestration-lane); `pnpm qualify plan consumer-host-native`. Authenticated RC6/current-public-host consumer, no private Lace import; fresh child below consumer and stopped retained qualification stack. SDK ports are read-only, actual host proves. No sponsor-seed overrides or stale-lease deletion. Hosted mutations/provider/page/image/full compatibility remain separate. |
| consumer-signer-protocol / consumer-signer-native | [Public signer](review/public-signer/README.md). Npm entry is client, not handlers: audited build of independently pinned **public** source with fresh supplemental-dependency/build/run roots. No private import/unsupported-consent cast. Protocol has real handlers/crypto/native MessageChannel, simulated windows/fake chain; native adds authorizing-only enrollment after baseline, no reader/viewing delivery/full lifecycle. |
| consumer-signer-browser | [Browser signer](review/browser-signer/README.md). Fresh external outputs; actual Chromium with fake chain/virtual credentials. Valid-copy baseline must precede isolated refusals. Original-port navigation request can remain pending until close; explicit fresh-client consent never replays it. No real provider/restoration/production-page/native-browser combined claim. |
| consented-sessions-native | [Native sessions](review/native-sessions/README.md). Fresh random project/volumes, ports 19964/18108/16320, shared stable lease. Never reuse/reconfigure archived/default indexers. Final source/runtime/reference/key hashes must match. Synthetic credentials/faucet tokens do not qualify providers/NIGHT/browser combination/releases. |
| host-job-lifecycle-isolated-native | [Isolated populated lifecycle](site/qualification.md#source-preview-isolated-populated-host-job-lifecycle). Fresh owned stack with closed descriptor ports 19964/18108/16320 plus service 18798; all workers validate before private setup. No legacy fallback. Cached images/all key bytes verified; no pull/regeneration required. Bounded exact-ID/child cleanup; incomplete cleanup retains lease; preserve stopped containers, volumes, failed/unknown fixtures. User demo and unrelated stacks stay outside lane. |

Inside Nix, invoke the isolated populated lane using
`nix develop -c env -u LD_DYLD_PATH pnpm qualify run host-job-lifecycle-isolated-native ...`.
The pinned shell adds that metadata variable; unchanged loader guard otherwise
refuses before resource creation. Other inherited loader/seed/preload overrides
remain forbidden. Do not delete an occupied lease or unrelated resources to retry.

Before native wallet setup require dedicatedIndexerReadiness(): HTTP 200, height 1
or wallet isSynced alone cannot establish indexer currency. Retain the archived
forked indexer/volume and source-v1/v2 unknowns named in the archive. Freeze source,
compiled output/reference/deps/keys and verify end hashes before editing. Slow
proof/image/install suites stay outside fast CI. Interrupted runs retain honest
failure stage and resource state; path digests are not private runtime paths.

## Reusable runtime contracts to preserve

- Durable run/resume captures original ID, signal/callback and explicit boolean
  cancelled-resume choice before await; canonical primitive IDs and matching
  journal documents refuse foreign work before consent/writes. Do not mutate
  options to redirect pending calls. Keep unknown/no-retry and late-receipt rules.
- Holdings own admitted intrinsic coin bytes before commitment/history, pass a
  separate copy to nullifier callbacks and return fresh qualified nonce/color.
  Complete HoldingIndexer, unique positions and spent checks remain required.
- Read-grant bookkeeping is encrypted for the publisher reader. Fetch confirmed
  seal from that publisher and deliver to independent grantee; owner ACC access
  does not recover a survivor's bookkeeping. Preserve publisher/recipient provenance.
- Checked config bounds deadline/body; legacy discovery keeps plain GET shape.
  Explicit remoteV1Sponsor timeout covers encoding/one observation/bodies, unset
  delegates to legacy. No automatic POST retry or recovery query after observation
  failure; preserve typed errors before dispatch when encoding uses the budget.
- Funding snapshots canonical ID/network/binding/pins/account/asset/positive U128
  amount before async credentials. Fresh header callback runs once with receiver;
  explicit timeout includes prep/credentials/one POST/projection, unset remains
  unbounded. Returned balance is resulting ACC balance, not delta. Retain ID and
  reconcile unknowns; timeout cannot undo send. Demo setup is a separate composition.
- P-256 readiness phases preserve late record reads, 30 raw polls, directory retry/
  always-write, strict signing, Flow/session boundaries, original material and
  durable request/effect IDs. Synthetic pre-extraction journal compatibility is
  not current native acceptance. Typed JubJub rotation similarly preserves
  publication→live recheck→switch→observe→holdings→authority completion.

Read [API](site/api.md), [durability](site/durability.md), [service](site/service.md)
and [overnight review map](review/overnight-quality/README.md) before changing these
contracts. These notes describe source contracts, not additional passing evidence.
