# Passport ACC funding service

This separate Node process transfers an allowlisted **unshielded** asset from its own Midnight
wallet into a deployed Passport ACC through the pinned `deposit_unshielded` circuit. It does not
call the fee sponsor endpoint. The funding route requires a bearer token, a trusted deployment
log, per-request and UTC-day asset limits, and a durable reservation file. A request remains
pending after an uncertain wallet outcome; reconcile it against the chain before clearing a
stale lock or retrying with a new request ID.

The reference client is the pinned `6458ed5` ACC export in `PASSPORT_CONTRACT_DIR`. It must be
compiled, have its Node dependencies installed, and have the endpoint patch applied as described
in [AGENTS.md](../../AGENTS.md). The service checks the complete artefact tree against the manifest
hash embedded in `mn-passport-contract` before it opens its socket. The local `undeployed` network
uses the public genesis development wallet by default. Every other network requires a dedicated
wallet seed file and an explicit deployment-log path.

Create private files outside the repository:

```sh
mkdir -p ~/.midnight-passport
chmod 700 ~/.midnight-passport
openssl rand -hex 32 > ~/.midnight-passport/funding-token
chmod 600 ~/.midnight-passport/funding-token
cat > ~/.midnight-passport/funding-assets.json <<'JSON'
[
  {
    "color": "0000000000000000000000000000000000000000000000000000000000000000",
    "maxPerRequest": "10",
    "maxPerUtcDay": "100"
  }
]
JSON
```

