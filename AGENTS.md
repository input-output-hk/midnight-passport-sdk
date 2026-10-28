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

## 1. What you need

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
| **Create account**                                       | Provider-dependent; includes PRF and two signed inbox publications | 10 deploy waves, activation, then two signed sealed-key publications |
| Reload the page, then **Open with passkey**              | Provider-dependent picker and PRF ceremony               | Reads the live ACC key and opens the sealed envelope |
| **Open by ACC address** with an already-enrolled passkey | Provider-dependent picker and PRF ceremony               | Opens the known ACC without a local directory hint; does not recover a lost passkey |
| **Rotate sealed viewing key**                             | Provider-dependent owner signature ceremonies             | Reviews live devices, holdings and read grants, then reseals a fresh secret before the ACC key switch |
| **Connect built-in wallet**                              | 1 with an account open, otherwise 2                      | seconds                                                                  |
| **Refresh wallet balance** | none | Waits for wallet sync (up to 120 s); no wallet recreation or seed derivation. |
| **Copy full log** | none | Copies public operations and balance snapshots as JSON; no secrets. |

The page shows a progress bar and an event log with each step's start, end, duration and any error,
taken from the account API's progress events; the deploy's bar still fills against a 3-minute
estimate until the service reports its waves.

**Without a real authenticator:** open `http://localhost:5173/?mockPasskey`. This dev-only mock
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

## 6. Where state lives, and how to reset it

| State                                                            | Where                                                                | Reset                                                                                                    |
| ---------------------------------------------------------------- | -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| The chain (accounts, contracts)                                  | Docker volumes of the `mn-passport-sdk-localnet` compose project     | `docker compose -f infra/localnet/docker-compose.yml -f infra/localnet/docker-compose.macos.yml down -v` |
| Passkey-to-account lookup, and the accounts the sponsor pays for | `~/.midnight-passport/registry.json`, `registry.json.v1` and `registry.deployments.json` | Delete all three **whenever you reset the chain**, or Open fails with `AccountNotFound` |
| Your passkey                                                     | Your password manager                                                | Delete old `localhost` passkeys so the picker offers only the current one                                |
| Mock passkey                                                     | The page's `localStorage` (`passport-dev:mock-passkey:v1`)           | Clear site data for `localhost:5173`                                                                     |

## 7. Troubleshooting

| You see                                                          | Do this                                                                                                                                                            |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `guard: …`                                                       | You are outside the Nix shell. Run `nix develop`.                                                                                                                  |
| `prototype-up: port … is taken by …`                             | Another process or localnet holds a Passport port. Stop it yourself, or move the Passport stack in `infra/localnet/ports.env` and `infra/networks/undeployed.env`. |
| `Docker has N GiB; P-256 proofs need at least 24`                | Raise Docker's memory, restart Docker, then retry.                                                                                                                 |
| `PASSPORT_MANIFEST_SHA256 does not match`                        | The contract wasn't built with `compile.sh … full` from the `6458ed5` export, or the build is incomplete. Rebuild.                                                 |
| `UnsupportedAuthenticator: … does not support the PRF extension` | Create the passkey in Google Password Manager or iCloud Keychain, not the Chrome profile store. Nothing was deployed.                                              |
| `The authenticator does not match the wa-json134 profile`        | Your browser produced WebAuthn data the contract's fixed format rejects. Nothing was deployed. Retry, or try another browser.                                      |
| `This is not the passkey this account was created with`          | Pick the passkey you created the account with.                                                                                                                     |
| `AccountNotFound` after a chain reset                            | Delete `~/.midnight-passport/registry.json`, `registry.json.v1` and `registry.deployments.json`.                                                                    |
| `ProverUnavailable` after about 10 minutes                       | A transaction queued behind a deploy timed out. Wait for the deploy to finish, then retry.                                                                         |

## 8. Rules for coding agents working on this branch

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

### Durable host-job transport checks (unreleased source)

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
