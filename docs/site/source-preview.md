---
layout: default
title: Unreleased source changes
description: Changes after the published RC8 packages, with their integration and verification limits.
permalink: /source-preview/
---

**Published packages remain `0.1.0-rc8`.** The changes below require a matching
source checkout and build; they are not installed by selecting the registry's
`next` tag. A deployed documentation page is not a package release.

## Changes after RC8

| Area | Source change | Integration impact |
| --- | --- | --- |
| Funding availability | Optional spendable-inventory preflight; unavailable/missing stock disables deposits. Bounded catch-up, sanitized failures and stale-read guards. | Run matching reference service/funding source and policy. Allowlisting a token does not mint it. [Service contract]({{ '/service/#source-preview-optional-funding-inventory-port-after-rc8' | relative_url }}). |
| Demo availability recovery | Bounded GET-only catch-up after a deposit and a Deposit-page refresh control; stable selection, deadlines and stale-result fences. | No POST retry or ID replacement. [Repeat a deposit]({{ '/demo-guide/#repeat-a-deposit-without-reloading' | relative_url }}). |
| Funding intent | Only a durable, exact no-submit receipt permits releasing a refused intent. Unknown/legacy outcomes keep the original ID. | No automatic POST retry or blanket journal clearing. [Demo behavior]({{ '/demo-guide/#source-preview-deposit-availability-after-rc8' | relative_url }}). |
| Demo signing comparison | `VITE_PASSPORT_SIGNING_MODE=passkey|jubjub`, or explicit `?signing=passkey|jubjub` per document. | New JubJub accounts use the deterministic PRF-derived initial owner, without an unnecessary P-256 signing probe. Existing accounts are not migrated. [Request paths]({{ '/passkey-prompts/#source-preview-compare-signing-modes-after-rc8' | relative_url }}). |
| Verified creation handoff | Additive `onAccountCreated` hook and opt-in `registrationProfile: 'jubjub-prf'` for the JubJub composition. | Reuse the creation key scope for a host-selected routine handoff. PRF-only registration refuses direct P-256 signing. [Library contract]({{ '/library-guide/#source-preview-registration-and-creation-handoff-after-rc8' | relative_url }}). |
| Documentation | Task-based navigation, architecture overview, troubleshooting and this version map. | Existing permalinks remain usable. Library contracts and demo policies have separate entry paths. |

## Evaluate a source checkout

Follow [source evaluation]({{ '/library-guide/#evaluate-the-current-source' | relative_url }})
with the checkout's matching lockfiles and public exports. Record its commit and
whether it has uncommitted changes. Build/type checks do not install a registry
package or establish native/provider compatibility.

The source demo's routine reader/wallet lease retains no raw PRF or owner key.
Later critical operations still require fresh passkey approval; separately
approved bounded transfers retain their exact scope. The source feature does
not change the ACC's full-owner authority or key derivation recipe.

## What is unchanged

- Released packages/images and the signed RC8 receipt keep their original bytes.
- The binding is `acc-s3r1.1`, Passport revision `6458ed5`.
- Shielded withdrawals require an exact-value coin; partial spends are refused.
- Synthetic credentials/browser tests do not establish real-provider recovery,
  new native proof qualification or full Lace compatibility.

Use [Published RC8]({{ '/release-notes-rc8/' | relative_url }}) for the released
scope and [use-case evidence]({{ '/use-case-coverage/' | relative_url }}) for the
distinction between source tests and recorded acceptance.

## Pre-RC architecture and input quality

Internal JubJub readiness, capability, grant and holdings modules now separate
operation responsibilities from connector wiring. The public package set and method
signatures are unchanged. The architecture lint checks actual literal import syntax,
Node built-ins and cross-package source paths; all reference app sources enter the
AST gate with explicit remaining native-bridge debt.

The Node host's finality observation bounds response bytes before JSON parsing and
validates the record with the existing pinned Zod version. Header/body aborts and
invalid observations remain unknown outcomes. Funding policy and tagged value amounts
bound decimal length before BigInt conversion, preserving Uint128/Uint256 maxima.
See the [quality guide]({{ '/quality/' | relative_url }}) for the scope and gates.
