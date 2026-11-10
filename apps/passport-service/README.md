# Passport proving and sponsorship service

This Node process serves the pinned ACC artefacts, proves transactions, deploys ACCs in waves,
submits eligible calls, and sponsors their fees. It does **not** transfer wallet-held assets into
an ACC; that is the separate [funding service](../passport-funding-service/README.md). The
service owns a fee sponsor wallet and accepts requests from its configured browser origin. It is
not an authenticated public endpoint: restrict ingress to trusted clients, add authentication and
rate limits at the gateway, and set `PASSPORT_MAX_DEPLOYS` to an operator-approved budget.

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

The [image workflow](../../.github/workflows/publish-service-image.yml) builds and smoke-tests
`ghcr.io/input-output-hk/midnight-passport-service:<version>` from a signed `service-v<version>`
tag on `passport-acc-prototype`, or an authorised workflow dispatch. Release `0.1.0-rc9` and its
`sha-0293fac13c2b` tag share immutable digest
`sha256:4175aadf1759c195f248175a0278c2c623833df79326a6c7a0aad891d3564543`. Pin that digest when deploying. The image contains the SDK application;
it contains no proving keys, compiled ACC export, sponsor seed, or account registry.

Prepare the pinned Passport revision `6458ed5` export **on Linux** with Compact 0.35.0 and its
Node dependencies, then mount it read-only at `/data/contract`. The entrypoint refuses a missing
export. The service checks its entire artefact tree against `PASSPORT_MANIFEST_SHA256` before it
opens port 8787. Keep `/data/state` writable and persistent: it holds the sponsor wallet state,
the account directory, and the deployment log used by sponsor policy. The image runs as
UID/GID `10001:10001` and answers `GET /healthz` only after wallet initialization.

The `undeployed` localnet uses the public genesis development sponsor seed. Every other network
requires a dedicated 32-byte lowercase hex seed in `PASSPORT_SPONSOR_SEED_FILE` (or the legacy
`PASSPORT_SPONSOR_SEED` environment variable). Keep that file outside the image and source tree.
Do not configure both sources. Mount the seed read-only and expose the service only through a
controlled ingress. `PASSPORT_DAPP_ORIGIN` selects the allowed browser origin; it is a CORS
setting, not an authentication mechanism.

For a non-root operator on native Linux Docker Engine, this example uses the
[host network](https://docs.docker.com/engine/network/drivers/host/) used by
`infra/localnet/docker-compose.yml`: node on 9944, indexer on 8088 and proof server on 6300. The
service explicitly binds loopback port 8787; no port publishing or Desktop-only hostname is needed.
Adjust endpoints for your existing stack and keep the same intended chain throughout.
`PASSPORT_PUBLIC_*_URL` values are the browser-reachable endpoints returned by `/v1/config`.
For a separate bridge-network deployment, join the intended localnet network, use its
service aliases internally and publish the configured service port on loopback; keep public
browser URLs separate. This command targets native Linux, not a Docker Desktop host bind mount.
Run the published RC9 digest:

```sh
mkdir -p "$HOME/.midnight-passport/service-state" "$HOME/.midnight-passport/registry"
chmod 700 "$HOME/.midnight-passport/service-state" "$HOME/.midnight-passport/registry"
docker run --rm --platform linux/amd64 --user "$(id -u):$(id -g)" \
  --network host \
  -e PASSPORT_SERVICE_HOST=127.0.0.1 \
  -e PASSPORT_SERVICE_PORT=8787 \
  -v "$PASSPORT_CONTRACT_DIR:/data/contract:ro" \
  -v "$HOME/.midnight-passport/service-state:/data/state" \
  -v "$HOME/.midnight-passport/registry:/data/registry" \
  -e PASSPORT_REGISTRY_FILE=/data/registry/registry.json \
  -e PASSPORT_MANIFEST_SHA256=77fb9c17b0d59047456c43115d9a58f5cb99a226ee73b6b974fd724930c3153f \
  -e MN_NETWORK_ID=undeployed \
  -e MN_NODE_URL=http://127.0.0.1:9944 \
  -e MN_INDEXER_URL=http://127.0.0.1:8088/api/v4/graphql \
  -e MN_INDEXER_WS_URL=ws://127.0.0.1:8088/api/v4/graphql/ws \
  -e MN_PROOF_SERVER_URL=http://127.0.0.1:6300 \
  -e PASSPORT_PUBLIC_NODE_URL=http://localhost:9944 \
  -e PASSPORT_PUBLIC_INDEXER_URL=http://localhost:8088/api/v4/graphql \
  -e PASSPORT_PUBLIC_INDEXER_WS_URL=ws://localhost:8088/api/v4/graphql/ws \
  -e PASSPORT_PUBLIC_PROOF_SERVER_URL=http://localhost:6300 \
  ghcr.io/input-output-hk/midnight-passport-service@sha256:4175aadf1759c195f248175a0278c2c623833df79326a6c7a0aad891d3564543
```

The Docker build smoke checks the non-root user, missing-export refusal, non-standalone
startup refusal without a dedicated seed, and refusal of a manifest hash outside the package pin.
The published digest passed content/non-root/refusal checks and valid Linux-mounted create/activate/read/reopen with synthetic JubJub credentials and a source SDK client. Its default hostJobs=false path was exercised; opt-in job-backed image interruption behavior is a separate qualification. The RC9 receipt distinguishes source-native, local mounted-candidate and pulled-image results.
The historical RC5 digest passed startup refusals and a mounted-tree localnet run with a fresh
JubJub ACC: ten deployment waves, activation, chain read and reopen. Together with the published
funding image, the ACC received ten smallest NIGHT units and replayed the same request without
a second deposit. The historical [RC5 publication receipt](../../docs/release/rc5-publication-receipt.json)
records the exact source, transactions and image digests. This does not establish full Lace or
non-localnet NIGHT compatibility.
The [demo guide](../README.md) documents the source process, browser, and localnet flows.

Direct published ports must match the configured internal service port because
the HTTP server validates Host against its local socket. If changing a port, set
`PASSPORT_SERVICE_PORT` or `PASSPORT_FUNDING_PORT` and both sides of the Docker
port mapping together. A mismatched mapping returns HTTP 421; do not weaken Host validation.
