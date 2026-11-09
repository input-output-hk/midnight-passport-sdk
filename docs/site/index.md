---
layout: default
title: Build with Midnight Passport
permalink: /
---

Midnight Passport provides libraries for passkey-controlled Account Custody Contracts
(ACCs) on Midnight. A host composes account flows, key sources, checked chain access,
proof/submission services and its own consent UI. The reference demo shows one browser
and local-service composition of those libraries.

## Start here

### Integrate Passport into your product

The [Library integration guide]({{ '/library-guide/' | relative_url }}) covers package
selection, published/source API boundaries, host contracts, input validation, custody,
cancellation and cleanup.

### Run the reference application

The [Demo app guide]({{ '/demo-guide/' | relative_url }}) covers local setup, login and
four workspaces, actual passkey reviews, routine access, owner approval and bounded transfers.

The library path does not require the demo's UI, React, local storage layout or memory
lease policy. The demo path needs a ready backend/chain/prover and configured wallets;
installing TypeScript packages alone cannot create an account.

<span id="published-packages-and-current-source"></span>
<span id="published-preview-010-rc7"></span>
<span id="local-source-after-rc7"></span>

## Published preview `0.1.0-rc8`

Nine implemented libraries are available through **private GitHub Packages** (`next`),
with three public Linux/amd64 backend images. Use matching exact versions from the
[installation guide]({{ '/getting-started/' | relative_url }}) and immutable image
pins in the [signed release receipt](https://github.com/input-output-hk/midnight-passport-sdk/releases/download/sdk-v0.1.0-rc8/rc8-publication-receipt.json).
[RC8 release notes]({{ '/release-notes-rc8/' | relative_url }}) describe the supported
increment, checks and limitations.

RC8 adds validation/authorisation, explicit secret-store/background ports,
verified-login adoption and bounded-session helpers. The reference app adds consistent
nested navigation, Activity, combined credential review and a wallet worker. These
host policies are optional; importing a library creates no wallet, thread or UI.
Earlier RC7 packages do not export the added RC8 APIs. Historical qualification
retains its recorded source/runtime identity; publication does not imply a new native
or real-provider pass.

The binding remains `acc-s3r1.1`, pinned to Passport revision `6458ed5`. Shielded
withdrawals require an exact-value coin; partial spending remains rejected. A scoped
grant child and a full on-chain owner have different authority. Synthetic browser or
hosted tests do not establish real-provider or full Lace compatibility.

## Reference and operations

Use [Packages]({{ '/packages/' | relative_url }}) and
[Account API]({{ '/api/' | relative_url }}) for exported boundaries;
[Circuits]({{ '/circuits/' | relative_url }}) and
[Capabilities]({{ '/capabilities/' | relative_url }}) for pinned proof requirements.
[Service API]({{ '/service/' | relative_url }}),
[ZK keys]({{ '/keys/' | relative_url }}) and
[Recovery contracts]({{ '/durability/' | relative_url }}) cover backend composition.

[Qualification]({{ '/qualification/' | relative_url }}) identifies what was actually
verified; [Quality strategy]({{ '/quality/' | relative_url }}) maps source contracts
and tests. [Releasing]({{ '/releasing/' | relative_url }}) explains package publication.
Historical [RC5]({{ '/release-notes-rc5/' | relative_url }}) and
[RC4]({{ '/release-notes-rc4/' | relative_url }}) notes retain their original scope.

## Lace evaluation

The [Lace handover guide]({{ '/lace-handover/' | relative_url }}) describes evaluation
scope, package selection, private-registry access and supported integration boundaries.
The separate [wallet reader]({{ '/lace-wallet/' | relative_url }}) is an optional
read-only connector (RC8); connecting it does not grant ACC ownership or spending.
