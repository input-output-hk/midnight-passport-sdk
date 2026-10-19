---
layout: default
title: Preview RC5 release
permalink: /release-notes-rc5/
---

## 0.1.0-rc5 — published preview · 2026/10/19

The nine implemented `@input-output-hk/mn-passport-*` libraries are published privately on
GitHub Packages at `0.1.0-rc5`, distribution tag `next`. The three backend images are public on
GHCR for Linux/amd64. Package administrators must grant read access to Lace users and consuming
repositories; repository membership alone does not establish access to a separately managed package.

- [Release and signed verification assets](https://github.com/input-output-hk/midnight-passport-sdk/releases/tag/sdk-v0.1.0-rc5)
- [Publication receipt: package SHA-256 values, image digests and checks](https://github.com/input-output-hk/midnight-passport-sdk/blob/passport-acc-prototype/docs/release/rc5-publication-receipt.json)
- [Install and connect]({{ '/getting-started/' | relative_url }}) and [Lace evaluation guide]({{ '/lace-handover/' | relative_url }})

The signed release source is `9e8048674a54adf5e8be2055aaa8f5c9bfe08b06`.
`sdk-v0.1.0-rc5`, `keys-v0.1.0-rc5`, `service-v0.1.0-rc5` and `funding-v0.1.0-rc5`
are verified GPG-signed annotated tags at that same commit, with DCO sign-offs.

The ACC binding remains `acc-s3r1.1`, source
`6458ed5fe6a4843912328bbf11112b97e33abf45`, compiler manifest SHA-256
`77fb9c17b0d59047456c43115d9a58f5cb99a226ee73b6b974fd724930c3153f`.
Prover keys are restored from packaged ZKIR and verified against the key manifest. All nine
packages exclude TypeScript build caches, and the release gate compares independent builds.

## Changes since RC4

- Demo: localnet NIGHT funding, operation traces, address recovery, chain-backed holdings,
  reviewed owner unshielded withdrawals, sealed device enrollment/removal and scoped spend
  grants with export, holder use and revocation.
- Demo wallet: **Refresh wallet balance** syncs and reads the existing wallet without a new
  passkey prompt. Wallet and ACC balances are separate and displayed in smallest units.
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

This preview does **not** claim full Lace compatibility. Generic SDK hosted creation needs
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

The release source passed repository lint, formatting, builds, package/app tests and service/browser
type checks. The source workflow compared two independent builds. All nine downloaded registry
archives passed SRI and publisher-workflow attestation verification; their decompressed tar streams
match the local candidate byte for byte. The archive SHA-256 values differ from macOS packs only
because gzip records a different OS header. Use the **published** hashes in the receipt, not an
unrelated platform's archive hash. Clean installation, entrypoint imports, a Vite browser build,
physical runtime identity and a restored/hash-verified circuit passed from registry tarballs.
The browser quickstart was also type-checked against RC5 tarballs.

All three images were pulled by immutable registry digest, checked for Linux/amd64 and non-root
UID/GID `10001:10001`; version and source-SHA aliases resolve to the same digest. Published service
and funding images passed startup refusals and a mounted-tree localnet run: create, activate,
read/reopen, a confirmed NIGHT deposit and identical-request replay without another transfer.
The key image verified the existing 52-circuit cache, served pinned prover/verifier bytes with range
and CORS checks, and regenerated `deposit_unshielded` in a fresh volume. Fresh generation of all
52 circuits was not repeated.

See the [publication receipt](https://github.com/input-output-hk/midnight-passport-sdk/blob/passport-acc-prototype/docs/release/rc5-publication-receipt.json),
[compatibility matrix](https://github.com/input-output-hk/midnight-passport-sdk/blob/passport-acc-prototype/docs/compatibility.md),
[review evidence](https://github.com/input-output-hk/midnight-passport-sdk/tree/passport-acc-prototype/docs/review/rc5)
and [Releasing]({{ '/releasing/' | relative_url }}). Deferred issues are
[#201](https://github.com/input-output-hk/midnight-passport-sdk/issues/201),
[#82](https://github.com/input-output-hk/midnight-passport-sdk/issues/82) and
[#202](https://github.com/input-output-hk/midnight-passport-sdk/issues/202).
