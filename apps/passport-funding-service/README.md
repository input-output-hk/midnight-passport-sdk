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
    "color": "<32-byte non-NIGHT asset color as lowercase hex>",
    "maxPerRequest": "100",
    "maxPerUtcDay": "1000"
  }
]
JSON
```

Replace the example color with an asset already held by the funding wallet. The upstream
[funding experiment](https://github.com/midnightntwrk/passport/blob/main/contract/evidence/grants-e4-funding-grants-unshielded-funding.json)
confirmed a non-native unshielded deposit; its NIGHT deposit was refused by the node fee budget.
The config rejects NIGHT until a node-backed test establishes support.

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
same `requestId` for retries. The response contains the transaction ID and the ACC balance after
the deposit is observed. The route does not expose the token or wallet seed.
`GET /v1/faucet/balances?accountAddress=<hex>` also requires the bearer token and a deployed ACC.
It reads the ACC ledger's unshielded NIGHT and first allowlisted test-token balances; it does not
read the built-in HD wallet.

On the standalone localnet, `demo up --funding` enables a **Fund Passport account** button in the
browser page. The Passport service reads this token file and forwards a fixed deposit of up to 10
units of the first allowlisted asset to this separate process. The browser receives only the asset
color, amount, transaction ID and confirmed ACC balances for NIGHT and the test token. This route is refused on other networks
or when the Passport service is bound beyond loopback. The operator CLI remains available as
`demo fund`.

The reference reservation store is safe for one host sharing one file. It creates
`<reservations-file>.lock` during updates. If the process dies with the lock present, inspect
pending requests, wallet transactions and ACC balances before removing it. Use a transactional
database for replicas. The source has focused policy and backend tests. On the local `undeployed`
network, this process deposited 10 units of a faucet-minted non-native unshielded asset into a
live `spec_version = 3` ACC and observed the credited balance. Repeating the same request ID
returned the same transaction ID and balance. The `0.1.0-rc2` container image passed its release
build and mounted-tree smoke test and is published to GHCR.

## Container image

The [funding image workflow](../../.github/workflows/publish-funding-image.yml) publishes
`ghcr.io/input-output-hk/midnight-passport-funding:<version>` and a commit-SHA tag after a
signed `funding-v<version>` tag or an authorized workflow dispatch. Release `0.1.0-rc2` also has
`sha-2f7f2b1974f2`; its immutable digest is
`sha256:5b1aebaba4944c0beccd8d70047b51b9d779f30a8839461af20c5a10f26ca9e5`. The
published GHCR package is currently public. Pin the digest when deploying.
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
  ghcr.io/input-output-hk/midnight-passport-funding@sha256:5b1aebaba4944c0beccd8d70047b51b9d779f30a8839461af20c5a10f26ca9e5
```

The local Linux image build and a mounted-tree run succeeded on `undeployed`: an image-backed
request deposited 10 units of a non-native unshielded asset into a live ACC, changing its
confirmed balance from 10 to 20; repeating the same request UUID returned the same transaction
ID and balance. The source image uses a read-only contract mount and never downloads proving keys
at runtime.
The [key service image](../passport-key-service/README.md) restores and serves keys separately;
prepare the funding image's contract tree on Linux with the same binding and manifest pin. The
funding token must stay in a private file or secret mount. GHCR visibility and repository/team
access are configured on the container package's settings page.
