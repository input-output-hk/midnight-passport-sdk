---
layout: default
title: Architecture and concepts
description: Account, key, wallet and service boundaries for integrating the Passport SDK.
permalink: /architecture/
---

Midnight Passport SDK exposes reusable account flows around a deployed **Account
Custody Contract (ACC)**. Your host chooses the user experience, credentials,
storage and infrastructure. Start with the concepts below, then follow
[Install and connect]({{ '/getting-started/' | relative_url }}).

## Five boundaries to understand

| Boundary | Responsibility | SDK surface |
| --- | --- | --- |
| Your application | User actions, exact consent, state projection, key lifetime and recovery policy | Your code; optional `account/interaction`, `/authorisation`, `/secret-store`, `/background` |
| Account flows | Create/open an ACC, read verified state and perform supported owner/grant operations | `account`, contracts from `protocol` and `account/ports` |
| Credentials and keys | Obtain the required credential capability, derive keys, sign and open sealed records | `keys`, `adapter-webauthn`, or host-provided key/authorizer ports |
| Chain and remote adapters | Read the ledger; prepare, prove, sponsor, submit and observe operations | `adapter-midnight-js`, `adapter-service`, or your existing infrastructure |
| ACC binding and public artifacts | Versioned generated contract, capability catalog, ZKIR/verifiers and integrity manifest | `contract`; public prover keys are restored/served separately |

`adapter-browser` is an optional composition root across these layers. It is not
the only way to use the account package. A wallet host can supply its existing
signer and transaction ports; a contract integrator can adopt the binding/assets
without replacing its application orchestration. See the
[package/runtime map]({{ '/packages/' | relative_url }}) and
[application-contract integration]({{ '/partner-integration/' | relative_url }}).

## An ACC is not an HD wallet

An **ACC** is a smart contract holding assets under its enrolled owner keys and
grants. A **Midnight HD wallet** has its own seed, address and balances. Connecting
that wallet does not give it permission to view or spend ACC assets.

The reference demo additionally runs a **fee sponsor** to pay transaction fees and
an optional **funding wallet** to deposit assets into the ACC. Sponsorship does not
deposit assets. The built-in user wallet is separate from both service wallets.

| Term | Meaning |
| --- | --- |
| Passkey | Provider-managed WebAuthn credential. Its P-256 signature and PRF outputs serve different purposes. |
| PRF | Deterministic secret output for a credential and domain-separated input. Availability/recovery depends on the provider and credential. |
| JubJub owner | A signing key accepted by the ACC after registration. A full owner is not a restricted session key. |
| Reader key | Opens sealed envelopes addressed to that reader; it does not authorize spending. |
| ACC viewing secret | Random private material used to open matching encrypted account records. It is not a wallet seed. |
| Bounded grant | Explicitly approved authority with its own recipient/asset/caps/expiry; distinct from full ownership. |
| Prover/verifier keys | Public circuit artifacts. Their integrity matters, but they are not private account keys. |

Use [Account keys and recovery]({{ '/account-keys/' | relative_url }}) for custody
and [Public proving keys]({{ '/keys/' | relative_url }}) for artifact distribution.

## One account operation, end to end

1. **Configure:** choose an exact package version, binding, network and independently
   trusted manifest; inspect checked service capabilities.
2. **Review:** capture validated inputs and the intended account/authority; obtain
   the host's explicit consent before credential or value work.
3. **Authenticate:** obtain only the credential/key capability needed by that
   operation and verify live ownership/sealed keys as required.
4. **Execute:** the injected chain/proof/sponsorship/submission ports perform the
   supported circuit calls. Deployment may span multiple waves.
5. **Observe and retain:** keep transaction references and original invocation IDs,
   reconcile uncertain outcomes, and release the host-owned resources.

Creating an API object starts none of these account actions. Retaining an account
object does not by itself retain an authenticated key session. A local timeout or
lock cannot undo a submitted transaction or revoke on-chain authority.

## Browser, Node and framework integration

The portable account/protocol/key layers accept explicit capabilities. The browser
adapter needs WebAuthn/PRF and the documented WASM/polyfill setup. Node services
need explicit HTTP/filesystem, wallet and prover dependencies. Import support is
different from a ready signer or network.

React is optional. Presentation snapshots and background channels can be wired to
your UI without adopting the demo's DOM or memory lease. React Native and full
Lace integration are not qualified by the browser example. Follow
[Library integration]({{ '/library-guide/' | relative_url }}) to select your boundary.

## Operation modules and validation

The source preview keeps the connector as a composition root. JubJub binding/capability
checks, sealed readiness, grant operations and private holdings live in separate
internal modules. Their contexts are typed capabilities; public method signatures,
key-session descriptors and transaction ordering remain the integration contract.
Hosts continue importing the public package entries rather than internal helpers.

The Node reference host validates confirmation JSON after a bounded stream read,
then checks the protocol era, transaction hash and every original prepared identifier.
Malformed, oversized, aborted or incomplete observations remain unknown. Read failure
never authorizes a replacement mutation ID or an automatic transaction retry.
These are reference-service boundaries, separate from the portable account domain.

## Choose your next task

| Task | Guide |
| --- | --- |
| Build the first browser integration | [Install and connect]({{ '/getting-started/' | relative_url }}) |
| Supply wallet-owned credentials and transaction ports | [Library integration]({{ '/library-guide/' | relative_url }}) and [Account API]({{ '/api/' | relative_url }}) |
| Operate proof, sponsor or funding infrastructure | [HTTP service API]({{ '/service/' | relative_url }}) |
| Run the example application | [Reference demo]({{ '/demo-guide/' | relative_url }}) |
| Check supported behavior before adoption | [RC8 limitations]({{ '/release-notes-rc8/' | relative_url }}) and [qualification]({{ '/qualification/' | relative_url }}) |

## Source follow-up: operation and host composition

The P-256 account factory composes observation, transfer, private-access and grant
operations behind the existing public facade. Contexts retain captured factory
references and identify the optional ports whose lookup must remain live across
awaits. Splitting modules does not start another credential scope or transaction.

The reference app separately composes typed action controllers and presentation
models. Button availability, Activity/Audit and account/wallet facts have focused
renderers; the main app owns consent, receipts and lifecycle policy. These DOM
controllers are an application example, not a framework dependency of the SDK.

The Node reference boundary uses actual v9 types while resolving runtime modules
from the same reference tree as its wallet. Its journal decoder retains the
existing constructor bytes, signing key and deployment waves on resume. See the
[decomposition review map](https://github.com/input-output-hk/midnight-passport-sdk/blob/passport-acc-prototype/docs/review/quality-debt-2026-11-10.md)
for the module map and qualification limits.
