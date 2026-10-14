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

The reference reservation store is safe for one host sharing one file. It creates
`<reservations-file>.lock` during updates. If the process dies with the lock present, inspect
pending requests, wallet transactions and ACC balances before removing it. Use a transactional
database for replicas. The source has focused policy and backend tests. On the local `undeployed`
network, this process deposited 10 units of a faucet-minted non-native unshielded asset into a
live `spec_version = 3` ACC and observed the credited balance. Repeating the same request ID
returned the same transaction ID and balance. A container image is still required before
publishing this service as a release artifact.
