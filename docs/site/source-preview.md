---
layout: default
title: RC9 increment after RC8
description: RC9 changes after RC8, with their integration and verification limits.
permalink: /source-preview/
---

**RC9 packages are `0.1.0-rc9`.** The additive library hooks and backend fixes
below are included in that release. Use matching exact packages and service images.
Demo-only behavior requires the reference application at the RC9 source tag;
installing an SDK package does not install a UI, adopt a routine session or
provision a wallet. The signed release receipt defines the qualified subset.

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

Use [Published RC9]({{ '/release-notes-rc9/' | relative_url }}) for the released
scope and [use-case evidence]({{ '/use-case-coverage/' | relative_url }}) for the
distinction between source tests and recorded acceptance.

## Pre-RC architecture and input quality

Internal JubJub readiness, capability, grant and holdings modules now separate
operation responsibilities from connector wiring. The public package set and method
signatures are unchanged. The architecture lint checks actual literal import syntax,
Node built-ins and cross-package source paths; all reference app sources enter the
AST gate. The typed native-bridge follow-up below retires its earlier dynamic-any
and size exceptions; separate live/native qualification remains required.

The Node host's finality observation bounds response bytes before JSON parsing and
validates the record with the existing pinned Zod version. Header/body aborts and
invalid observations remain unknown outcomes. Funding policy and tagged value amounts
bound decimal length before BigInt conversion, preserving Uint128/Uint256 maxima.
See the [quality guide]({{ '/quality/' | relative_url }}) for the scope and gates.

## Typed operation and reference-host decomposition

RC9 separates P-256 operations, reference app controllers and DOM
presentation, and the native reference loader/driver. Public account signatures,
key recipes, circuit order, fresh critical approval, scoped-transfer restrictions
and exact-value shielded withdrawal guards remain. The native bridge now uses
actual v9 types and checked retained contexts; resume does not replan or create a
replacement authority. This cleanup adds no package or framework requirement.

The [review map](https://github.com/input-output-hk/midnight-passport-sdk/blob/passport-acc-prototype/docs/review/quality-debt-2026-11-10.md)
identifies source, synthetic browser and offline-ledger regressions. Native proof,
provider, installed-consumer and image/release acceptance remain separate evidence.
