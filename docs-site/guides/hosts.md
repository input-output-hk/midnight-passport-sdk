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
commitment, transcripts, original intent segments and expiry after balancing.
Additional intents may contain only Dust spends for fees. The sponsor caps
the fee intent at 45 seconds and retains the original owner intent expiry.

A server-side integration can use `remoteHostMutationPorts(...).grantIssue`
with the existing private RPC token. Send the original issue UUID and intent
digest with the proved bytes. After an uncertain response, reconcile those
same values. The host retains the proved input and exact finalized transaction
in its encrypted journal. The dispatch fence prevents a second submission.
Keep the token and transaction bytes on the server side of the browser trust
boundary.

Set `grantIssueSponsor` on `createMidnightChain` to build and prove the
owner call before handing its unbound bytes to the configured sponsor port.
The SDK checks the entire proof-erased transaction. Ledger 9 can insert and
meter no-ops when proving a call, so the SDK replays that transformation
before comparing the bytes. It preserves the issue UUID, digest and signed
request deadline.
The adapter and host both check that deadline before starting their next
submission step.

The standalone native qualification used a software P-256 owner and a
distinct P-256 grantee. The sponsor paid DUST, the original grant finalized,
and the client recovered it after a simulated response loss without signing
or submitting again. Chromium separately checked manifest-pinned verifier
fetching and forwarding with a simulated prover and sponsor. Native proving through the authenticated relay and testing with real passkey
providers remain open.

### Authenticated browser grant relay

The standalone service can mount the source-preview relay described in the
[reference app configuration](https://github.com/input-output-hk/midnight-passport-sdk/blob/passport-acc-prototype/apps/README.md#source-preview-browser-grant-relay).
The browser exchanges an owner assertion for a five-minute account-bound
session. The relay independently verifies the holder's signed request and
retains the first issue UUID and dispatch digest. A repeated execute cannot
replace the proved transaction. Explicit reconciliation can continue only
the retained original and rechecks owner access before any send.

The relay authenticates the active owner and limits the sponsor to fees for
the pinned issue circuit. The holder uses the original signed request and
live ACC state to verify the opening's scope. The proved transaction alone
does not disclose the private scope to the relay.

The demo's Chromium fixture uses separate HTTPS origins and virtual P-256
credentials for the holder request and issuer relay session. It simulates a
lost response after sponsor acceptance and confirms recovery of the original
receipt with one dispatch. The fixture uses a simulated sponsor. The issuer and
holder pages still need to be connected to these flows.
