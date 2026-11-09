---
layout: default
title: Troubleshooting
description: Diagnose installation, credential, funding and recovery failures without losing operation state.
permalink: /troubleshooting/
---

Start with the failing boundary. Keep the original operation/request ID and any
transaction reference before retrying. A transport timeout or generic failure
does not establish that no transaction was submitted.

## Installation and configuration

| Symptom | Check | Next step |
| --- | --- | --- |
| Private package install returns 401/403/404 | Scope registry, token permissions/expiry, organization SSO where applicable, and user/repository package access | Follow [registry setup]({{ '/getting-started/#2-authenticate-and-install-an-exact-version' | relative_url }}). Keep credentials outside source/logs. |
| Import/subpath is missing | Exact installed version and public export name | Check [package entries]({{ '/packages/#runtime-and-host-requirements' | relative_url }}) and [unreleased changes]({{ '/source-preview/' | relative_url }}). RC7 lacks RC8 additions; RC8 lacks later source APIs. |
| `ArtefactIntegrity` or `NetworkMismatch` | Exact package versions, network, binding and independently trusted manifest | Compare [checked configuration]({{ '/capabilities/' | relative_url }}). Do not adopt a server-reported pin to silence the error. |
| Browser build fails on WASM/Buffer | Bundler/polyfill setup and matching Midnight dependencies | Use the [browser integration recipe]({{ '/getting-started/#4-compose-the-browser-account-api' | relative_url }}). A Node import test is not a browser build test. |

## Passkeys and account access

| Symptom | Check | Next step |
| --- | --- | --- |
| PRF unavailable | Provider support and which store holds the passkey | Use the documented PRF-capable provider path; the Chrome profile-only store is refused. Do not replace the credential automatically. |
| Passkey cannot be found | Exact origin/RP ID, selected provider and enrolled credential | The local demo uses `http://localhost:5173`, not `127.0.0.1`. Account-address login still requires an enrolled passkey. |
| Several passkey requests during creation | Signing arm, PRF availability and signing-profile retries | See [request paths]({{ '/passkey-prompts/' | relative_url }}). Source JubJub comparison reduces creation calls; it does not migrate existing P-256 accounts. |
| Routine access asks again | Lease expiry, hidden tab, reload, explicit lock or changed account | Log in/unlock explicitly. Stored address hints do not authenticate; critical operations retain fresh approval. |
| Device/key/grant action refuses | Complete live rosters, holdings, read grants and required encrypted openings | Supply the [method prerequisites]({{ '/api/#optional-methods-and-host-prerequisites' | relative_url }}); unavailable data is not an empty roster. |

## Balances and funding

| Symptom | Check | Next step |
| --- | --- | --- |
| Built-in wallet balance has not changed | Correct recipient/network and indexer synchronization | Choose **Refresh wallet balance**. ACC and HD wallet balances are separate; an unavailable read is not zero. |
| A custom token is unavailable for deposit | Funding wallet's actual spendable inventory on the same chain | An allowlist grants permission; it does not mint tokens. The operator must provision the asset. See [source funding availability]({{ '/demo-guide/#source-preview-deposit-availability-after-rc8' | relative_url }}). |
| Funding returns 409 or outcome unknown | Original durable reservation, transaction and live ACC state | Reconcile the original ID before any replacement send. See [funding intent]({{ '/service/#source-preview-funding-intent-and-observation' | relative_url }}). |
| Funding says no transfer was started | Exact server response and source version | Only the later source's durable no-submit receipt releases that refused intent. A generic error is insufficient; see [source changes]({{ '/source-preview/' | relative_url }}). |
| Shielded withdrawal refuses a smaller amount | Coin value and selected circuit support | Partial spending is unsupported. Keep the exact-value guard; see [RC8 limits]({{ '/release-notes-rc8/#known-limitations' | relative_url }}). |

## Interrupted or uncertain operations

Cancel/lock prevents future local work; it does not undo a dispatched transaction.
Preserve pending deployment/enrollment attempts, counters, sealed entries and
grant journals. Do not delete browser data, create a replacement account or
change IDs to get past an uncertainty fence.

Use [mutation durability]({{ '/durability/' | relative_url }}) for account
continuation, [host submissions]({{ '/host-durability/' | relative_url }}) for
host-owned transaction state, or [service jobs]({{ '/service-jobs/' | relative_url }})
for an explicitly configured durable service composition. These are distinct
recovery paths with different persistence owners.

## Share a useful bug report

Include:

- Exact package version or source commit, runtime/browser and whether the source is dirty.
- Network, binding, manifest hash and service/image version or digest.
- Action, public error code, timestamps, original operation ID and transaction reference.
- Minimal reproduction and the relevant redacted public request/response.

Exclude tokens, seeds, PRF outputs, owner/reader secrets, grant openings and proof
witnesses. The demo's **Audit** workspace exposes public evidence. File reports
in the [SDK issue tracker](https://github.com/input-output-hk/midnight-passport-sdk/issues).
