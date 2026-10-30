---
layout: default
title: Preview RC6 release
permalink: /release-notes-rc6/
---

## 0.1.0-rc6 — release candidate · 2026/10/30

**Publication pending.** RC5 remains the published preview until the release assets
and registry checks below are complete. RC6 keeps the nine implemented libraries,
private GitHub npm packages under `@input-output-hk/mn-passport-*`, the `next`
distribution tag, and three public Linux/amd64 GHCR backend images. Install exact,
matching SDK versions; package administrators must grant consumers read access.

## Changes since RC5

- Portable key-origin/hosted adapters preserve explicit consent and separate the
  reader key, random ACC viewing secret, and HD wallet seed. Branded host values
  still need deliberate adapters; circuit proving and transaction proving differ.
- Reduced key profiles serve every pinned small verifier while restricting proving
  bundles to the selected circuit roster. The ten-circuit `jubjub-owner-v1` profile
  no longer hides verifiers required by deployment/other callers.
- Opt-in owner continuations persist original create/activate, rotate and device
  intents behind a protected journal, fresh approval and exact outcome source.
  Ambiguous original outcomes remain unknown; no replacement operation is created.
- Published grant bookkeeping can be reconstructed with the original issuing reader
  after local profile loss, checked against live commitments, origin and read-key
  hashes. It cannot invent missing staged openings or recover a grantee's secrets.
- Expired confirmed jobs, including TTL zero, retain an authenticated full-identity
  result read. Collecting the original receipt never schedules or replays work,
  changes the journal or renews public visibility.
- Opt-in descriptor-based Node host jobs add encrypted acceptance/status history,
  original-ID continuation, authenticated operator HTTP clients, bounded admission
  and shutdown. Reference host calls share the sponsor queue and deployment policy.
  The default browser demo and volatile legacy `/v1/jobs` protocol remain distinct.
- Qualification now covers populated survivor enrollment/removal/rotation, grants,
  holdings, wallet reconnect, proof/indexer outages, preparation races, killed host
  processes and production-entrypoint local image restarts for both authoriser arms.
  Source/image receipts name their actual signed revisions and different boundaries.
- Installed-consumer checks authenticate all nine tarballs and every installed SDK
  file, enforce physical runtime identity, replay a frozen lock offline in another
  fresh application, and test eight HTTP/process interruption cases with synthetic
  drivers plus hosted-consent refusals. Native, synthetic, registry, provider and
  actual-host evidence remain separate tiers.

## Binding and API axes

The ACC remains `acc-s3r1.1`, Passport source `6458ed5`, Compact `0.35.0`,
Compact runtime `0.20.0`, compiler manifest SHA-256
`77fb9c17b0d59047456c43115d9a58f5cb99a226ee73b6b974fd724930c3153f`.
Account/service wire versions remain `1.0.0-pre.0`. This preview adds opt-in APIs;
it does not migrate existing ACCs or enable new contract families. Prover keys
stay outside npm: restore from packaged ZKIR and verify every hash/size.

## Release limitations

- **Exact-value shielded withdrawals only.** Partial spends, durable change capture
  and spent-input recovery remain refused/deferred (#201); a compatible value
  wallet is required (#202). Complete typed circuit coverage remains #82.
- **No full Lace or real-provider compatibility claim.** Current-source and public
  host-entry evidence is version-specific (#79/#81); real signer-page, Google/
  iCloud restoration and two-browser ceremonies remain #232. Host consent is never
  relabelled to make an unsupported rotation or withdrawal appear approved.
- Device removal removes a specific entry and excludes its reader from fresh keys.
  It cannot erase earlier disclosures or prove complete compromised-identity
  retirement (#228/#229). Losing every recoverable key origin remains #240.
- Grant bookkeeping is encrypted to its publisher's reader. Another enrolled owner
  may read ACC holdings but not those records. Deliver confirmed `sealedReadGrants`
  to each grantee; shared ACC viewing access is not bookkeeping portability (#239).
- Descriptor jobs are operator/BFF APIs. Keep tokens out of browser storage, use
  independent protected keys, disjoint retained journals and controlled ingress.
  No automatic worker scanner, distributed sponsor-wallet lock, persistent spending
  budget, general no-send repair or journal compaction is delivered (#233/#234).
- Native restart evidence qualifies declared source/image revisions on retained
  Linux state volumes. macOS bind-backed image journals remain unqualified. The
  image confirmed-result observation loss followed by KILL is not the source
  post-submit/pre-ack host-exit boundary. Image dispatch claims are not separately
  instrumented network-send counts. Canonical node/indexer checks trust that pair;
  they are not cryptographic light-client proofs.
- Grant/holding setup and wallet credit in those lifecycle tests are standalone,
  not job-backed value transfers. The default demo owner buttons do not acquire
  durable behaviour merely because a journal or new HTTP endpoint exists.
- NIGHT funding is qualified on the pinned `undeployed` localnet, in smallest
  units. Other environments need a dedicated funded wallet, explicit policy and
  separate acceptance. Proving servers receive private proof inputs; restrict ingress.

These are preview boundaries, not blockers to publishing this supported subset.
Broad stability/provider issues remain open for the next RC. The qualification
catalog's comprehensive `release` suite still contains unimplemented/manual tiers;
its `releaseQualified: false` is not rewritten into a provider acceptance claim.

## Review map and evidence

- [Consumer integration]({{ '/consumer-integration/' | relative_url }}),
  [durable owner API]({{ '/durability/' | relative_url }}),
  [grant reconstruction]({{ '/grant-recovery/' | relative_url }}),
  [host transport]({{ '/host-durability/' | relative_url }}) and
  [service jobs]({{ '/service-jobs/' | relative_url }}).
- Repository review maps: `docs/review/consumer-qualification/`,
  `host-jobs/`, `native-host-jobs/`, `job-backed-lifecycle/` and `installed-consumer/`.
- Candidate code gate at `c754615`: 1,005 tests passed, seven existing conditional
  skips ([gate receipt](https://github.com/input-output-hk/midnight-passport-sdk/blob/passport-acc-prototype/docs/review/rc6-candidate/code-gate.json)).
  [Historical populated lifecycle receipt](https://github.com/input-output-hk/midnight-passport-sdk/blob/passport-acc-prototype/docs/review/job-backed-lifecycle/qualification.json):
  source `b9a203b`, 28 cases; local image source `7703135`, 26 cases.
  [Installed synthetic interruption receipt](https://github.com/input-output-hk/midnight-passport-sdk/blob/passport-acc-prototype/docs/review/rc6-candidate/suite-receipt.json):
  source `c754615`, eight TTL-zero cases. These counts cover different
  scopes and sources; they are not one interchangeable end-to-end suite.

Final signed source/tags, registry package hashes/SRI, attestations, image digests,
installation results and published-doc verification will be recorded in the RC6
publication receipt and GitHub release after publishing. Earlier RC5 receipts and
all failed/unknown native attempts retain their original status.
