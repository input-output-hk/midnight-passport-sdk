# Public operations, types, and errors

The published account API version is `1.0.0-pre.0`. Import from package root or declared subpaths, never an internal `src` path. The [RC8 API source](https://github.com/input-output-hk/midnight-passport-sdk/blob/sdk-v0.1.0-rc8/docs/site/api.md) has the full signatures; this page is a task map for selecting the right capability.

| Task | Public entry or method | Required host capability |
| --- | --- | --- |
| Construct browser host | `createBrowserPassport` from `adapter-browser` | Binding, checked network, passkey profile, records, prover/sponsor/submitter/deployer/directory |
| Create account | `PassportConnectorAPI.createAccount` | Explicit maintenance-authority choice, credential/key source, deployer, proof and settlement |
| Open account | `openAccount`; optional `openAccountAt` | Enrolled credential, known record or address, live ACC state and envelope |
| Read state/holdings | `PassportAccount.state`, optional `readShieldedHoldings`, `deviceRoster`, `grantRoster` | Indexer/chain and, for private outputs, verified holdings plus reader/viewing secret |
| Withdraw | Optional `withdrawUnshielded`, `withdrawShielded` | Exact consent, authorized signer, value/proof path; shielded exact-value restriction |
| Manage devices and viewing keys | Optional `addDevice`, `removeDevice`, `rotateViewingKey`; `rotateEncryptionKey` | Complete live device/grant roster and verified holdings, fresh owner review and settlement |
| Issue or revoke grant | Optional `issueGrant`, `revokeGrant`, `revokeAllGrants`, `recoverPendingGrants` | Live grant sources, protected opening and durable journal, chain confirmation |
| Inspect binding | `resolveBinding`; `contract/capabilities` | Trusted installed package and compatible runtime |
| Check backend | `fetchCheckedV1Config` | Independent network/binding/manifest/URL pins |
| Fund from trusted backend | `adapter-service/faucet` | Authenticated funding service and durable request ID |

`AccountRecordStore` and `NetworkConfig` come from `account/ports`; `PassportConnectorAPI` and `PassportEvent` come from `protocol`; `PassportConnectorError` comes from `account/errors`. [The maintained example](/getting-started/first-integration) imports these public exports and is compiled by the docs checker.

**Error handling:** catch `PassportConnectorError`, show its stable `code`, and keep the original public operation and transaction references. `UserCancelled` or `Aborted` can stop future local work but cannot undo a submitted transaction. Integrity, network, missing-port, stale-scope, or unknown-submission failures require investigation, not automatic fallback or a new ID. [Troubleshooting](/operations/troubleshooting) starts from symptoms.

| Example code | What to do |
| --- | --- |
| `UnsupportedAuthenticator`, `WrongPasskey` | Check provider capability and the enrolled credential; let the person choose a supported path. |
| `ArtefactIntegrity`, `NetworkMismatch`, `BindingUnsupported` | Stop before key or value work and compare independently trusted pins. |
| `GrantScopeInvalid`, `GrantRevoked`, `GrantRosterUnsettled` | Inspect live grant scope and roster; do not fall back to an owner send. |
| `MutationUnsettled`, `GrantBookkeepingUnsettled` | Preserve original IDs and reconcile before another mutation. |
| `ProverUnavailable`, `SponsorRejected` | Inspect the exact service and policy response; a retry is not automatically safe after an uncertain submission. |

The public `protocol` export `PASSPORT_ERRORS` lists all codes and default retry metadata. A future minor version may add codes; treat an unknown code as `InternalError`.

RC8 adds optional authorization, validation, secret-store, background, naming, and interaction subpaths. They supply contracts or opt-in adapters; they do not install host policy, persistence, or a UI. The [tagged API reference](https://github.com/input-output-hk/midnight-passport-sdk/blob/sdk-v0.1.0-rc8/docs/site/api.md) distinguishes method availability from `0.1.0-rc7`. Check [later source changes](/operations/archive) separately.
