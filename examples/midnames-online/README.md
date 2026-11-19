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

The Caddyfile was checked with Caddy 2.9.1. A local synthetic upstream check
verified HTTP and WebSocket path rewrites, upstream header injection, local
preflight, rejection of untrusted and missing origins, replacement of an
upstream wildcard CORS header, an off-scope 404, and absence of the test ID
from client URLs and process logs.
That check does not establish a live Blockfrost response or provider agreement.
