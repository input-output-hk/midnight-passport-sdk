# Passport proving and sponsorship service

This Node process serves the pinned ACC artefacts, proves transactions, deploys ACCs in waves,
submits eligible calls, and sponsors their fees. It does **not** transfer wallet-held assets into
an ACC; that is the separate [funding service](../passport-funding-service/README.md). The
service owns a fee sponsor wallet and accepts requests from its configured browser origin. It is
not an authenticated public endpoint: restrict ingress to trusted clients, add authentication and
rate limits at the gateway, and set `PASSPORT_MAX_DEPLOYS` to an operator-approved budget.

## Container image

The [image workflow](../../.github/workflows/publish-service-image.yml) builds and smoke-tests
`ghcr.io/input-output-hk/midnight-passport-service:<version>` from a signed `service-v<version>`
tag on `passport-acc-prototype`, or an authorized workflow dispatch. Release `0.1.0-rc5` and its
`sha-9e8048674a54` tag share immutable digest
`sha256:b4d2900689c37fd7f8fee9dfa1257a45da9a41efd3e7841f4e5496605ccb6b25`. Pin that digest when deploying. The image contains the SDK application;
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

For a local Docker Desktop demonstration with a Linux-prepared export, run the image on the same
network as the localnet or use the host-published ports. The four `MN_*_URL` values must match
the export's patched reference client configuration. `PASSPORT_PUBLIC_*_URL` values are the
browser-reachable endpoints returned by `/v1/config`; set them whenever the service connects
through container-only hostnames or a private network. The browser needs direct access to the
node and indexer endpoints. Run the published RC5 digest:

```sh
docker run --rm --platform linux/amd64 --user "$(id -u):$(id -g)" \
  -p 127.0.0.1:8787:8787 \
  -v "$PASSPORT_CONTRACT_DIR:/data/contract:ro" \
  -v "$HOME/.midnight-passport:/data/state" \
  -e PASSPORT_MANIFEST_SHA256=77fb9c17b0d59047456c43115d9a58f5cb99a226ee73b6b974fd724930c3153f \
  -e MN_NETWORK_ID=undeployed \
  -e MN_NODE_URL=http://host.docker.internal:19944 \
  -e MN_INDEXER_URL=http://host.docker.internal:18088/api/v4/graphql \
  -e MN_INDEXER_WS_URL=ws://host.docker.internal:18088/api/v4/graphql/ws \
  -e MN_PROOF_SERVER_URL=http://host.docker.internal:16300 \
  -e PASSPORT_PUBLIC_NODE_URL=http://localhost:19944 \
  -e PASSPORT_PUBLIC_INDEXER_URL=http://localhost:18088/api/v4/graphql \
  -e PASSPORT_PUBLIC_INDEXER_WS_URL=ws://localhost:18088/api/v4/graphql/ws \
  -e PASSPORT_PUBLIC_PROOF_SERVER_URL=http://localhost:16300 \
  ghcr.io/input-output-hk/midnight-passport-service@sha256:b4d2900689c37fd7f8fee9dfa1257a45da9a41efd3e7841f4e5496605ccb6b25
```

The Docker build smoke checks the non-root user, missing-export refusal, non-standalone
startup refusal without a dedicated seed, and refusal of a manifest hash outside the package pin.
The published RC5 digest passed startup refusals and a mounted-tree localnet run with a fresh
JubJub ACC: ten deployment waves, activation, chain read and reopen. Together with the published
funding image, the ACC received ten smallest NIGHT units and replayed the same request without
a second deposit. The [publication receipt](../../docs/release/rc5-publication-receipt.json)
records the exact source, transactions and image digests. This does not establish full Lace or
non-localnet NIGHT compatibility.
The [demo guide](../README.md) documents the source process, browser, and localnet flows.
