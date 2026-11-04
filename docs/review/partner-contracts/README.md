# Review map: reusable application-to-ACC integration

Parent #257; implementation/remaining acceptance #275. Local only, not in RC6.

1. `packages/contract/bin/export-acc-compact.mjs`: pin the compiler manifest before
   parsing its file requirements; check four generated files and all 52circuits;
   no generated import/key generation; exclusive new output and checked compiler
   dependency publication. CLI receipt is identity, not publisher provenance.
2. `tests/contract-compact-export.test.mjs`: unchanged baseline, substituted modules
   and unused verifier/manifest/file-set controls, existing/symlink output refusal.
3. `examples/application-acc/contracts/merchant.compact`: one trusted configured ACC,
   fixed merchant policy and capacity; no arbitrary callee substitution or signing
   secret; nested authorization remains in the ACC. Counter/limit is not generic
   authentication or a fulfillment protocol.
4. `prepare-payment.mjs` and `tests/application-payment.test.mjs`: live scope/object/
   spent/caller checks before signing, explicit review and fresh context, selected
   key check and no submit API. Outer key scope is not a provider prompt count.
5. `qualify-offline.mjs`: real compiled modules and operation keys, actual generated
   ACC/grant signatures and refusal cases. Local candidate state commit is not
   node admission. Output identifies zero proof/node/provider work.
6. `docs/site/partner-integration.md`, compatibility/package/use-case guides and
   `docs/partner-adoption-plan.md`: layered adoption, both call directions,
   authority versus bundle distribution, exact installed versions and unqualified
   native/provider boundaries.

Keep expensive compiler/installed-consumer/native work out of required 30–45s jobs.
Candidate receipts and independent review are recorded after execution; a test
definition is not acceptance evidence. Retain failed fresh consumers. No existing
binding, released tarball, image, native fixture or unknown transaction is replaced.

## Local delivery — 2026-11-04

Signed source `69a2c11b5d754d58bb2499999127344b28a6ee03`; independent Codex CLI review
found no actionable bugs. [Verification](verification.json) records the full local
gate: **1,122 TAP tests passed / seven existing skips / zero failures**, plus the
remaining script/type gates. The 25 added fast cases are included in that total.

[Installed-consumer result](offline-receipt-v4.json): **eight compiled offline cases**
using four candidate packages at `0.1.0-dev.20261103`. [Byte audit](installed-packages-v4.json)
checks all **283 installed package files** against the pinned candidate archives;
no SDK workspace import is used by the example. The copied helper/harness/Compact
source bytes match the signed source; generated merchant module and helper/harness
hashes are in the receipt. Candidate package provenance is not publisher identity.

[Docs check](docs-check.json): 24 pages, 547 local links/anchors, zero errors. This
is local candidate documentation; the published site still reflects the merged
safety source until this tranche is reviewed/pushed/merged. No release was made.

The first two retained independent consumers failed on fixture state wrapping and
grant-issue challenge shape, then were corrected in fresh roots. No failure was
rewritten to a pass. Source-native proof/node and merchant wallet credit remain
pending under #275; at that run disk was below the existing 15 GiB guard. Existing
keys, unknown transactions, historical fixtures and unrelated stacks were preserved.

## Native preparation and resource boundary

Capacity has been restored. See the [native preparation and restart incident](native-preparation.md)
for the caller-only keys, worker review corrections, installed declaration check and
two honestly failed attempts before wallet startup. Native acceptance remains pending;
the archived indexer must not silently substitute for the owned canonical endpoint.
