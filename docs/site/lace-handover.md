---
layout: default
title: Lace evaluation handover
permalink: /lace-handover/
---

## Current RC9 handover

Use the [RC9 handover](../release/rc9-lace-handover.md),
[release notes]({{ '/release-notes-rc9/' | relative_url }}) and
[signed publication receipt](https://github.com/input-output-hk/midnight-passport-sdk/releases/download/sdk-v0.1.0-rc9/rc9-publication-receipt.json).
All nine implemented private packages use `0.1.0-rc9`; three Linux/amd64 images
have immutable pins in that receipt. Package access and host policy are explicit.

RC9 adds opt-in PRF-only JubJub creation/verified creation handoff, safe repeated
funding and bounded native input handling. The SDK remains independently adoptable;
its demo is optional wiring. Native/source, synthetic browser, installed-registry
and mounted/pulled-image evidence retain their own exact identities. No full Lace,
real-provider recovery, partial shielded spend or total-loss recovery is claimed.

<span id="current-rc7-handover"></span>

<span id="current-rc8-handover"></span>

## Historical RC8 handover

Use the [RC8 release](https://github.com/input-output-hk/midnight-passport-sdk/releases/tag/sdk-v0.1.0-rc8),
[installation guide]({{ '/getting-started/' | relative_url }}) and
[RC8 limitations]({{ '/release-notes-rc8/' | relative_url }}).
All nine implemented packages are private GitHub Packages at `0.1.0-rc8` (`next`);
three public Linux/amd64 images have immutable pins in the
[signed publication receipt](https://github.com/input-output-hk/midnight-passport-sdk/releases/download/sdk-v0.1.0-rc8/rc8-publication-receipt.json).

Adopt the contract/assets, helpers or adapters at the boundary your host needs;
our demo orchestration is optional. RC8 adds checked input admission,
`account/authorisation`, optional secret custody/background ports, combined verified
login and bounded grants. Hosts still own consent, credentials, persistence,
transaction routing and finality. A Lace Wallet connection is separate from ACC
permission; no automatic ownership follows.

Binding remains `acc-s3r1.1`, Passport `6458ed5`, Compact0.35.0, runtime0.20.0.
Exact-value shielded withdrawals remain guarded. No partial spends, total-loss
recovery, complete compromised-key revocation or full Lace/provider compatibility
is claimed. Original issuing readers are needed for grant bookkeeping recovery.
Page-memory full-owner keys retain durable authority if copied; local expiry is
not chain revocation. Explicitly scoped JubJub children have independent caps/expiry.

Actual registry install, package provenance/hashes, synthetic browser, image startup
and key HTTP/regeneration are separate checks. Historical native/host qualification
below keeps its original pins; it is not a fresh RC8-image/provider run. See the
[use-case map]({{ '/use-case-coverage/' | relative_url }}) and
[library guide]({{ '/library-guide/' | relative_url }}) for integration boundaries.

## Historical RC6 evaluation and host qualification

[RC6 release status]({{ '/release-notes-rc6/' | relative_url }}) adds opt-in owner/
host continuations, original-reader grant reconstruction, reduced key-profile
verifier coverage and installed-package interruption checks. Use the matching
account, client and backend versions; do not mix the new job client with an older
server. Keep host-native consent and orchestration for flows the hosted signer
does not support. These additions do not requalify the older host version below
or establish full Lace/provider compatibility. Use the [signed publication receipt](https://github.com/input-output-hk/midnight-passport-sdk/releases/download/sdk-v0.1.0-rc6/rc6-publication-receipt.json)
for the historical RC6 installation and image pins. All SDK packages are `0.1.0-rc6`, private
on GitHub Packages. Install only the entrypoints your application imports and
request package read access for each consuming user/repository.

Current local follow-up qualification against `@laceio/sdk@0.1.2-canary.2` is
[documented separately]({{ '/consumer-integration/' | relative_url }}#current-published-host-and-rc6--20261030).
It requires the explicit consent and JubJub-grantee adapters; raw authoriser and
wider host grant scopes are not drop-in assignments. This does not change the
RC6 artifacts or qualify full Lace/provider behaviour.

The local native follow-up also passed fourteen public-module cases with nineteen
canonical finalized transactions: create/activate, populated grant issue/rotation,
SDK read/capability/bookkeeping crossover, reconnect and revocation. See the
[native scope and limitations]({{ '/consumer-integration/' | relative_url }}#public-package-native-orchestration-lane).
That historical lane kept SDK transaction ports read-only. A new local lane additionally
passed **20 native cases /20 canonical finalized transactions**, including one RC6
`addJubjubAuthorisingDevice` submission through real public-source signer handlers. Consent
denial made no mutation; reconnect found both authorities and retained the exact holding.
See [public-source signer scope]({{ '/consumer-integration/' | relative_url }}#public-source-signer-handlers).
This adds signing authority only, with no reader/viewing-key delivery. Window routing and
credentials are synthetic; creation/grants still use the local host signer. Browser/provider,
full hosted lifecycle, images and full Lace compatibility remain unqualified. RC6 bytes are unchanged.

## Integration guide

This preview lets Lace engineers evaluate the pinned Passport ACC binding, portable account
flows and remote service seams. Full compatibility with Lace's hosted creation, sign-in,
device consent and value-bearing wallet routes remains unqualified.

### What to consume

| Package | Responsibility for a Lace consumer |
| --- | --- |
| `mn-passport-protocol` | Shared account and HTTP request/response types and errors. |
| `mn-passport-keys` | Portable key derivation, signing and sealed device/keyring formats. No browser or wallet-extension dependency. |
| `mn-passport-account` | Account, device, grant and supported transfer flows over injected ports. |
| `mn-passport-adapter-webauthn` | Browser credential, PRF and P-256 authorisation ports. |
| `mn-passport-adapter-midnight-js` | Pinned contract transaction, proving, chain-read and wallet seams. |
| `mn-passport-adapter-service` | Checked configuration, directory, deployer, prover, sponsor and funding HTTP clients. |
| `mn-passport-adapter-browser` | Browser composition and optional hosted JubJub adapter; choose ports matching the consent your host actually grants. |
| `mn-passport-contract` | Versioned binding, packaged ZKIR/verifier inputs and pinned regeneration/integrity manifests. |
| `mn-passport-service` | Node HTTP, funding-policy and persistence primitives used by the backend applications. |

All names use the `@input-output-hk/` scope. Consumers select packages for their ports; they do
not need to import all nine. The demo app and backend applications are separate compositions.
See [package responsibilities]({{ '/packages/' | relative_url }}) and the
[API reference]({{ '/api/' | relative_url }}) before selecting a composition.

### Installation and first check

An administrator must grant your user/team and the consuming Actions repository read access
to the private packages. Configure the scope for `https://npm.pkg.github.com`; supply the token
through your environment or credential manager, never committed source. A developer token
needs `read:packages`; Actions uses its authorised repository token.

User-level authentication configuration (keep the token value in the environment;
project-level environment interpolation is refused by the pinned pnpm):

```ini
@input-output-hk:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}
```

Install the exact preview version:

```sh
npm install --save-exact @input-output-hk/mn-passport-contract@0.1.0-rc7
```

```ts
import { resolveBinding } from '@input-output-hk/mn-passport-contract';
const binding = resolveBinding('acc-s3r1.1');
console.log(binding.manifestSha256);
```

The expected compiler manifest SHA-256 is
`77fb9c17b0d59047456c43115d9a58f5cb99a226ee73b6b974fd724930c3153f`.
For browser runtime use, keep one physical Compact runtime instance, respecting exact peer
versions. The [compatibility matrix](https://github.com/input-output-hk/midnight-passport-sdk/blob/passport-acc-prototype/docs/compatibility.md) specifies the pinned
Lace source and qualified routes; do not widen hosted consent merely to make a generic flow pass.

### Evaluation order

1. Verify package access, binding pin and runtime identity in a clean consumer.
2. Exercise localnet create/open using a supported key-origin composition. Start from the
   repository's `pnpm demo check`, `pnpm demo setup` and `pnpm demo up` under `nix develop`;
   the setup needs the pinned upstream contract checkout and roughly 15 GB of key space and at least 24 GiB allocated to Docker for P-256 proofs.
3. Compare your hosted integration with the exact-source tests and limitations, especially
   local versus remote key origin, authorising-only enrollment and sealed registration decoding.
4. Test funding and withdrawals only with disposable localnet accounts. Inspect operation
   logs and chain-confirmed balances, and reuse the request ID after an uncertain funding result.
5. Capture source/package versions, network, binding, circuit, transaction IDs and redacted
   request/response events when reporting a problem. Never include PRF outputs, wallet seeds,
   passkey secrets, grant capability openings or private proof inputs in a shared trace.

### Backend artefacts and limits

The `midnight-passport-keys` image restores/verifies and serves circuit artefacts. The
`midnight-passport-service` image proves/deploys/sponsors fees; the
`midnight-passport-funding` image transfers allowlisted wallet-held assets into an ACC.
The latter two need a Linux-prepared pinned contract mount and persistent writable state.
Their images contain no sponsor seed or full prover-key cache. Keep ingress controlled;
CORS alone does not authenticate callers. The proving service sees private proof inputs in
this prototype. Non-localnet operation requires dedicated wallets and explicit operator policy.

Shielded withdrawals require an exact-value selected coin; partial spends/change recovery
remain #201. Full typed circuit coverage remains #82, and outstanding live/value-host evidence
remains #202. NIGHT funding is qualified only for `undeployed`. The pinned Lace decoder supports
JubJub registration records; SDK P-256 registration records are an extension. Synthetic test
credentials do not establish real provider/browser compatibility or recovery after every
recoverable passkey is lost.

See [RC6 release notes]({{ '/release-notes-rc6/' | relative_url }}),
[limitations](https://github.com/input-output-hk/midnight-passport-sdk/blob/passport-acc-prototype/docs/prototype/limitations.md) and
[releasing]({{ '/releasing/' | relative_url }}) for the release boundary.

## Device/recovery scope clarification (2026/10/20)

The retained binding supports entry removal with SDK roster/delivery checks, not
complete compromised-key revocation. Total-loss recovery is not exposed; the
legacy finaliser must not be used as a full-retirement fallback. RC6 includes
qualification receipts and a JubJub read-grant exclusion refusal. See
[Qualification and safety boundaries]({{ '/qualification/' | relative_url }}).

### Evidence for the next integration slice

The [consumer integration guide]({{ '/consumer-integration/' | relative_url }})
separates current source, published-entry and localnet evidence and describes the
explicit host adapters. RC6 publishes the reduced-profile verifier correction and
opt-in stability APIs. Actual Lace and real-provider acceptance remain separate
work, with earlier RC5 evidence retained as historical.
