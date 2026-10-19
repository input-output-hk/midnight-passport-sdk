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
On the pinned localnet, an exact-value NIGHT UTXO avoids that fee shape. The service makes a
self-transfer of the requested amount before `deposit_unshielded`; a live 10-unit run confirmed
ACC credit. NIGHT remains disabled on other networks pending separate node-backed qualification.

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
entered wallet preparation or the ACC deposit. An operator may release that one proved case:

```sh
nix develop -c pnpm --filter passport-funding-service reconcile --file \
  "$HOME/.midnight-passport/funding-reservations.json" \
  --request-id '<original UUID>' --operator '<your-id>' --release-no-submit yes
```

The command rechecks the marker under the store lock, makes a mode-600, fsynced backup beside the
reservation file, records the operator, timestamp and reason in the request tombstone, then frees
its daily quota. The original request ID remains unusable; a *new* ID is appropriate only after
the original was released. Do not use the command for a request with no marker, after NIGHT
preparation, after deposit submission, or after an uncertain crash. Those cases remain pending.
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
returned the same transaction ID and balance. The `0.1.0-rc2` container image passed its release
build and mounted-tree smoke test and is published to GHCR.

## Container image

The [funding image workflow](../../.github/workflows/publish-funding-image.yml) publishes
`ghcr.io/input-output-hk/midnight-passport-funding:<version>` and a commit-SHA tag after a
signed `funding-v<version>` tag or an authorized workflow dispatch. Release `0.1.0-rc5` also has
`sha-9e8048674a54`; its immutable digest is
`sha256:94f387509d5de572c3c94be6fd7412c103323bf3c499ee597e44799a50689eb2`.
The published GHCR package is public. Pin this RC5 digest when deploying. It includes the
localnet NIGHT preparation path; the pulled image passed a deposit from zero to ten smallest
NIGHT units and an identical-request replay without a second transfer. See the
[publication receipt](../../docs/release/rc5-publication-receipt.json). NIGHT remains qualified
only on `undeployed`; dedicated non-localnet wallet configuration does not extend that qualification.
The image contains the SDK application, not the 11 GiB proving tree, any wallet seed, or tokens.
Both image workflows run `scripts/smoke-funding-image.sh`: it checks the non-root user, refusal
without the pinned contract mount, and startup refusal on a non-standalone network without a
dedicated seed or asset policy. The production secret files remain outside the image.
Its entrypoint requires a **Linux-prepared** pinned `6458ed5` export at `/data/contract`, including
compiled `contracts/managed/account` artefacts and that export's `node_modules`. The service
verifies the complete pinned key tree and manifest before readiness. Mount persistent writable
state at `/data/state`; its LevelDB wallet state and reservation file live there. The image runs
as UID/GID `10001:10001` by default.

For a local Docker Desktop demonstration, prepare the export and private files on the host, then
run the image with the host user's UID so it can read the files and write state. The example uses
the localnet containers' published host ports; set the four `MN_*_URL` values to your environment
for another network.

```sh
docker run --rm --platform linux/amd64 --user "$(id -u):$(id -g)" \
  -p 127.0.0.1:8789:8789 \
  -v "$PASSPORT_CONTRACT_DIR:/data/contract:ro" \
  -v "$HOME/.midnight-passport:/data/state" \
  -e HOME=/data/state \
  -e PASSPORT_FUNDING_TOKEN_FILE=/data/state/funding-token \
  -e PASSPORT_FUNDING_ASSETS_FILE=/data/state/funding-assets.json \
  -e PASSPORT_FUNDING_DEPLOYMENTS_FILE=/data/state/registry.deployments.json \
  -e MN_NETWORK_ID=undeployed \
  -e MN_NODE_URL=http://host.docker.internal:19944 \
  -e MN_INDEXER_URL=http://host.docker.internal:18088/api/v4/graphql \
  -e MN_INDEXER_WS_URL=ws://host.docker.internal:18088/api/v4/graphql/ws \
  -e MN_PROOF_SERVER_URL=http://host.docker.internal:16300 \
  ghcr.io/input-output-hk/midnight-passport-funding@sha256:94f387509d5de572c3c94be6fd7412c103323bf3c499ee597e44799a50689eb2
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
