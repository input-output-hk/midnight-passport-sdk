---
layout: default
title: Preview RC8 release
permalink: /release-notes-rc8/
---

## 0.1.0-rc8 — supported partner preview

**Published:** nine private GitHub npm packages and three public Linux/amd64
backend images, all versioned `0.1.0-rc8`. Use the
[release](https://github.com/input-output-hk/midnight-passport-sdk/releases/tag/sdk-v0.1.0-rc8),
[signed verification receipt](https://github.com/input-output-hk/midnight-passport-sdk/releases/download/sdk-v0.1.0-rc8/rc8-publication-receipt.json)
and [exact-version installation guide]({{ '/getting-started/' | relative_url }}).
The [library guide]({{ '/library-guide/' | relative_url }}) describes reusable APIs;
the [demo guide]({{ '/demo-guide/' | relative_url }}) describes the reference app.

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
  spelling remains an identical compatibility alias. Both ship in RC8 and are absent from RC7.
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

## Verification and evidence boundaries

| Layer | Verified scope / explicit boundary |
| --- | --- |
| Source | Signed/DCO source0fa9467, reviewed PR301, all22 PR checks; sdk-check and live source release checks passed, including coverage/reproducibility |
| Coverage | At release source `0fa9467`: 95.26% lines, 94.00% functions, 87.34% branches across the nine public packages; not app/provider coverage |
| Browser | Clean `ba33365`: 192 synthetic cases on both owner arms and owned-resource closure; subsequent documentation/tool changes do not relabel that run |
| Registry installation | Nine actual RC8 registry archives: private visibility, exact next tag, SHA-256/SRI and source/publisher attestations; fresh authenticated install, runtime imports, strict Node/DOM/Worker/docs, six generated-contract/software-crypto cases, synthetic interruptions, browser build and one-circuit restore |
| Native source | Earlier clean `e100762`: 28 proof/localnet lifecycle observations with grants, holdings, survivor rotation and wallet/indexer reconnect; not a new RC8-image/provider run |
| Images | Published Linux/amd64 digests pulled: service/funding content/non-root/startup refusals; key profile10/all52 verifiers, full prover hash, Range/CORS, one-circuit deterministic regeneration. Wider service/funding readiness/native runtime qualification remains #299 |
| Publication | Four verified signed tags, successful source/publisher/image workflows and signed machine-readable receipt. Published-doc verification is a separate signed release asset after Pages deployment |

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

Install exact RC8 versions and matching immutable image digests from the signed
receipt. Request private package read access for each consuming user/repository.
Keep tokens and operator state outside source control; core imports start no service,
thread or wallet. Use the demo source tagged `sdk-v0.1.0-rc8` for a matching UI.
