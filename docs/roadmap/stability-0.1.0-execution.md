# Approved stability execution plan — 2026/11/02

Parent [#257](https://github.com/input-output-hk/midnight-passport-sdk/issues/257).
Baseline nine SDK0.1.0-rc6 packages, three backend images, immutable bindingacc-s3r1.1.
Stable0.1.0 is a supported-subset goal, not a full Passport/Lace promise. Breaking API/binding
changes require an explicit0.2.0 version decision. No new release is implied by these receipts.

## Delivery sequence

1. Consolidate completed local native/real-handler work: [PR259](https://github.com/input-output-hk/midnight-passport-sdk/pull/259), exact-head CI/review/signatures, merge into prototype and deploy matching Pages. Preserve native measured source, do not relabel docs head as rerun.
2. [#258](https://github.com/input-output-hk/midnight-passport-sdk/issues/258): real browser popup/channel/close boundaries with virtual credentials; separate fake-chain browser protocol from native/provider tiers.
3. [#245](https://github.com/input-output-hk/midnight-passport-sdk/issues/245)/[#246](https://github.com/input-output-hk/midnight-passport-sdk/issues/246): versioned prompt inventory/budgets, scoped sessions, typed consent and clear demo explanations, [#238](https://github.com/input-output-hk/midnight-passport-sdk/issues/238) recipes.
4. [#234](https://github.com/input-output-hk/midnight-passport-sdk/issues/234)/[#235](https://github.com/input-output-hk/midnight-passport-sdk/issues/235)/[#236](https://github.com/input-output-hk/midnight-passport-sdk/issues/236): targeted operator/key/release acceptance. [Independent quality work](../review/code-quality/README.md) runs alongside this sequence; correctness/integrity/install blockers first.
5. [#231](https://github.com/input-output-hk/midnight-passport-sdk/issues/231): three consecutive clean declared-suite runs; separately [#232](https://github.com/input-output-hk/midnight-passport-sdk/issues/232) real Google/iCloud/two-browser/restoration acceptance. Record unavailable combinations as untested/refused.
6. Next preview RC only after its checks. Stable0.1.0 only after supported acceptance and issue reconciliation [#227](https://github.com/input-output-hk/midnight-passport-sdk/issues/227)/capability contract [#237](https://github.com/input-output-hk/midnight-passport-sdk/issues/237).

## Quality, evidence and scope

Independent audit [#262](https://github.com/input-output-hk/midnight-passport-sdk/issues/262):
HTTP process survival#260, original deposit retry#261, early bootstrap validation#263,
incremental connector lifecycle extraction#264, bounded polling#234. Avoid broad rewrites;
all refactors preserve cryptographic bytes, circuit order, public errors, consent and original
unknown identifiers. Prefer coherent5k–10k authored PRs where warranted, never pad diffs.

Keep substantive required jobs near30–45seconds. Verified warm caches may include public compiled
artifacts/keys, never private journals/witnesses/tokens. Large installs/native/image/browser/provider
qualification stays manual/scheduled. Retain failed fixture roots and controlled state volumes;
cleanup exact owned processes only. GPG/DCO and independent review before eligible merges.

0.2.0 retains full circuit coverage#82, partial shielded change#201, total-loss recovery#240,
discovery/naming#20/#247, browser proving#241, dApp/agent grants#242 and network value routes#243.
Authorising-only enrollment delivers no reader/viewing secret. Exact-value withdrawals and
unsupported hosted consent refusals remain unchanged.
