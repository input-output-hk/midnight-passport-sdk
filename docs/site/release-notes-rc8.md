---
layout: default
title: Preview RC8 candidate
permalink: /release-notes-rc8/
---

## 0.1.0-rc8 — partner-ready preview candidate

**Preparation status: not published.** Published RC7 remains the installation
baseline until the signed RC8 release and its verification receipt exist. This
page defines the next candidate's scope; it does not announce registry, image or
Pages publication. Use the [library guide]({{ '/library-guide/' | relative_url }})
for reusable APIs and the [demo guide]({{ '/demo-guide/' | relative_url }}) for
reference application wiring.

## Included increment

The package set remains nine, with matching versions. The contract binding stays
`acc-s3r1.1`, Passport `6458ed5`, Compact 0.35.0 and runtime 0.20.0. No new contract
build or empty UI/framework package is introduced.

- **Credential and consent boundaries:** optional combined login obtains the
  selected credential and both unchanged Lace PRF outputs in one assertion.
  This does not guarantee one provider dialog/touch. Fresh credential-pinned
  approval remains required for critical owner actions. The exact reviewed account,
  network, binding, credential, intent and lease are checked around asynchronous work.
- **Reusable integration seams:** checked/branded input admission, explicit
  authorisation routing, optional secret-store custody and bounded background-task
  ports. Use canonical `account/authorisation`; the earlier `account/authorization`
  spelling remains an identical compatibility alias. Both are absent from RC7.
- **Routine versus owner authority:** an explicitly reviewed routine lease retains
  derived reader/wallet material, not an owner scalar or raw PRF. Login does not
  enroll/unlock a full owner, connect a wallet or issue a grant. Separate full-owner
  unlock defaults to ten minutes and discloses copied-key risk. The demo's duration
  control is shared with routine access; scoped transfer-grant expiry is independent.
- **Bounded transfer sessions:** separately approved PRF-derived JubJub children
  can execute matching capped unshielded transfers without another credential call.
  Asset, recipient, per-transfer/total caps and chain expiry remain fixed. A local
  lock is not revocation; unknown outcomes retain original IDs without owner fallback.
- **Input and recovery ownership:** admitted DTOs and bytes are copied before
  awaits; Buffer inputs cannot share cleanup-sensitive storage. Durable owner/job
  continuations retain original intent, pins and receipts. Explicit HTTP deadlines
  bound whole observations; mutation POSTs are not automatically replayed.
- **Reference demo:** sign-up/log-in landing, consistent nested navigation,
  Activity progress/results and separate ACC, built-in wallet and external Lace
  Wallet concerns. The built-in wallet runs in an owned worker; NIGHT and DUST
  have independent freshness/error states. Core packages start no worker or UI.
- **Delivery quality:** 80% all-source/per-package coverage admission, static
  budgets, strict executable docs, actual installed-export checks, complete both-arm
  synthetic browser inventory and image filesystem admission. Handover exports
  exclude private process journals and contributor-only instructions.

## Verification required before publication

| Layer | Candidate evidence / release requirement |
| --- | --- |
| Source | Full required gate, good GPG signatures, DCO/Assisted-by and independent review at the selected head |
| Coverage | At clean `2a9a0e9`: 95.26% lines, 94.00% functions, 87.34% branches across the nine public packages; not app/provider coverage |
| Browser | Clean `ba33365`: 192 synthetic cases on both owner arms and owned-resource closure; subsequent documentation/tool changes do not relabel that run |
| Local installed candidate | Nine ba33365 tarballs, 34 runtime imports, strict Node/DOM/Worker/docs and six generated-contract/software-crypto cases; no registry provenance |
| Native source | Earlier clean `e100762`: 28 proof/localnet lifecycle observations with grants, holdings, survivor rotation and wallet/indexer reconnect; not a new RC8-image/provider run |
| Images | Local ba33365 Linux/amd64 service/funding content/non-root/startup-refusal controls; actual published image digests and required mounted runtime/key HTTP acceptance still needed |
| Publication | Signed tags, final-head checks, reproducible archives, source/publisher attestations, private visibility, registry SHA/SRI, fresh registry installation, image manifests and deployed docs |

The [acceptance index](https://github.com/input-output-hk/midnight-passport-sdk/blob/passport-acc-prototype/docs/local-backlog-acceptance.md)
separates implementation from remaining evidence. Exact receipts keep their source,
version and runtime identity; no earlier native/browser receipt is retagged as RC8.

## Known limitations

- Shielded withdrawals still require an exact-value coin. **Partial spends/change
  are rejected** (#201); no full circuit-API coverage promise (#82).
- Full Lace/`lace-sdk` runtime adoption, real wallet extension acceptance and
  Google/iCloud restoration/provider behavior remain separately qualified (#81/#232).
  Contract/assets and selected helper adoption do not require replacing Lace orchestration.
- Default demo owner buttons are not automatically wired to durable mutation/jobs.
  Opt-in hosts must supply real confidential CAS persistence, outcome reconciliation
  and consent. Missing host state never proves that a send did not occur.
- Published grant records require their original issuing reader. Another enrolled
  device can have ACC access without those openings. Incomplete publication needs
  the original protected intent; no total-loss or lost-private-key recovery is implied.
- Full-owner scalars in page memory can be copied by code with that access and used
  outside host approval. Expiry/lock does not revoke copied authority. Plaintext
  IndexedDB secret storage is explicit opt-in and is not a production vault.
- Hosted jobs still have no replica-safe wallet lock or automatic callback replay.
  Reference proving/sponsorship/funding services require deliberate operator setup.
- The 30–45-second CI target is not yet met in every observed job (#271).
  Historical successful PR295 browser jobs reached 71 seconds; no tests/waits were
  removed to make the performance claim. Real provider and slow native lanes remain separate.

## Evaluation

Until RC8 is published, use the source-preview instructions or matching RC7
packages/backends. Do not substitute a local candidate version for a registry
release. Once published, use the exact RC8 versions and immutable image digests
from its signed receipt; keep tokens and operator state outside source control.
