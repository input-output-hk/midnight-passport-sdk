---
pageClass: comparison-page
---

# Passport architecture conformance

This 12 November 2026 review compares SDK source through `254059e` with the
Passport v1.0 architecture at `e0e4e0e`. The asset custody, signing and dApp
connection rows include later isolated-chain evidence at SDK source `d60eb4c`. The [promise catalogue](https://github.com/midnightntwrk/passport/blob/e0e4e0e6272399d71dfaaa7cae0689ab4e2363f3/docs/plans/PROMISES.md)
defines the invariants. The [component inventory](https://github.com/midnightntwrk/passport/blob/e0e4e0e6272399d71dfaaa7cae0689ab4e2363f3/docs/plans/components/README.md)
defines the product boundaries. The [RC9 release record](/operations/rc9-preview)
identifies published behavior. The rows below also include merged source and local
candidate work, with the evidence described for each capability.

## Component responsibilities

| Component | SDK evidence | Host or upstream responsibility and adoption gate |
| --- | --- | --- |
| C1 · Account custody | The `acc-s3r1.1` binding and [lifecycle API](/guides/account-lifecycle) cover deployment, activation and supported operations. MIP-0012/0013 are Proposed at the [reviewed pins](/architecture/standards). | The host supplies credential, proof, fee and settlement ports. Verify the deployed verifier roster and account readiness. [#23](https://github.com/input-output-hk/midnight-passport-sdk/issues/23) needs a bootstrap and maintenance-authority design before predeployment. |
| C2 · Name service | The [Midnames demo](/guides/hosts#midnames-source-preview) uses a checked resolver, a standalone paid claim and two named value flows. Isolated native tests also opened the resolved ACC with its enrolled P-256 or JubJub credential. MIP-0007 is Proposed. | The registry operator supplies the online profile and intended namespace. Verify name-owner continuity after ACC recovery independently of resolution. [#247](https://github.com/input-output-hk/midnight-passport-sdk/issues/247) |
| C3 · DID | DID creation and resolution are outside the SDK. The upstream design is a workstream. | A DID implementer must choose a method and publish lifecycle, resolution and interoperability tests. |
| C4 · Asset custody | The standard shielded withdrawal requires an exact-value coin. The [opt-in partial owner flow](/guides/assets#opt-in-partial-owner-withdrawal) proved original withdrawal, change append recovery and spent-input exclusion for both owner schemes on an isolated chain. | A host supplies the pinned value wallet, finality source and protected journals. Qualify the deployed network and wallet profile before enabling partial spends. [#201](https://github.com/input-output-hk/midnight-passport-sdk/issues/201) |
| C5 · Signing | The SDK exposes [P-256 and PRF-derived JubJub](/architecture/keys-wallets) paths for supported circuits. The [P-256 grantee spend](/guides/devices-grants#p-256-grantee-withdrawals-in-the-sdk-source) passed on an isolated chain with distinct software owner and grantee credentials. MIP-0030 is Draft. | Partner signer providers must prove exact codec, policy and circuit compatibility. Explicitly qualify k256 and unsupported circuit families before broadening claims. [#82](https://github.com/input-output-hk/midnight-passport-sdk/issues/82) |
| C6 · Proof generation | Chromium signed and proved one live JubJub inbox append, proved its DUST fee, and bound and merged the transactions. In a separate isolated run, a browser wallet worker selected and proved the fee and submitted once. After acknowledgement loss and a SIGKILL, the SDK recovered the original identity when Chromium restarted with the same profile. A read-only observer verified canonical settlement using the host’s retained copy. A separate live test cancelled an active proof and settled the same call using a fresh worker. [Qualification details](/operations/services#browser-local-proving-qualification) | Qualify production wallet custody, browser-managed storage eviction, recovery through an independent receipt store, production artifact delivery, additional circuits, timing, memory, wider cancellation cases and supported browsers. [#241](https://github.com/input-output-hk/midnight-passport-sdk/issues/241) |
| C7 · Witness handling | The SDK routes witnesses through configured proving ports. The Midnames browser claim has an isolated owner-prover receipt. | The host defines witness custody and what leaves the browser. Capture outbound requests and inspect logs before claiming a privacy boundary. |
| C8 · Domain separation | [Pinned key recipes](/architecture/keys-wallets) and binding-specific encodings have distinct purposes. MIP-0021 is Proposed. | Binding and signer maintainers must compare exact prefixes, encodings and known-answer vectors before adopting a new recipe. |
| C9 · Device authentication | WebAuthn supports the pinned signing and PRF profiles. The [consent guide](/guides/authorization) describes login and operation review. | The host owns RP policy, consent, lifetime and provider choice. Exercise real providers, multiple profiles and restored credentials. |
| C10 · Scoped grant | [Grant APIs](/guides/devices-grants) compose supported recipient, asset, caller, expiry and cap constraints. MIP-0033 is Draft. | The host reviews the requested scope. A partner must show that out-of-scope calls fail and allowed calls settle under the exact selected profile. |
| C11 · Grant lifecycle | Issuance, expiry checks, revocation and original-request recovery are available for supported paths. Local agent issuance supports both owner schemes. | The host owns opening custody and durable journals. Qualify issued, interrupted, revoked and expired outcomes against the original grant ID and current state. [#242](https://github.com/input-output-hk/midnight-passport-sdk/issues/242) |
| C12 · Chain enforcement | The pinned binding enforces its grant scope. A merchant-to-ACC test has proof-backed evidence on its recorded installed candidate. | The application contract must enforce its own claim policy. Verify the immediate caller, exact payout, cap and atomic refusal on the selected artifacts. [#275](https://github.com/input-output-hk/midnight-passport-sdk/issues/275) |
| C13 · Lost-device continuation | Enrolled survivors can remove a live device and rotate viewing material with complete sources. | The host must prove survivor and grantee continuity and reject the removed authority. Individual entry removal has a different scope from atomic retirement during recovery. |
| C14 · Total-loss recovery | [Recovery admission](/guides/account-lifecycle#inspect-recovery-state-in-a-source-build) checks finalized state and verifier pins. The corrected candidate has isolated native successor-restart evidence. MIP-0022 is Proposed. | The binding owner must approve adoption and migration. Qualify both owner schemes and dormant accounts under the selected binding. The released binding is refused by the recovery preflight. [#228](https://github.com/input-output-hk/midnight-passport-sdk/issues/228) · [#240](https://github.com/input-output-hk/midnight-passport-sdk/issues/240) |
| C15 · Helper protocol | The recovery collector validates attempt-bound responses from authenticated guardian ports. The isolated fixture used separate loopback mTLS guardian processes. | Guardian transport operators own recognition, availability and privacy. Verify interoperability, threshold, missing peers, corrupt shares, cancellation and successor custody in the chosen profile. |
| C16 · Local storage | [Secret and journal ports](/guides/durability) support host-managed custody and compare-and-swap. | The host chooses encryption, retention and access controls. Test hard-kill recovery and failure of shared durable storage before making persistence claims. |
| C17 · View-key sync | [Holding readers](/guides/assets) match decrypted descriptions to chain events. The source checkpoint worker authenticates complete ledger snapshots. | The indexer and host must demonstrate freshness, interruption recovery and restored view generations. Interoperable WPP sync remains a product boundary. |
| C18 · Attestation tree | Credential trees are outside the SDK. | A credential provider must select and verify the tree, anchoring and update profile. |
| C19 · Credential issuance | The SDK exposes account and grant operations. | An issuer must supply attribute verification, issuance and interoperability evidence. |
| C20 · Selective disclosure | The ACC proof path verifies custody operations. | A credential implementer must verify the disclosure statement and public inputs for its chosen credential profile. |
| C21 · Credential nullifiers | Coin nullifiers belong to shielded asset accounting. | A credential implementer must test domain separation, replay rejection and unlinkability for the credential nullifier. |
| C22 · Intents | Typed account calls and original-intent journals cover bounded operations. | A general intent or solver integration needs a versioned wire profile, explicit consent and end-to-end settlement tests. |
| C23 · dApp connection | The opt-in browser flow proved issuance, original recovery and live holder callback and export across two HTTPS origins on an isolated chain. A direct non-browser JubJub request path is also available in source. | Partner integration needs provider and redirect interoperability, authorization scope checks and installed-consumer qualification. General CAIP-25/EIP-6963 discovery remains open. [#242](https://github.com/input-output-hk/midnight-passport-sdk/issues/242) |
| C24 · Fees | The [service roles](/operations/services) distinguish DUST sponsorship and wallet-funded deposits. The [read-only hosted preflight](/operations/quality#hosted-network-preflight) checks endpoint agreement and can check an ACC's binding at the same finalized block. | Sponsor operators qualify ingress, funds, fees and durable reservations. The Preview smoke check establishes endpoint agreement. Hosted value routes need their own receipts. [#243](https://github.com/input-output-hk/midnight-passport-sdk/issues/243) |
| C25 · Cross-chain integration | The current value routes use Midnight-native assets. The upstream component is a placeholder owned outside Passport. | Solver, bridge and external vault operators must first define their custody and settlement contracts. Signing support alone supplies no cross-chain settlement evidence. |
| C26 · Agent skills | Repository runbooks describe engineering and qualification workflows. | Product and agent hosts own end-user guidance and delegated tool policy. Verify that the agent requests bounded authority and handles expiry, revocation and original receipts. |

## Promise adoption gates

| Promise | Source evidence | Remaining check |
| --- | --- | --- |
| P1 · Seedless lifecycle | Passkey-backed ACC creation and reopening on the pinned binding. | Test interrupted creation with original IDs and supported provider restoration. Ordinary HD wallet recovery depends on its own seed derivation and credential continuity. |
| P2 · Naming | Standalone Midnames lookup, claim, and payment through the configured registry. | Verify an independently pinned online registry and namespace. Verify recovered authority can still administer the name. |
| P3 · Peer devices | Enrolled peers, viewing envelopes and selected restart flows. | Verify two real browser profiles, holding agreement and complete viewing-key sync. |
| P4 · Revoke and continue | Supported removal, viewing rotation and grant revocation. | Confirm the removed route fails while survivors retain access to the expected holdings and grants. |
| P5 · Recover from zero | Corrected native candidate recovered an ACC and spent an original shielded coin after successor restart. | Adopt and qualify the binding and deployment or migration plan. Verify real guardian and successor custody, assets, and name continuity. |
| P5′ · Recovery authorisation | Recovery admission checks pinned state, guardian replies and successor viewing custody. | Prove stale or invalid authorisation fails, and verify veto, uncancelled finalisation and successor-only authority on the adopted binding. |
| P6 · Key-bound use | WebAuthn and purpose-separated PRF-derived keys on supported paths. | Audit key lifetime, cross-context isolation and provider behavior in the actual host. |
| P7 · Scoped grants | Bounded browser, agent and owner/grantee paths plus selected native receipts. | Run interoperable issue, use, expiry and revoke scenarios with the adopted profiles and installed consumers. |
| P8 · No required operator | Injectable proving, fee, indexer and guardian ports. | Replace one operator at a time and recover original pending operations without relying on a specific operator's private state. |
| P9 · Attribute privacy | Credential issuance and selective disclosure are outside current SDK scope. | Require a separately qualified credential, disclosure and nullifier design. |
| P10 · Chain abstraction | Midnight-native ACC and caller-bound grant routes. | Require upstream interface, vault and bridge acceptance before testing cross-chain settlement. |
| P11 · Transaction safety | Pinned authorization, consent and retained dispatch across supported routes. | Test stale nonce, expiry, revocation, invalid signatures and ambiguous submit across each adopted circuit and provider. |
| P12 · Value integrity | Verified holdings, partial-success event accounting and source-only staged change recovery. | Match pre/post values and committed effects on the canonical chain under same-block competition, indexer lag and restart. |
| P13 · Funds availability | Exact-value spends and isolated native corrected recovery. | Qualify fee discovery, alternate operators, recovery of held assets and authenticated change backfill. |
| P14 · Private proving | The browser generated and retained the JubJub signing key and unproven ACC call for one isolated inbox append. The browser worker selected the DUST spend, assembled the final bytes and submitted to the isolated node. | Qualify real credential profiles and browser wallet fee custody. For each profile, define a fixed, exhaustive leakage budget for inputs, witnesses and metadata. Show that combined prover, chain, guardian, network, transport and log observations follow from that budget. Reject unrelated identifiers and linkage. |
| P15 · Guardian privacy | The source accepts authenticated guardian transport through a narrow port. | Publish the chosen transport and observer leakage profile. Verify chain data, logs and messages against it. |
| P16 · Upgrade safety | Binding and artifact checks identify the source candidate and preserve version boundaries. | Prove the account authorises the upgrade. Verify that the same devices can operate, holdings reconcile with fees attributed, and identity questions retain the same answers in the same ledger and credential context, including supported name observations. Check the adopted ABI, keys and migration. |

## 0.2.0 scope

The merged [Midnames stack](https://github.com/input-output-hk/midnight-passport-sdk/pull/325)
covers standalone resolution, claim preparation and reconciliation, shielded
deposit by name and the two-leg NIGHT payment. Both named value flows were
rerun against the merged source on isolated chains. The later local browser
claim used a Chromium virtual passkey and a loopback prover. It recovered a
paid original after a dropped acknowledgement and restart. This establishes
standalone behavior for those profiles. Online names, `passport.night`
issuance and recovered name ownership need separate evidence.

The [recovery admission change](https://github.com/input-output-hk/midnight-passport-sdk/pull/326)
landed in prototype source. Its isolated proof run used a corrected artifact
outside the released binding. The standard shielded withdrawal remains
exact-value. The opt-in #201 path requires a separately qualified host.
[Unknown-address discovery](https://github.com/input-output-hk/midnight-passport-sdk/issues/20)
still needs a linkability policy and authenticated update design.

## Cryptographic integration gates

The [binding decision](https://github.com/input-output-hk/midnight-passport-sdk/blob/passport-acc-prototype/docs/adr/0012-retain-binding-with-explicit-removal-and-recovery-limits.md)
pins ACC source `6458ed5`, Compact `0.35.0`, runtime `0.20.0` and the full
compiler manifest. Match the generated ABI and each circuit's verifier hash
to that manifest. A compatible TypeScript declaration is only one check.

| Candidate | Comparison with the current binding | Evidence needed for adoption |
| --- | --- | --- |
| Alternate signing arms | The [EVM](https://github.com/midnightntwrk/passport/pull/188) and [Solana](https://github.com/midnightntwrk/passport/pull/189) experiments introduce new authorisation surfaces. | Pin the source commit, signature codec, generator or verification policy, challenge/domain bytes and generated circuit ABI. Run valid and invalid signatures with the new verifier roster. |
| Quorum reader envelopes | The [quorum envelope plan](https://github.com/midnightntwrk/passport/blob/fc19e471536febb2133f20e817847251622dcdf5/docs/plans/viewing-key-sharing.md) proposes an offline guardian refresh profile. Current recovery qualification uses its own pinned wrap and successor viewing-key checks. | Select the generation, wrap and recipient encoding, then qualify refresh, mixed generations, stale envelopes and successful post-restart holdings access. |
| Domain separation | Existing PRF recipes and ACC challenge encodings have specific byte representations. | Compare exact labels, normalization, serialized inputs and outputs against known-answer vectors before selecting a new MIP-0021 profile. |
| Compiler or prover change | Key restoration verifies ZKIR and output hashes against the [pinned toolchain](/operations/artifacts). | Record exact compiler, proof runtime and source versions, compare circuit ABI and key hashes, then prove and settle each adopted circuit. Decide the new binding and migration policy if any verifier changes. |

The [upstream SDK comparison](/architecture/upstream-sdk) records the release-era
package differences. The [qualification guide](/operations/quality) describes
the evidence available for the source candidate.
