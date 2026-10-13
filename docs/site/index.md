---
layout: default
title: Build with Midnight Passport
permalink: /
---

Midnight Passport gives an application a passkey controlled Account Custody Contract (ACC). The account API creates an account, opens it again with its registered passkey, reads its state and makes a signed call. The browser adapter supplies WebAuthn and the local prototype service supplies deployment, proving and fee sponsorship.

> **Current state:** These pages describe the `passport-acc-prototype` branch. Its packages are private workspace packages and are not yet published. The [packaging tracker](https://github.com/input-output-hk/midnight-passport-sdk/issues/31) records the remaining adapter split, ACC artefact package and release work. Only the P-256 WebAuthn arm is driven end to end today.

## Start here

1. [Packages]({{ '/packages/' | relative_url }}) explains which package owns each part of the integration.
2. [Account API]({{ '/api/' | relative_url }}) documents `createPassportAccounts`, its ports, events and errors.
3. [Service API]({{ '/service/' | relative_url }}) describes the local prototype endpoints and trust boundary.
4. [ZK keys]({{ '/keys/' | relative_url }}) explains the artefact integrity pin and prover-key distribution decision.
5. [Releasing]({{ '/releasing/' | relative_url }}) explains the guarded GitHub Packages and npmjs workflow.

For a local run, follow the [demo guide](https://github.com/input-output-hk/midnight-passport-sdk/blob/passport-acc-prototype/AGENTS.md). The current service needs a compiled ACC and its own funded localnet; installing the TypeScript workspace alone is not enough to create an account.
