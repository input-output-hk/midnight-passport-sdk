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

The reference demo can use Midnames 2.1.0 for read-only lookup. Configure the
registry address, namespace, matching demo network, and public indexer URLs.
The adapter reads the registry's contract target and checks the deployed ACC
verifier roster before displaying the result. On the pinned standalone registry,
the demo checks name availability and reconciles retained sponsor receipts.
To create that registry on a healthy local stack after activating an ACC, use
the [pinned local bootstrap recipe](https://github.com/input-output-hk/midnight-passport-sdk/blob/passport-acc-prototype/examples/midnames-local/README.md#bootstrap-the-registry-on-an-existing-local-stack).
It records the deployment waves and keeps root naming authority private; the
resulting `.night` root is separate from public `passport.night` issuance.
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
final ACC balances. Human passkey consent, an owner send page in the reference
demo and online naming remain separate qualification gates.
See the [demo configuration and evidence](https://github.com/input-output-hk/midnight-passport-sdk/blob/passport-acc-prototype/docs/site/names.md#source-preview-midnames-210).
