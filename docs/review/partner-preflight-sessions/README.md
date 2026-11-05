# Expanded partner preflight and approved journal sessions

Local candidate following the earlier [capability tranche](../partner-capabilities/README.md),
contributing to #237/#238 and the bounded #245 journal-session follow-up.
PR276/277 merged into `passport-acc-prototype` at `b61891b`. This work remains on
`codex/rc5-publication-record`; no new PR/publish/release or immutable binding change.

Implementation `492b9d3`, integrated history `f8f1a69`, both GPG/DCO/Assisted signed.
The merge has no content difference from the authored implementation. The complete
future PR also includes the earlier generated catalog/preflight tranche. Most of
its line count is generated inventory; review the generator and authored logic first.

## What changed and why

- `account/preflight`: exact proof/helper requirement sets for four existing sealed
  owner flows, both arms, and safe inspected owner scheme. Materialized helper
  omissions refuse without calls; lazy loaders remain deferred. Read issue includes
  append/rotation; recovery plans publication, never another issue.
- `contract/capabilities`: generic advertised proof-profile inspection. It checks
  binding/manifest identity and requested prover/verifier names, not merely profile
  labels or health. Unknown/duplicate/sparse/accessor lists refuse. No key bytes are
  downloaded or verified by this metadata inspection.
- Typed host example plus bounded metadata CLI: two GETs, shared five-second timeout,
  per-body256KiB bound, no redirects/URL credentials/query/fragments. It never opens
  credentials, downloads provers or starts a wallet. Exit0 establishes advertised
  requested coverage only. The actual reduced profile lacks owner withdrawal
  provers despite carrying all verifiers.
- Strict approved deposit example captures the same protected source for journal
  construction and complete per-invocation sessions. It is a host composition,
  not consent or a new SDK authorization API. Independent wallet approval, bounded
  I/O and separate/unrelated operation isolation remain host responsibilities.
- Shared software-authenticator fixture replaces copied setup. Real adapter/journal
  tests cover baseline10 versus wrapped1 PRF assertions, create-held0, later
  independent1, callback/unknown outcomes and PRF cancellation/wrong key/no PRF.
  Derived journal-key buffers are zeroed. Original unknown fences are not replayed.

## Evidence

[Verification](verification.json) binds source and limits; [installed candidate](installed-candidate.json)
and [documentation](docs-check.json) retain redacted measurements.

- Full local gate:1163passed,7existing skips,0fail; lint/format/build/app types pass.
- Focused suite62passed, including actual key-service HTTP router metadata and CLI
  refusals. The key router uses fixture files/prover metadata: no restoration,
  key-byte integrity or proving readiness is qualified by those HTTP cases.
- Fast CI compiles both TypeScript examples against declared public export paths
  and executes emitted code. Its local resolver is not installed-package provenance.
  No package install, large key generation or native proof is added to required CI.
- A fresh external consumer installs all9local tarballs as
  `0.1.0-dev.20261104.partner.1`, replaying a frozen lock offline with install hooks
  disabled. All555installed files match before and after execution. Strict public
  imports compile; emitted journal and getter-refusal examples execute. All9session
  tests pass against actual installed SDK modules. The metadata CLI uses actual
  installed exports with Compact imports forbidden, against full/reduced router
  metadata fixtures. Source/private smoke and final accepted consumer roots remain
  distinct; no registry release or provider/native result is inferred.
- Local Jekyll4.4.1 build:25pages/625links and anchors clean, static/package JSON match.
- Whole-tranche independent Codex CLI review uses a clean detached source with
  locked dependencies/fresh outputs. Final review at `f8f1a69` found no actionable
  bugs relative to `b61891b`. Raw logs remain private/ignored.

## Reproduce the fast checks

```sh
nix develop -c pnpm run build
nix develop -c node --test tests/account-proof-requirements.test.mjs tests/contract-proof-profile.test.mjs tests/partner-recipes.test.mjs tests/shielded-deposit-session.test.mjs tests/adapter-browser-webauthn.test.mjs
```

The examples' READMEs document real consumer commands and host prerequisites.
The [capability guide](../../site/capabilities.md) and
[recovery guide](../../site/shielded-deposit-recovery.md) describe scope/lifetime.
Root tests clean only their generated synthetic state and HTTP servers. Retain
real failed/unknown intents, protected journals/key origin and sender records.

## Remaining boundaries

#237/#238/#245 remain open for wider operation negotiation, full recipes/provider
qualification and general consent/session isolation. PR276/277 acceptance is unchanged.
The #275 live merchant goal remains owner-deferred: archived indexer retained;
no automatic stop, substituted endpoint or prepared native-run launch. No native
proof/admission/merchant-credit claim follows. Keep exact-value shielded withdrawals,
experimental k256, immutable binding/recovery/removal limits and original authority
boundaries. Default or dedicated fee sponsorship never supplies deposit assets.
No Docker resource, original unknown, key cache or unrelated worktree was removed.
