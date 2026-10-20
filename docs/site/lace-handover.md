---
layout: default
title: Lace evaluation handover
permalink: /lace-handover/
---

## RC5 evaluation scope

`0.1.0-rc5` is a published preview. The [release announcement](https://github.com/input-output-hk/midnight-passport-sdk/releases/tag/sdk-v0.1.0-rc5)
links exact package hashes, immutable image digests and verification evidence.
This preview lets Lace engineers evaluate the pinned Passport ACC binding, portable account
flows and remote service seams. It does not promise full compatibility with Lace's hosted
creation, sign-in, device consent or value-bearing wallet routes.

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

Scope configuration (keep the token value outside the file):

```ini
@input-output-hk:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}
```

Install the exact preview version:

```sh
npm install --save-exact @input-output-hk/mn-passport-contract@0.1.0-rc5
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

See [RC5 release notes]({{ '/release-notes-rc5/' | relative_url }}),
[limitations](https://github.com/input-output-hk/midnight-passport-sdk/blob/passport-acc-prototype/docs/prototype/limitations.md) and
[releasing]({{ '/releasing/' | relative_url }}) for the release boundary.

## Device/recovery scope clarification (2026/10/20)

The retained binding supports entry removal with SDK roster/delivery checks, not
complete compromised-key revocation. Total-loss recovery is not exposed; the
legacy finaliser must not be used as a full-retirement fallback. The next local
stability slice adds qualification receipts and a JubJub read-grant exclusion
refusal; that code is not part of the published RC5 packages. See
[Qualification and safety boundaries]({{ '/qualification/' | relative_url }}).
