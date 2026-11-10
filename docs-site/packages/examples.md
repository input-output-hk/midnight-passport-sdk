# Examples by integration layer

## Browser account creation and opening

Use the [complete first integration](/getting-started/first-integration) for a compiled RC9 example with persistent public account records, independently pinned service configuration, P-256 browser composition, and explicit create/open actions. It is intentionally limited to that first operation; enabling withdrawals requires additional value and consent ports.

## Existing wallet or Node host

Start with the [account ports](https://github.com/input-output-hk/midnight-passport-sdk/blob/sdk-v0.1.0-rc9/packages/account/src/ports/index.ts) and [library integration guide at the RC9 tag](https://github.com/input-output-hk/midnight-passport-sdk/blob/sdk-v0.1.0-rc9/docs/site/library-guide.md). Implement the signer, chain, proof, settlement, record, and consent owners in your host. The [host guide](/guides/hosts) explains where browser-specific adapters stop.

## Contract-only adoption

Import the versioned binding from `@input-output-hk/mn-passport-contract/bindings/acc-s3r1.1` and pin its manifest independently. The [application-contract → ACC reference](https://github.com/input-output-hk/midnight-passport-sdk/blob/sdk-v0.1.0-rc9/docs/site/partner-integration.md) covers the supported call direction and caller-bound grant checks. It does not establish arbitrary calls from the ACC to another contract. [Artifacts](/operations/artifacts) explains public proof-key distribution.
