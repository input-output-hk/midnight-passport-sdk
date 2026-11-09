---
layout: default
title: Build with Midnight Passport
description: Start a browser or Node integration, choose Passport packages, or run the reference demo.
permalink: /
---

Build passkey-controlled **Account Custody Contract (ACC)** experiences on Midnight.
Use the reusable libraries with your own UI, wallet and infrastructure, or explore
one complete composition in the reference demo.

<div class="entry-grid">
  <a id="integrate-passport-into-your-product" class="entry-card" href="{{ '/getting-started/' | relative_url }}">
    <strong>Integrate the libraries →</strong>
    <span>Install exact packages, supply your host ports and wire create/open actions.</span>
  </a>
  <a id="run-the-reference-application" class="entry-card" href="{{ '/demo-guide/' | relative_url }}">
    <strong>Run the reference demo →</strong>
    <span>Set up the local services and try account, wallet, funding and permission flows.</span>
  </a>
</div>

<span id="start-here"></span>

## New to Passport?

Read [Architecture and concepts]({{ '/architecture/' | relative_url }}) first.
It explains the difference between an ACC, an HD wallet, a reader, a fee sponsor
and a funding wallet. Then choose the [library integration guide]({{ '/library-guide/' | relative_url }})
for your host boundary. Importing the SDK does not start a wallet, worker or UI.

<span id="reference-and-operations"></span>
<span id="lace-evaluation"></span>

## Find the guide for your task

| I want to… | Start here |
| --- | --- |
| Choose packages for browser or Node | [Packages and runtimes]({{ '/packages/' | relative_url }}) |
| Add holdings, transfers or device management | [Account API and method prerequisites]({{ '/api/#optional-methods-and-host-prerequisites' | relative_url }}) |
| Control consent, keys and session lifetime | [Authorization]({{ '/authorization/' | relative_url }}) and [account keys]({{ '/account-keys/' | relative_url }}) |
| Handle a crash or unknown transaction | [Mutation durability]({{ '/durability/' | relative_url }}) |
| Serve proof keys or sponsor transactions | [Public proving keys]({{ '/keys/' | relative_url }}) and [service API]({{ '/service/' | relative_url }}) |
| Integrate existing wallet or application contracts | [Lace evaluation]({{ '/lace-handover/' | relative_url }}) and [application contracts]({{ '/partner-integration/' | relative_url }}) |
| Fix an install, passkey or funding error | [Troubleshooting]({{ '/troubleshooting/' | relative_url }}) |

<span id="published-packages-and-current-source"></span>
<span id="published-preview-010-rc7"></span>
<span id="local-source-after-rc7"></span>

## Published preview `0.1.0-rc8`

**Nine private GitHub npm packages** and **three public Linux/amd64 service images**
are published. Request package read access and install matching exact versions;
these are not npmjs packages. [Install and connect]({{ '/getting-started/' | relative_url }})
provides registry setup and the maintained browser example.

Use [RC8 release notes]({{ '/release-notes-rc8/' | relative_url }}) and the
[signed release receipt](https://github.com/input-output-hk/midnight-passport-sdk/releases/download/sdk-v0.1.0-rc8/rc8-publication-receipt.json)
for published versions, hashes and image digests. Later checkout behavior is listed
separately under [Unreleased source changes]({{ '/source-preview/' | relative_url }}).

The supported preview uses binding `acc-s3r1.1`, Passport revision `6458ed5`.
Shielded withdrawals require exact-value coins; partial spends are refused.
Full-owner authority and bounded grants differ. Real-provider recovery, React
Native and full Lace compatibility are not established by this release.

## Learn what has been verified

[Quality and testing]({{ '/quality/' | relative_url }}) describes the gates;
[use-case evidence]({{ '/use-case-coverage/' | relative_url }}) maps scenarios to
source/browser/native acceptance; [qualification limits]({{ '/qualification/' | relative_url }})
explains the remaining boundaries. Historical release and live-run records stay
in **Design and history**; their dates and runtime pins still apply.
