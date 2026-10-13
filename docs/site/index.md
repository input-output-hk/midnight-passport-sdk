---
layout: default
title: Build with Midnight Passport
permalink: /
---

Midnight Passport gives an application a passkey controlled Account Custody Contract (ACC). The account API creates an account, opens it again with its registered passkey, reads its state and makes a signed call. The browser adapter supplies WebAuthn and the local prototype service supplies deployment, proving and fee sponsorship.

> **Current state:** These pages describe the `passport-acc-prototype` branch. The 13 packages can be packed as `0.1.0-rc1`, but have not been published. The packaged release binding is `acc-s3r1.1` from Passport revision `6458ed5`; the demo page and service now select `acc-s3r1.1`. Only the P-256 WebAuthn arm is driven end to end today. Follow [the packaging tracker](https://github.com/input-output-hk/midnight-passport-sdk/issues/31) for the release.

## Start here

1. [Packages]({{ '/packages/' | relative_url }}) explains which package owns each part of the integration.
2. [Account API]({{ '/api/' | relative_url }}) documents `createPassportAccounts`, its ports, events and errors.
3. [Service API]({{ '/service/' | relative_url }}) describes the local prototype endpoints and trust boundary.
4. [ZK keys]({{ '/keys/' | relative_url }}) explains the artefact integrity pin and prover-key distribution decision.
5. [Releasing]({{ '/releasing/' | relative_url }}) explains the guarded GitHub Packages workflow.

For a local run, follow the [demo guide](https://github.com/input-output-hk/midnight-passport-sdk/blob/passport-acc-prototype/AGENTS.md). The current service needs a compiled ACC and its own funded localnet; installing the TypeScript workspace alone is not enough to create an account.
