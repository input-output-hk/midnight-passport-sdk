---
layout: default
title: Preview RC5 candidate
permalink: /release-notes-rc5/
---

## Proposed 0.1.0-rc5 — unpublished local candidate

RC4 remains the published package release described by the installation examples. RC5 is
prepared locally for review. No registry package, image tag, signed release tag or Pages
publication is implied by this page. The candidate contains the same nine implemented
`@input-output-hk/mn-passport-*` packages, intended for the `next` distribution tag, plus the
keys, service and funding images. Final versions, hashes and registry digests must be recorded
after approved publication; local image IDs are not registry manifest digests.

The ACC binding remains `acc-s3r1.1`, source
`6458ed5fe6a4843912328bbf11112b97e33abf45`, compiler manifest SHA-256
`77fb9c17b0d59047456c43115d9a58f5cb99a226ee73b6b974fd724930c3153f`.
Prover keys are restored from packaged ZKIR and verified against the key manifest. All nine
packages exclude TypeScript build caches, and the release gate compares independent builds.

## Changes since RC4

- Demo: localnet NIGHT funding, operation traces, address recovery, chain-backed holdings,
  reviewed owner unshielded withdrawals, sealed device enrollment/removal and scoped spend
  grants with export, holder use and revocation.
- Funding: durable request progress and operator reconciliation for the supported outcomes.
  A completed request ID replays its recorded result. Indeterminate requests require careful
  reconciliation; this is not permission to submit a second deposit.
- Keys/account: policy-bound P-256 sealed registrations, mixed-device reader preservation,
  fail-closed live device/grantee checks and actual nonempty keyring validation for hosted ports.
- Browser: Chrome CDP virtual-authenticator PRF tests cover create, rotation, reload/open,
  pinned wallet and negative paths. The long localnet path is opt-in. Chromium's known signed
  JSON GREASE variant is retried within a bound; unknown profiles remain refused.
- Lace: pinned merged head `502b0794cc7bcfc76342230193fef4ebb63cae1c`; exact source types,
  package installation and physical runtime identity checks. Synthetic-credential localnet
  tests passed SDK-created → Lace hosted sign-in, native Lace hosted-created → SDK address
  opening with local key-origin ports, and a hosted authorising-only device addition.
- Localnet sealed P-256 read-grant revocation rotated away from the grantee, refused its old
  seal and preserved opening by both enrolled devices. Evidence includes transaction hashes.

## Safety and compatibility limits

**Shielded withdrawals require the selected coin's exact value.** Partial spends remain
rejected before signing. Change capture, durable change publication and spent-input
reconciliation are deferred under #201. A value-capable v9 wallet is required; the remote
fee-only sponsor refuses shielded offers. Do not infer a validated Lace-hosted value route.

This candidate does **not** claim full Lace compatibility. Generic SDK hosted creation needs
validation excluded from Lace's creation scope; sealed enrollment needs roster reads excluded
from its non-rotating scope; hosted sign-in filters registrations required by SDK address
recovery. Tests preserve those scopes and use Lace-owned orchestration where appropriate.
An authorising-only device entry receives no viewing secret. Real provider/browser signer
behavior is not established by simulated windows and synthetic PRF credentials.

NIGHT funding is qualified on the pinned localnet only. Non-localnet deployments require
dedicated wallets, explicit policy, persistent state and controlled ingress. Exported grant
openings are capabilities for the intended holder. Loss of every enrolled/recoverable passkey
is not repaired by knowing the ACC address. Typed coverage of every circuit remains #82.

## Review and evidence

The source tree contains `docs/local-backlog-acceptance.md`, `docs/lace-consumer-report.md`
and `docs/review/rc5/` with the review stack, exact tests and evidence. These will become
GitHub links after the reviewed source is pushed and merged. Published checks, private-package
visibility and registry-byte/attestation matching still belong to the release procedure.
See [Releasing]({{ '/releasing/' | relative_url }}) for the publication boundary.
