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

The [native observation incident](native-observation-incident.md) records an actual
successful composed payment and read-only wallet-credit recovery at signed source
`23b1d73`. The original full suite remains failed; remaining negative-case acceptance
and the distinct continuation must be recorded after execution.


## Native local acceptance — 2026-11-05

[Acceptance receipt](native-acceptance.json), [installed byte audit](native-installed-packages.json)
and [reused proving assets](native-artifacts.json) record reviewed signed source
`eb240f6203b8a089e989397d6ae9e1e6a51f3516`. The full local gate passed **1,220 tests**,
seven existing skips and zero failures; isolated Codex CLI review found no
remaining actionable regression and **52 focused cases** passed.

All eight cases in the native lane completed. The positive payment used actual proofs,
node admission, canonical finality and a distinct merchant wallet credit of **4 base**
units. The existing ACC changed **8→4** and new merchant payments **0→1**. Six transactions
were retained before sending and independently finalized; six fulfilled `proveTx`
requests do not count individual root/callee circuit proofs. All seven negative
cases refused at build, before proving/submission; full ACC and both merchant
state hashes remained unchanged. There was no malicious bypass submission or
node rejection/rollback qualification.

The [original incident](native-observation-incident.md) remains a failed full
suite at `23b1d73` with a separately successful original payment/credit. The passing
continuation checks all **16 original** canonical outcomes before a **separate** intent
using new merchant/grantee/recipient/grant. No original payment/deposit was retried.
The new live recipient view passed directly; automatic reconnect sequencing has
unit coverage, while actual cold credit recovery has its separate read-only run.

End source identity and all **21,877 pinned** inputs match. Both wallets stopped,
all **3 owned** containers stopped, the stable lease was released and the archived
indexer’s initial running state/image/mounts were restored. All chain/key volumes,
original failed fixtures, serialized transactions and earlier unknowns remain.
No ACC key regeneration, upstream binding upgrade, registry release, image/Pages
publication, real-provider/full-Lace or partial-shielded claim is made.
