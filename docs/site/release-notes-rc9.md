---
layout: default
title: RC9 hardening preview
permalink: /release-notes-rc9/
---


See the [RC9 developer release notes](https://input-output-hk.github.io/midnight-passport-sdk/operations/rc9-preview.html)
for the supported increment, package installation and limits. The
[signed publication receipt](https://github.com/input-output-hk/midnight-passport-sdk/releases/download/sdk-v0.1.0-rc9/rc9-publication-receipt.json)
records exact private registry hashes/SRI, attestations, image digests and checks.

## Changes since RC8

RC9 adds opt-in JubJub PRF-only creation and verified creation handoff, demo signing
modes, safe funding inventory/repeated-deposit behavior, focused account/demo/native
modules, bounded native inputs and installed-release quality/crypto checks.
VitePress separates reusable library integration from the reference demo wiring.

## Compatibility and limits

Binding acc-s3r1.1, Passport6458ed5, Compact0.35.0, language0.27.0, runtime0.20.0
and API1.0.0-pre.0 remain unchanged. Exact-value shielded withdrawals, fresh critical
consent, bounded grant scope and original-ID reconciliation remain required.
No full Lace, real-provider restoration, partial shielded spending, total-loss
recovery, native merchant atomicity, complete compromised-key revocation or
all-circuit typed coverage is claimed. Earlier receipts keep their original pins.
