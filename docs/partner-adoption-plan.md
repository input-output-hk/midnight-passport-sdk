# Reusable Passport packages: partner adoption plan

Owner-approved direction, 2026-11-03. Parent [#257](https://github.com/input-output-hk/midnight-passport-sdk/issues/257).
The first implementation slice is [#275](https://github.com/input-output-hk/midnight-passport-sdk/issues/275).

## Product outcome

Lace Platform and other partners can install versioned Passport account packages,
verify an explicitly supported ACC build and proving assets, and compose the
supported operations with their own application, wallet and infrastructure.
Contract/assets consumption is useful independently of adopting our account engine.
Upstream Passport contracts and semantics remain the source of truth.

The host owns UI, consent policy, trusted application registration and key/session
ownership. Portable packages must not depend on Lace-private types or orchestration.
Keep the nine implemented package boundaries; a new use case does not require a new
npm package by default.

## Ordered backlog

| Order | Outcome | Tracking and remaining boundary |
| --- | --- | --- |
| 0 | Land the already reviewed safety/qualification tranche | PR #268 and PR #270 merged. PR #270 signed merge 64d324e follows owner-authorized Codex CLI fallback review, 13 green hosted checks and the full local gate; Pages succeeded. Bounded issues #258/#261/#266 closed with follow-ups retained. |
| 1 | Application contract calls an existing user's ACC using our package | #275: verified compiler dependency export, useful fixed-price merchant example, real compiled execution and installed-package acceptance. Native proof/admission remains a separate required evidence tier. |
| 2 | Integrators know exactly which layers and operations they can adopt | #237/#238/#81: generated circuit inventory versus typed/host/proof/browser/provider support, executable recipes, pinned installed consumers. Additional account builds need their own decoder/assets/compatibility policy. |
| 3 | Consent and recovery remain understandable and safe | #245/#246: operation-scoped sessions and explicit prompts; #230/#239/#269: retained original intent, grant openings and safe uncertain-send/backup handling. #274 read retry is optional resilience. |
| 4 | Partner environments are repeatably operable | #234/#235/#236/#231: key/service profiles, resource and failure controls, registry permissions, images, clean installed-consumer runs and declared release gates. |
| 5 | Real provider and broader capabilities are independently qualified | #232 for actual provider/two-browser acceptance. #82 full circuit coverage, #201 partial shielded change, #240 total-loss recovery, #242 connection protocol and #243 additional networks remain separate scopes. |

An open historical implementation issue is not evidence that its entire feature is
missing. Reconcile its acceptance against source and immutable receipts before
closing it. A documented limitation may permit narrower package reuse; it must not
be presented as a qualified broader capability.

## First slice: application → ACC

The partner application calls a supported operation on the deployed ACC. The
application owns its business conditions; the ACC owns custody and enforces the
owner/grantee signature, freshness and scope. An immediate contract-caller pin
supplements those checks. It identifies neither a browser origin nor a particular
calling circuit. Review the application's claim policy and maintenance authority.

The reference merchant configures one verified ACC, an asset, a positive price,
payment capacity and its decoded `UserAddress`. `pay` calls the ACC's JubJub grant withdrawal and increments an
application payment counter. Its counted amount and recipient come from its
constructor state, not caller-supplied alternatives. The configured ACC cannot be
replaced by an arbitrary implementation through a call argument. The ACC remains a separate
contract. This is a payment counter, not a general order, asset-delivery or account
authentication protocol.

The installed contract package should export the verified ACC compiler dependency
without requiring a copied reference-source checkout. The application declares an
ACC interface; its client/prover resolves the matching generated module and assets.
Copying ACC ledger definitions into a different contract does not share an existing
user's ACC state. Possessing proving keys does not confer spending authority.

ACC → application is an optional second composition pattern, used by Lace's custom
account-bundle extensions. It may require additional account circuits, keys, consent
and a deployment/maintenance decision. It is not required for basic package reuse.

### Acceptance tiers

1. Fast tests verify export integrity, path/output refusal and portable helper
   behavior. They do not run expensive compilation in required PR jobs.
2. Opt-in compilation/installed-package execution uses Compact 0.35.0 and runtime 0.20.0,
   real generated modules and software signatures. Record these as offline results.
3. Native qualification proves/submits the declared operation and checks state,
   wrong caller, invalid signature, replay, revocation, expiry, parameter changes
   and application failure. Compile or simulation success never satisfies this tier.
4. Browser/provider acceptance is separate. A disclosed-argument forwarding example
   must not be advertised as a privacy-preserving production integration.

No new release is authorized by this execution slice. Preserve `acc-s3r1.1`, the
exact-value shielded withdrawal guard, legacy revocation/recovery limitations,
original unknown IDs and failed fixtures. Do not reset chains to obtain a pass.

## Source basis

- [Upstream caller-bound grant implementation](https://github.com/midnightntwrk/passport/blob/fc19e471536febb2133f20e817847251622dcdf5/contract/GRANTS-CALLER.md)
- [Upstream application→ACC forwarding probe](https://github.com/midnightntwrk/passport/blob/fc19e471536febb2133f20e817847251622dcdf5/contract/contracts/probe-grant-caller.compact)
- [Lace account-bundle design](https://github.com/input-output-hk/lace-platform/pull/3018)
- [Retained binding decision](adr/0012-retain-binding-with-explicit-removal-and-recovery-limits.md)

Public engineering instructions belong in this repository. The Midnight Obsidian
milestone checkpoint retains decisions, redacted receipts and explicit next steps.

## Next local slice: capability/configuration contract (#237/#238)

The next independent local tranche generates one machine-readable inventory from
all 52 proof circuits and 66 pure helpers, pins the unchanged binding, and exports
it through the contract package without loading the generated ACC. A separate
account subpath inspects four existing sealed-owner configurations before ceremonies:
unshielded/shielded withdrawals, grant issue and pending publication recovery, on
both P-256 and JubJub. It never calls ports/loaders or claims live readiness.

Acceptance: drift-checked package/static JSON and typed data, explicit artifact vs
flow/evidence labels, actionable missing member paths, no implicit read-grant or
k256 fallback, exact-value shielded limits, strict external-package example,
full local gate and independent review. No new package or private host import.
This is a bounded contribution to #237/#238, not closure of their wider provider,
complete operation negotiation and reproducible native recipe requirements.
The #275 native goal remains blocked per owner resource decision. Keep PR276/277
heads frozen for review; continue this slice locally on the existing primary branch.