This example enables NIGHT on the standalone localnet. Add another entry for a non-native asset
only after that asset is held by the funding wallet. The upstream
[funding experiment](https://github.com/midnightntwrk/passport/blob/main/contract/evidence/grants-e4-funding-grants-unshielded-funding.json)
confirmed a non-native unshielded deposit; its NIGHT deposit was refused by the node fee budget.
On the pinned localnet, an exact-value NIGHT UTXO avoids the wallet change-output
fee shape. The service makes a self-transfer of the requested amount, then builds
the ACC `deposit_unshielded` call with measured Ledger 9 deletion credit and
records the final transaction hash **before** node submission. This addresses
the Compact 0.35 gas estimate that the node rejected with `Custom error: 104`
in a local demo run. A fresh native run of this measured funding-service path
confirmed 10 units of ACC NIGHT credit on the shared Ledger 9 chain on
2026-11-18. NIGHT remains disabled on other networks pending separate
node-backed qualification.

```sh
export PASSPORT_CONTRACT_DIR=/path/to/pinned/contract
export PASSPORT_FUNDING_TOKEN_FILE=$HOME/.midnight-passport/funding-token
export PASSPORT_FUNDING_ASSETS_FILE=$HOME/.midnight-passport/funding-assets.json
nix develop -c pnpm prototype:funding-service
```

On `undeployed`, `PASSPORT_FUNDING_DEPLOYMENTS_FILE` defaults to the demo sponsor's
`~/.midnight-passport/registry.deployments.json`. For another network set that path, the `MN_*`
endpoints, and `PASSPORT_FUNDING_SEED_FILE` to a file containing a dedicated 32-byte lowercase hex
wallet seed. The token file is required on every network. The process binds `127.0.0.1:8789` by
default. `PASSPORT_FUNDING_HOST` and `PASSPORT_FUNDING_PORT` change its bind address and port.
`PASSPORT_FUNDING_RESERVATIONS_FILE` defaults to
`~/.midnight-passport/funding-reservations.json`.

`GET /healthz` answers only after the manifest, wallet and backend are initialized.
`POST /v1/faucet/fund` requires `Authorization: Bearer <token>` and the typed
`FundAccRequest` body. Use `remoteFaucet` from `mn-passport-adapter-service/faucet` and reuse the
same `requestId` when checking an uncertain outcome. Completed IDs replay the recorded result;
pending IDs return HTTP 409 until an operator reconciles the ledger and reservation. The response
contains the deposit transaction ID and the ACC balance
after confirmation; a localnet NIGHT deposit also returns the preparation self-transfer transaction
ID. The route does not expose the token or wallet seed.
`GET /v1/faucet/balances?accountAddress=<hex>` also requires the bearer token and a deployed ACC.
It reads the ACC ledger's unshielded NIGHT and first allowlisted non-NIGHT balances; it does not
read the built-in HD wallet.

On the standalone localnet, `demo up --funding` enables a **Fund Passport account** button in the
browser page. The Passport service reads this token file and forwards a fixed deposit of up to 10
smallest units of the selected allowlisted asset to this separate process. The browser receives only the asset
color, amount, transaction ID and confirmed ACC balances for NIGHT and the test token. This route is refused on other networks
or when the Passport service is bound beyond loopback. The operator CLI remains available as
`demo fund`.

The funding service defaults to packaged `acc-s3r1.1`. An explicit source-only
`acc-s3r1.1-zkir036` path verifies the candidate manifest and generated module
before loading it, then routes NIGHT deposits through the pinned adapter. It
requires `PASSPORT_CANDIDATE_LOCAL=1`, the exact candidate binding and manifest,
an absolute canonical `PASSPORT_ARTEFACT_DIR`, a separately funded non-genesis
seed file, explicit candidate reservation and deployment files, a NIGHT-only
asset policy and loopback Ledger 9 / Indexer API v4 endpoints. Its
general value-call endpoint remains closed for candidate accounts. The Midnames
demo launcher does not yet enable candidate funding: the funding-service route
still needs an exact-head native reservation, submission and replay qualification.

The reference reservation store is safe for one host sharing one file. It creates
`<reservations-file>.lock` during updates. If the process dies with the lock present, inspect
pending requests, wallet transactions and ACC balances before removing it. Use a transactional
database for replicas. New requests journal the pre-deposit ACC balance, the optional NIGHT
preparation transaction ID and the deposit transaction ID as each milestone is reached. Inspect
the file without modifying it:

```sh
nix develop -c pnpm --filter passport-funding-service inspect --file \
  "$HOME/.midnight-passport/funding-reservations.json"
# Add --request-id <UUID> for one request, or --all to include completed requests.
```

The inspector validates the file, lists pending requests and reports whether a lock directory is
present. It does not read the wallet seed or bearer token. A request created before progress
journaling has no transaction IDs in its reservation. Even a new request can stop between node
submission and recording the transaction ID, so missing progress does **not** prove that no value
moved. The backend records `noSubmit` only if a preflight read or validation failed before it
entered wallet preparation or the ACC deposit. A node rejection during a legacy
deposit can leave a request pending with a preparation ID but no deposit ID. Keep
that original reservation; its missing ID or unchanged ACC balance alone does
not prove that every submission attempt was refused. The measured local NIGHT
path records its hash before submission so future failures identify the exact
transaction for operator inspection. If local proof, balancing or call validation
fails after the exact-value wallet self-transfer, the backend durably records
`accNotSubmitted` before it can enter the ACC submitter. The route releases that
exact request, preserves the preparation ID, and returns `FundingRequestReleased`.
This proves only that the **ACC deposit** was not submitted; the wallet
self-transfer may already be on-chain. If the marker or release write fails, the
request remains pending. A failure after the final deposit hash is recorded also
remains pending, even if the node returned an error. An operator may release the one proved
`noSubmit` case:

```sh
nix develop -c pnpm --filter passport-funding-service reconcile --file \
  "$HOME/.midnight-passport/funding-reservations.json" \
  --request-id '<original UUID>' --operator '<your-id>' --release-no-submit yes
```

The command rechecks the marker under the store lock, makes a mode-600, fsynced backup beside the
reservation file, records the operator, timestamp and reason in the request tombstone, then frees
its daily quota. The original request ID remains unusable; a *new* ID is appropriate only after
the original was released. The corresponding operator recovery after a crash
between the durable `accNotSubmitted` marker and automatic release is:

```sh
nix develop -c pnpm --filter passport-funding-service reconcile --file \
  "$HOME/.midnight-passport/funding-reservations.json" \
  --request-id '<original UUID>' --operator '<your-id>' --release-acc-not-submitted yes
```

This mode requires the persisted marker, a local NIGHT reservation, a preparation
ID and no final deposit hash. Inspect the wallet self-transfer separately; its
absence is not implied by this release. The `--release-no-submit` mode is only
for the earlier preflight boundary. Neither mode accepts a request with no marker
or an uncertain final submission. Legacy pending requests without a marker stay
pending for independent chain and wallet reconciliation.

For the specific old local NIGHT path that retried a node gas rejection four
times, an operator can instead release an uncredited request after preserving
the exact node log and checking that those four rejections belong to the one
request. Stop only this Passport demo and its funding wallet before reconciling;
leave the shared Midnight stack running. Save a bounded `docker logs --since …
--until … <exact-node-container-id>` excerpt to a private mode-600 file. The
command requires an explicit attribution attestation, four distinct gas-budget
rejection hashes in a two-minute window at least ten minutes old, a currently
empty node mempool, the complete ACC action history with no unshielded deposit,
and an unchanged NIGHT balance. It refuses a request with a recorded deposit
ID or without a preparation ID:

```sh
nix develop -c pnpm --filter passport-funding-service reconcile --file \
  "$HOME/.midnight-passport/funding-reservations.json" \
  --request-id '<original UUID>' --operator '<your-id>' \
  --release-rejected yes --node-log /absolute/path/to/private-node-rejections.log \
  --attest-same-request yes \
  --indexer-url http://127.0.0.1:8088/api/v4/graphql \
  --indexer-ws-url ws://127.0.0.1:8088/api/v4/graphql/ws
```

This is a local operator judgment: the node log alone does not bind its hashes
to a funding reservation because the legacy wallet omitted them. Verify the
service's four failed attempts and time window before attesting. The command
backs up the reservation, retains the original as a released tombstone with
the rejected hashes, log digest and ACC frontier, and never reuses its ID. If
any evidence is missing, keep the original pending. When the browser next
checks that exact released request, the funding service returns a bounded
`FundingRequestReleased` receipt through the demo proxy. Only that exact receipt
clears the browser's old ID; click **Fund Passport account** once more to start a
new request. A timeout or ordinary 409 never clears it.
For a request whose deposit transaction ID was durably journaled, the localnet operator can check
the indexer's complete ACC action history and complete the original request only when that
transaction contains exactly one successful `deposit_unshielded` call whose balance change is
exactly the reserved amount:

```sh
nix develop -c pnpm --filter passport-funding-service reconcile --file \
  "$HOME/.midnight-passport/funding-reservations.json" \
  --request-id '<original UUID>' --operator '<your-id>' --confirm-credit yes
```

The resolver defaults to the local indexer on port 18088; `--indexer-url` and `--indexer-ws-url`
can select another loopback endpoint. It is qualified only for the `undeployed` network. It
refuses missing transaction IDs, failed or partial transactions, a different circuit, duplicate
matching actions, an incomplete history, and any balance delta other than the reserved amount.
Success records the original result plus transaction hash, before/after balances, operator and
timestamp, after a private backup. Replaying the same request ID returns that result. Review the
wallet transaction and ACC ledger too; a pending request that fails these checks stays pending.
Never delete a pending entry to retry. If a stale
`.lock` directory remains after a crash, stop all funding processes, copy the reservation file to a
private backup, reconcile every pending request against wallet and chain evidence, then remove the
lock directory manually. The `FundingStore` interface defines atomic reserve, milestone, complete,
and release operations for a future transactional database; do not run replicas against separate
files or a shared filesystem lock without a transactional implementation.

The source has focused policy and backend tests. On the local `undeployed` network, this process deposited 10 units of a faucet-minted non-native unshielded asset into a
live `spec_version = 3` ACC and observed the credited balance. Repeating the same request ID
returned the same transaction ID and balance. Historical RC2 evidence is retained below; use the current RC9 image in the next section.

<span id="source-preview-funding-inventory-admission-after-rc8"></span>

## RC9: funding inventory admission

The reference application reads spendable **unshielded** balances from its existing wallet.
`GET /v1/faucet/assets` requires the funding bearer token and returns the pinned network,
binding and manifest, plus each policy asset's demo amount and `availability`:
`available`, `insufficient` or `unavailable`. It exposes neither wallet balances nor keys.
An unsynchronized, failed or timed-out wallet read is unavailable, never a zero balance.
DUST synchronization does not block this unshielded observation.
After a deposit confirms, the wallet may still be indexing that transaction. Inventory
observations allow up to five seconds for unshielded catch-up before refusing; they never
use stale balances or retry the deposit. A longer outage still returns unavailable.

Discovery is advisory. The funding backend samples inventory again **inside its deposit queue**,
before preparation or deposit. For an inventory refusal, it durably records `no-submit`,
tombstones the original request and releases its quota before returning `FundingAssetUnavailable`
(409) or `FundingWalletUnavailable` (503), with that `requestId` and `submission: not-started`.
A new explicit user attempt can then use a new ID. Replaying the tombstoned ID never executes it.
A failed journal/release, legacy pending request, or exception after entering wallet preparation
or deposit remains unknown and cannot use this response. Never infer no-submit from an SDK
exception, missing transaction ID, unchanged balance or a current inventory snapshot.

Safe diagnostic logs record the request ID, last durable stage and fixed failure code.
They intentionally exclude the raw wallet exception, proof data, token and seed.
The demo disables unavailable deposits while keeping configured assets visible for ACC balance
reads and withdrawals. Allowlisting a custom color does not mint it: provision that exact asset
in this funding wallet on this chain before offering it. Changing chains does not carry inventory
from an older demo. No automatic faucet mint or old-reservation reset is performed.

These changes are included in RC9 and require matching reference service/funding versions.
They are absent from RC8 packages/images. Preserve all wallet/journal/chain state and use
only the recorded resources belonging to the demo being restarted.

## Wallet and state ownership

The service and funding process must use distinct funded wallet seeds when run
concurrently. On `undeployed`, both defaults select the public genesis seed; use
that shared default only for sequential single-wallet qualification, stopping and
confirming the first process has exited before starting the second. Configure
`PASSPORT_FUNDING_SEED_FILE` for the distinct asset wallet; changing the path
without provisioning its funds does not create inventory.

Keep separate persistent state directories/volumes for the two wallets. Put the
trusted registry/deployment log in a separate shared directory, mounted read-only
by funding, so atomic log replacement remains visible. Never share a wallet's
LevelDB directory between processes. Linux-native state is required for durable
image qualification; on Docker Desktop use managed Linux volumes rather than
macOS bind mounts for those journals. Run as a non-root identity with explicit
state and private-file permissions.

## Container image

The [funding image workflow](../../.github/workflows/publish-funding-image.yml) publishes
`ghcr.io/input-output-hk/midnight-passport-funding:<version>` and a commit-SHA tag after a
signed `funding-v<version>` tag or an authorised workflow dispatch. Release `0.1.0-rc9` also has
`sha-0293fac13c2b`; its immutable digest is
`sha256:be7b55b9772d71fc142b76b9ab5915d9841b834c88542ae5ecbf965cf5161647`.
The published GHCR package is public. Pin this RC9 digest when deploying. It includes the
localnet NIGHT preparation path and passed current startup/refusal checks on Linux/amd64
(emulated on the local ARM64 host). The published digest passed non-root readiness, NIGHT credit, same-original-ID replay without extra credit, a distinct repeated deposit and unavailable-token409 refusal before submission. It used synthetic credentials, a source SDK client and a sequential standalone wallet; no wider-network or real-provider acceptance is implied.
The historical RC5 image passed a deposit from zero to ten smallest NIGHT units and
an identical-request replay without a second transfer. Its
[RC5 publication receipt](../../docs/release/rc5-publication-receipt.json) retains those transactions;
the [RC9 signed receipt](https://github.com/input-output-hk/midnight-passport-sdk/releases/download/sdk-v0.1.0-rc9/rc9-publication-receipt.json)
records current package/image checks. NIGHT remains qualified only on `undeployed`;
dedicated non-localnet wallet configuration does not extend that qualification.
The image contains the SDK application, not the 11 GiB proving tree, any wallet seed, or tokens.
Both image workflows run `scripts/smoke-funding-image.sh`: it checks the non-root user, refusal
without the pinned contract mount, and startup refusal on a non-standalone network without a
dedicated seed or asset policy. The production secret files remain outside the image.
Its entrypoint requires a **Linux-prepared** pinned `6458ed5` export at `/data/contract`, including
compiled `contracts/managed/account` artefacts and that export's `node_modules`. The service
verifies the complete pinned key tree and manifest before readiness. Mount persistent writable
state at `/data/state`; its LevelDB wallet state and reservation file live there. The image runs
as UID/GID `10001:10001` by default.

For a non-root Linux operator, prepare the export, separate state directories and private files, then
run the image with that non-root operator's UID so it can read the files and write state.
The example requires an already-funded, distinct `PASSPORT_FUNDING_SEED_FILE`.
Omit that file override only for a sequential genesis-wallet qualification with
the sponsor process confirmed stopped. Like the [service example](../passport-service/README.md),
this native Linux command uses host networking and the default localnet ports 9944/8088/6300.
It explicitly binds funding to loopback port 8789. Adjust endpoints for your existing stack;
bridge-network deployments need their actual localnet network and service aliases instead.

```sh
mkdir -p "$HOME/.midnight-passport/funding-state" "$HOME/.midnight-passport/registry"
chmod 700 "$HOME/.midnight-passport/funding-state" "$HOME/.midnight-passport/registry"
docker run --rm --platform linux/amd64 --user "$(id -u):$(id -g)" \
  --network host \
  -e PASSPORT_FUNDING_HOST=127.0.0.1 \
  -e PASSPORT_FUNDING_PORT=8789 \
  -v "$PASSPORT_CONTRACT_DIR:/data/contract:ro" \
  -v "$HOME/.midnight-passport/funding-state:/data/state" \
  -v "$HOME/.midnight-passport/funding-token:/run/passport-secrets/funding-token:ro" \
  -v "$HOME/.midnight-passport/funding-assets.json:/run/passport-secrets/funding-assets.json:ro" \
  -v "$HOME/.midnight-passport/registry:/data/deployments:ro" \
  -v "$PASSPORT_FUNDING_SEED_FILE:/run/passport-secrets/funding-seed:ro" \
  -e HOME=/data/state \
  -e PASSPORT_FUNDING_TOKEN_FILE=/run/passport-secrets/funding-token \
  -e PASSPORT_FUNDING_ASSETS_FILE=/run/passport-secrets/funding-assets.json \
  -e PASSPORT_FUNDING_DEPLOYMENTS_FILE=/data/deployments/registry.deployments.json \
  -e PASSPORT_FUNDING_SEED_FILE=/run/passport-secrets/funding-seed \
  -e MN_NETWORK_ID=undeployed \
  -e MN_NODE_URL=http://127.0.0.1:9944 \
  -e MN_INDEXER_URL=http://127.0.0.1:8088/api/v4/graphql \
  -e MN_INDEXER_WS_URL=ws://127.0.0.1:8088/api/v4/graphql/ws \
  -e MN_PROOF_SERVER_URL=http://127.0.0.1:6300 \
  ghcr.io/input-output-hk/midnight-passport-funding@sha256:be7b55b9772d71fc142b76b9ab5915d9841b834c88542ae5ecbf965cf5161647
```

The earlier RC2 Linux image build and mounted-tree run succeeded on `undeployed`: an image-backed
request deposited 10 units of a non-native unshielded asset into a live ACC, changing its
confirmed balance from 10 to 20; repeating the same request UUID returned the same transaction
ID and balance. The source image uses a read-only contract mount and never downloads proving keys
at runtime.
The [key service image](../passport-key-service/README.md) restores and serves keys separately;
prepare the funding image's contract tree on Linux with the same binding and manifest pin. The
funding token must stay in a private file or secret mount. GHCR visibility and repository/team
access are configured on the container package's settings page.

The RC9 reference policy admits 1–64 distinct assets consistently in both services
and the browser. Older balance responses, including failures, cannot overwrite a newer read
or a reopened account’s availability. Inventory reads remain bounded even when subscription
teardown throws.

An unavailable selected deposit asset stays selected with funding disabled; refresh never
switches it to another asset. A current availability-read failure also disables deposits
until a successful refresh, preserving the asset list and withdrawal choices.

Direct published ports must match the configured internal service port because
the HTTP server validates Host against its local socket. If changing a port, set
`PASSPORT_SERVICE_PORT` or `PASSPORT_FUNDING_PORT` and both sides of the Docker
port mapping together. A mismatched mapping returns HTTP 421; do not weaken Host validation.
