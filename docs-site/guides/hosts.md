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
The opt-in standalone demo can prepare a reviewed claim with the open account's
passkey. An isolated Chromium run recovered the original claim after one dispatch
and a lost response. It used fixture login and a virtual passkey. The shielded
deposit and two-leg NIGHT payment have standalone Node fixtures. Online profiles
and real passkey provider recovery require separate qualification.
See the [demo configuration and evidence](https://github.com/input-output-hk/midnight-passport-sdk/blob/passport-acc-prototype/docs/site/names.md#source-preview-midnames-210).

## Private grant sponsorship in the source candidate

On the standalone network, `PASSPORT_HOST_GRANT_ISSUE=1` opts the configured
private host mutation service into sponsoring grant issuance. The host uses
the pinned ACC verifier roster and admits one proved, unbound owner issue call.
It checks the fee-only policy before balancing and verifies the call proof,
commitment, transcripts and asset offers after balancing.

A server-side integration can use `remoteHostMutationPorts(...).grantIssue`
with the existing private RPC token. Send the original issue UUID and intent
digest with the proved bytes. After an uncertain response, reconcile those
same values. The host retains the proved input and exact finalized transaction
in its encrypted journal. The dispatch fence prevents a second submission.
Keep the token and transaction bytes on the server side of the browser trust
boundary.

The local HTTP fixture uses Ledger 9 serialization with a simulated prover,
wallet and indexer. The demo relay, browser screens and live sponsorship
qualification remain open.
