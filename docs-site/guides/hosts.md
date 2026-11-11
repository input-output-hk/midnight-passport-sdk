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
The shielded deposit and two-leg NIGHT payment have standalone Node fixtures.
Browser-initiated registration and online profiles require separate qualification.
See the [demo configuration and evidence](https://github.com/input-output-hk/midnight-passport-sdk/blob/passport-acc-prototype/docs/site/names.md#source-preview-midnames-210).
