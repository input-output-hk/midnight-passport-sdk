# Optional Preprod indexer proxy

The Passport demo's Midnames reader accepts explicit Indexer API v4 HTTP and
WebSocket URLs. It rejects query parameters so a Blockfrost project ID cannot
enter the browser bundle. Midnight's [network guide](https://docs.midnight.network/guides/networks-and-environments#blockfrost-the-mainnet-indexer-and-rpc-provider)
places Preprod's public indexer at Blockfrost's `/api/v0` endpoint and requires
a network-specific project ID. This Caddy example maps the demo's v4 paths to
that endpoint and adds the ID as an upstream header.

Install Caddy 2, set a Midnight **Preprod** project ID in the host environment,
and run the proxy from the SDK root:

```sh
export BLOCKFROST_PROJECT_ID=<your-nightpreprod-project-id>
nix develop -c bash examples/midnames-online/preprod-indexer-proxy.sh
```

The proxy listens only on `127.0.0.1:18088`, disables Caddy's admin endpoint,
and forwards only `/api/v4/graphql` and `/api/v4/graphql/ws`. It accepts HTTP
and WebSocket requests only with an exact `Origin` of `http://localhost:5173`
or `http://127.0.0.1:5173` (the local demo); missing and other origins receive
HTTP 403. It handles the browser's GraphQL preflight locally and replaces any
upstream wildcard CORS header with the accepted origin. Other app origins need
their own reviewed allowlist before using this example. The browser-facing pair
is:

```text
http://127.0.0.1:18088/api/v4/graphql
ws://127.0.0.1:18088/api/v4/graphql/ws
```

Keep the project ID out of `VITE_` inputs, URL query strings, committed files,
and logs. This loopback example is for a trusted local operator; production
hosts must authenticate and restrict their own proxy. A second Caddy instance
pointing to the same Blockfrost service is **not** an independent verifier.

The SDK still refuses an online naming profile without a second indexer on a
distinct origin and an independently observed, dated name-to-deployed-ACC
mapping. The operator must verify that both readers use the same Preprod chain,
the configured registry is deployed and pinned, and the known name resolves to
the expected ACC before enabling `VITE_MIDNAMES_*`. This example does not supply
that mapping or qualify an online claim, deposit, or NIGHT send. The current
[Midnight Domains site](https://midnight.domains/) says registration is paused
during its Ledger 9 migration.

A [dated, single-provider mainnet observation](evidence/mainnet-passport-name-v4-observation-20261122.json)
found the published Midnames registry through the explicitly configured
`api.midnames.com` Indexer API v4 endpoint. At the indexer's selected block,
`passport.night` resolved through `@midnames/sdk@2.1.0` with a **shielded
primary target**. This establishes neither Passport ownership of that name
nor a contract-call target, delegated subdomain policy, or a known ACC mapping.
It has no independent node-finality or second-provider check. Keep the
online Passport profile disabled; the mainnet observation cannot substitute
for the Preprod profile or the qualification above.

The Caddyfile was checked with Caddy 2.9.1. A local synthetic upstream check
verified HTTP and WebSocket path rewrites, upstream header injection, local
preflight, rejection of untrusted and missing origins, replacement of an
upstream wildcard CORS header, an off-scope 404, and absence of the test ID
from client URLs and process logs.
That check does not establish a live Blockfrost response or provider agreement.

## Check one known mapping at a finalized block

Before considering an online profile, obtain a dated name-to-deployed-ACC
mapping from an independent source and two indexers operated by genuinely
different providers. Save a private profile with the exact chain, public
registry, node and tokenless indexer endpoints:

```json
{
  "schemaVersion": 1,
  "networkId": "preprod",
  "nodeRpcUrl": "https://rpc.midnight-preprod.blockfrost.io/",
  "registryProfile": "midnames-2.1.0",
  "registryAddress": "<64 lowercase hex characters>",
  "bindingId": "acc-s3r1.1",
  "namespace": "night",
  "knownName": "<independently observed name>.night",
  "knownAcc": "<64 lowercase hex characters>",
  "observationDate": "<YYYY-MM-DD>",
  "primaryIndexer": {
    "http": "https://<operator-controlled-host>/api/v4/graphql",
    "ws": "wss://<operator-controlled-host>/api/v4/graphql/ws"
  },
  "witnessIndexer": {
    "http": "https://<independent-host>/api/v4/graphql",
    "ws": "wss://<independent-host>/api/v4/graphql/ws"
  }
}
```

Run the read-only check with two independent readers available. The browser
proxy above intentionally requires a browser Origin and refuses this Node CLI;
do not weaken that gate. Point the CLI at separately provisioned tokenless
Indexer API v4 endpoints or operator-controlled host proxies that admit its
requests. The Blockfrost project ID stays in the host environment; it is sent
as a header only when the node URL is the exact official Blockfrost host for
that network.
Other node hosts receive no project ID. Use new absolute paths for the private
profile and receipt:

```sh
export BLOCKFROST_PROJECT_ID=<your-nightpreprod-project-id>
nix develop -c pnpm --filter passport-dapp exec node --import tsx \
  ../../examples/midnames-online/check-known-mapping.mjs \
  /private/online-profile.json /private/online-check.json
```

The script verifies the node's chain ID and finalized block, waits for both
indexers to expose that exact block hash and height, and decodes the registry
and activated ACC at that block through each reader. It refuses a missing,
moved or unsupported contract target, a wrong chain, lagging or disagreeing
indexer, and a block no longer canonical on the node. The receipt is created
once with private file permissions and contains public pins, origins and
limits, never the project ID. The witness URL must use a separate backend:
two origins that proxy the same provider are not independent.

This checks one operator-supplied known mapping. It cannot prove that the
mapping was independently observed, that the readers are separately operated,
or that future online lookups remain fresh. Keep the browser online profile
disabled until those provider and ownership gates are evidenced separately.
