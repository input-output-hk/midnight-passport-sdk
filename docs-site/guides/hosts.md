# Wire a browser, Node, or wallet host

## Browser application

`adapter-browser` composes the portable account flows with WebAuthn, key recipes, the lazy Midnight chain adapter, and service clients. Your host supplies the RP/origin, persistent records, checked network and binding, credential review, and backend endpoints. Browser builds need the pinned WASM/Buffer/polyfill setup. Follow the [first integration](/getting-started/first-integration).

## Node or existing wallet

Import `account` and `protocol`, then implement the typed `account/ports` boundary with your host's signer, chain/indexer, prover, value calls, settlement, storage, and consent. `adapter-service` HTTP clients work in fetch-capable Node; `service` is the Node server library. Node does not acquire a passkey provider by importing a browser module. A wallet host can preserve its own orchestration and adopt only account flows or the contract binding.

`adapter-browser/hosted-jubjub` is an optional bridge for a compatible host transport. Its existence does not qualify full Lace integration. The [RC9 Lace handover](https://github.com/input-output-hk/midnight-passport-sdk/releases/download/sdk-v0.1.0-rc9/rc9-lace-handover.md) specifies the tested subset, while Lace owns its own wallet and provider policy.

## Optional framework wiring

React, Vue, or another UI layer should create one integration module, bind explicit actions, project public progress, and dispose its own listeners/workers. Framework-neutral account contracts do not depend on React. The [reference React example](https://github.com/input-output-hk/midnight-passport-sdk/blob/sdk-v0.1.0-rc9/docs/site/react-example.md) is a browser development example, not an SSR or native compatibility claim.

For application-contract → ACC calls, use the [standards and implementation map](/architecture/standards). Do not infer arbitrary reverse calls from a supported incoming call path.

## Midnames source preview

To inspect this locally, start with the [Midnames demo launcher](https://github.com/input-output-hk/midnight-passport-sdk/blob/passport-acc-prototype/examples/midnames-local/README.md#open-the-local-passport-and-midnames-demo).
Its `check` command verifies the existing Ledger 9 stack, finalized name claim,
registry contract target and activated ACC without changing Docker. `up`
opens the opt-in JubJub demo; when no compatible stack exists, it can start a
separate Passport-owned project from the pinned Ledger 9 Compose template.
Fresh chains need ACC creation, registry bootstrap and a confirmed name claim
before the named control is enabled. The launcher never funds a sender merely
by opening the page.

The [provisional local ACC profile](https://github.com/input-output-hk/midnight-passport-sdk/blob/passport-acc-prototype/examples/midnames-local/README.md#provisional-acc-local-demo-profile)
selects separately verified `acc-s3r1.1-zkir036` assets and the shared Ledger 9
release prover. It keeps candidate deployments and claim originals in separate
local journals. This is an explicit source opt-in: the ordinary demo and public
SDK binding remain on `acc-s3r1.1`, and online candidate admission is refused.
A [one-head local browser receipt](https://github.com/input-output-hk/midnight-passport-sdk/blob/passport-acc-prototype/examples/midnames-local/evidence/candidate-onehead-create-claim-pay-20261122.json)
covers fresh ACC creation, name claim, funding, device-wallet DUST, and named
two-leg payments with original-only recovery. It uses a synthetic passkey and
the shared local chain; human-provider and online qualification remain separate.

The reference demo pins the published Midnames 2.1.0 reader for lookups. Its
generated reader matches the pinned
[`ledger-9-live` commit](https://github.com/midnames/ns-sdk/tree/f8f2edd425221b95c9158d74e7318d2fbb4f61b2),
which the app checks in its tests. Configure the
registry address, namespace, matching demo network, and public indexer URLs.
Use paired Indexer API v4 HTTP and WebSocket endpoints. The demo refuses v3
paths even though the upstream package still contains older defaults.
The adapter reads the registry's contract target and checks the deployed ACC
verifier roster before displaying the result. On the pinned standalone registry,
the demo checks name availability and reconciles retained sponsor receipts.
For supported-target lookups, the local launcher supplies a confirmed claim
block and node URL. The browser checks that the indexer's selected block is
canonical and finalized on that node before reading the registry or ACC.
Online configuration requires a separate node origin and a confirmed non-genesis
chain pin. The browser compares each indexer state with the node's
`midnight_contractState` bytes at that block, refusing a mismatch or unavailable
RPC. This trusts the configured node; it is not a cryptographic state proof or
an online qualification.
To create that registry on a healthy local stack after activating an ACC, use
the [pinned local bootstrap recipe](https://github.com/input-output-hk/midnight-passport-sdk/blob/passport-acc-prototype/examples/midnames-local/README.md#bootstrap-the-registry-on-an-existing-local-stack).
It records the deployment waves and keeps root naming authority private; the
resulting `.night` root is separate from public `passport.night` issuance.
The local preparation command fetches the branch's pinned `ns.compact` and
recompiles it with ZKIR v3. The bootstrap command then deploys the separate registry.
Midnames' paused writes to its older deployed registry do not block this
local claim path.

The shared local Ledger 9 profile discovers its existing node, v4 indexer and
prover without starting a second stack. Its public genesis sponsor is funded
for local development; coordinate exclusive wallet use. For an online host,
set `PASSPORT_SPONSOR_SEED` to a funded wallet's 64-character lowercase hex
seed in the service environment and configure that network's verified Midnames
registry address. The wallet needs NIGHT and usable DUST for fees. See the
[Midnames SDK](https://github.com/midnames/ns-sdk),
[Midnames Preprod guide](https://docs.midnight.domains/preprod/connect/), and
[Midnight wallet funding guide](https://docs.midnight.network/guides/acquire-tokens).

The opt-in standalone demo can prepare a reviewed claim with the open account's
passkey. A definitive sponsor refusal before any balance intent permits a fresh
quote review; an unknown outcome keeps the original. The browser shows the saved
price, payee, fee ceiling and expiry before a second click sends. Imported
quote-less receipts can only be reconciled. The sponsor bounds NIGHT inputs
and change to the quoted payment wallet. A fresh isolated Chromium run on
signed `9a19757` recovered the original claim after one dispatch, a lost
response and a browser restart; it refused an alternate credential. Its
post-proof fixture quote did not establish pre-proof user review. It used
fixture login and a virtual passkey. The shielded
deposit and two-leg NIGHT payment have standalone Node fixtures. Online profiles
and real passkey provider recovery require separate qualification.
At signed `b87ed6c`, the independent sender fixture also displayed the exact
named shielded deposit in its own localhost browser before preparation. An
automated approval led to one finalized dispatch and a separately verified
recipient holding on isolated `undeployed`. The browser received public target
details only; recipient secrets stayed with the owner. Human review, a sender
page in the Passport demo, MIP-0007 delegated routing and public `passport.night`
are still open.
At signed `ec83ce9`, the local named NIGHT fixture showed one owner-browser
review of the source, resolved recipient, bridge wallet and two ACC operations
before any synthetic owner signature. An automated approval led to one
withdrawal and one deposit after durable original-intent recovery, with 6/4
final ACC balances. The reference demo now has an opt-in owner send page and a
connected local candidate payment receipt. Human passkey consent and online
naming remain separate qualification gates.
See the [demo configuration and evidence](https://github.com/input-output-hk/midnight-passport-sdk/blob/passport-acc-prototype/docs/site/names.md#source-preview-midnames-210).
