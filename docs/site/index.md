---
layout: default
title: Build with Midnight Passport
permalink: /
---

Midnight Passport gives an application a passkey controlled Account Custody Contract (ACC). The account API creates an account, opens it again with its registered passkey, reads its state and makes a signed call. The browser adapter supplies WebAuthn and the local prototype service supplies deployment, proving and fee sponsorship.

> **Preview RC4:** These pages describe the nine implemented packages at `0.1.0-rc4` on `passport-acc-prototype`. The release pins ACC binding `acc-s3r1.1` from Passport revision `6458ed5`. Shielded withdrawal accepts only an exact-value coin and needs a value-capable v9 wallet; partial spends are rejected. Lace's hosted module has not been validated end to end. See [release notes]({{ '/release-notes-rc4/' | relative_url }}) and [Packages]({{ '/packages/' | relative_url }}) before integrating.

## Start here

Start with [Install and connect]({{ '/getting-started/' | relative_url }}) for authenticated
installation, an independently pinned service check, a browser composition example and common errors.

1. [Problems and package boundaries]({{ '/problems/' | relative_url }}) maps the seven integration needs to current and planned SDK surfaces.
2. [Packages]({{ '/packages/' | relative_url }}) explains which package owns each part of the integration.
3. [Account API]({{ '/api/' | relative_url }}) documents `createPassportAccounts`, its ports, events and errors.
4. [Circuit capabilities]({{ '/circuits/' | relative_url }}) inventories every pinned ACC proof circuit and pure helper, with its inputs and current support status.
5. [Service API]({{ '/service/' | relative_url }}) describes the local prototype endpoints and trust boundary.
6. [ZK keys]({{ '/keys/' | relative_url }}) explains the artefact integrity pin and prover-key distribution decision.
7. [Releasing]({{ '/releasing/' | relative_url }}) explains the guarded GitHub Packages workflow.
8. [Unpublished RC5 candidate]({{ '/release-notes-rc5/' | relative_url }}) describes the local review candidate; RC4 remains the published release.
9. [Preview RC4 release notes]({{ '/release-notes-rc4/' | relative_url }}) list validated behavior and deferred work.
10. [Engineering handover]({{ '/handover/' | relative_url }}) traces the localnet NIGHT funding flow, operating steps, audit findings and release boundary.

For a local run, follow the [demo guide](https://github.com/input-output-hk/midnight-passport-sdk/blob/passport-acc-prototype/AGENTS.md). The current service needs a compiled ACC and its own funded localnet; installing the TypeScript workspace alone is not enough to create an account.

The [demo use cases]({{ '/use-cases/' | relative_url }}) give the available actions,
prerequisites, expected results and current evaluation limits, including a NIGHT round trip
from the funding wallet through the ACC to the built-in wallet.

## Lace evaluation

The [Lace handover guide]({{ '/lace-handover/' | relative_url }}) describes the RC5
evaluation scope, package selection, private-registry access and supported integration boundaries.
