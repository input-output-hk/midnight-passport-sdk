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

## Published packages and current source

### Published preview `0.1.0-rc7`

Nine implemented libraries are available through private GitHub Packages, with
release-tagged browser composition, capability/preflight APIs and opt-in recovery/service
seams. Use matching exact versions and [RC7 release notes]({{ '/release-notes-rc7/' | relative_url }}).
Three backend images are published for Linux/amd64.

### Local source after RC7

The checkout adds optional validation/authorization/custody/background APIs,
verified-login adoption, owner/session helpers and current demo navigation/combined
credential review. Source exports and local tests are not a new package release or
proof of deployed-site behavior. Check each guide's release label.

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
source read-only connector; connecting it does not grant ACC ownership or spending.
