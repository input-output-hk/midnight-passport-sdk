---
layout: default
title: Preview RC7 candidate
permalink: /release-notes-rc7/
---

## 0.1.0-rc7 — preparation, not publication

This is the next preview release candidate for Lace and other partner evaluation.
**RC6 remains published** until the signed release, private package versions,
image digests and publication receipt are verified. Follow
[#282](https://github.com/input-output-hk/midnight-passport-sdk/issues/282) for that gate.
The planned release contains the same nine implemented packages and three backend
images; no empty scaffold or additional package is introduced.

## Changes since RC6

- Shielded-deposit continuations retain the original request, sealed entry and
  observed transaction across journal/observation failures. Unknown outcomes do
  not create a replacement send. Reviewed host examples separate fresh consent,
  preparation, status and reconciliation; caller `Buffer` inputs are owned copies
  and malformed-hex diagnostics no longer disclose an input prefix.
- The contract package exports a verified Compact compiler dependency for an
  application calling an existing ACC. A constructor-pinned merchant example uses
  a caller-bound JubJub unshielded grant. Its local native receipt records one
  proof-backed composed payment with recipient credit and seven construction
  refusals. It does not establish malicious-proof rejection or node rollback.
- A generated inventory distinguishes all **52 proof circuits and 66 pure helpers**
  from supported typed flows and evidence. Advisory account configuration checks,
  operation proof/helper requirements and bounded key-endpoint profile inspection
  help hosts identify missing setup before ceremonies. Metadata is not readiness.
- Public-signer qualification includes actual Chromium origin/port/descriptor,
  cancellation, expiry, navigation and explicit reconnect boundaries with virtual
  credentials and a fake chain. Native public-host/source receipts remain separate
  from that browser tier and from actual provider acceptance.
- WebAuthn adapters gain an optional typed `beforeCeremony` hook. It explains or
  refuses actual creation, verification, identification, PRF derivation and P-256
  signing accesses, including profile retries. Frozen metadata contains no key
  material. Existing clients remain compatible when the hook is omitted.
- Every key-using demo action receives an initial operation review; creation
  requires acknowledgement of permanent maintenance-authority retirement.
  Subsequent purpose notices remain visible while scrolled, cross a rendering
  opportunity before credential access, and retain the separate exact transaction
  reviews. Cancellation no longer claims earlier submissions never happened.
- The demo exposes advisory proof plans and links partner recipes. A dedicated
  Playwright lane exercises all existing action buttons across both owner-arm
  selections, including declined review, malformed/wrong-network destinations,
  stale roster, exact-review cancellation, revoked grant, service outage and
  retained unknown request IDs. Its account/chain/wallet drivers are synthetic.
- Engineer documentation now maps use cases to API, demo, tests, evidence and
  limitations. An opt-in Node/V8 report measures loaded package JavaScript;
  quantitative coverage does not replace browser/native/provider qualification.

## Binding, keys and version axes

The release retains `acc-s3r1.1`, Passport source `6458ed5`, Compact `0.35.0`,
runtime `0.20.0` and compiler manifest:

```text
77fb9c17b0d59047456c43115d9a58f5cb99a226ee73b6b974fd724930c3153f
```

Verifier/ZKIR distribution, SHA-256 prover pins and deterministic restoration
remain unchanged. No account upgrade, key-recipe change, P-256→JubJub migration
or new total-loss recovery binding is silently applied. `0.1.0-rc7` is a package
preview version; it is not a new ACC schema or claim that every raw circuit is
available through the typed account API.

## Evaluation and installation

After publication is verified, install exact matching `0.1.0-rc7` versions through
the private GitHub Packages registry. The [installation guide]({{ '/getting-started/' | relative_url }})
describes scoped registry configuration and access credentials outside source.
The [package map]({{ '/packages/' | relative_url }}) explains which layers a partner
needs; using the contract/assets does not require replacing its orchestration.

For the repository demo, read `AGENTS.md`, prepare the existing private funding
configuration and use `nix develop -c pnpm demo up --funding`. A development-only
mock or `--arm jubjub` may be selected explicitly. Run synthetic browser journeys
without a running chain using `nix develop -c pnpm test:demo-browser` after a build.
See [consent]({{ '/consent/' | relative_url }}) and
[the use-case evidence map]({{ '/use-case-coverage/' | relative_url }}).

## Known limitations and deferred work

| Area | Preview boundary / follow-up |
| --- | --- |
| Shielded withdrawal | Exact-value selected coins only; partial spends/change remain rejected (#201) |
| Recovery and device removal | A surviving enrolled credential can open a known ACC. No total-loss recovery (#240) or complete compromised-key revocation guarantee (#229) |
| Session authority | Operation-scoped PRF reuse is not unrelated concurrent-operation isolation (#245). Local expiring JubJub session grants are proposed separately (#281 / 0.2.0), not another unrestricted owner |
| Host interoperability | Public-source/native/browser receipts cover their declared subsets; no full Lace integration or production signer-page claim (#81/#242/#272) |
| Providers | Synthetic passkeys and virtual Chrome credentials do not qualify Google/iCloud sync, restoration or every browser/provider (#232) |
| Durable effects | Default demo owner actions retain the original composition. Opt-in journals/jobs do not authorize replay of an unknown send; operator fencing/rollback policy remains explicit (#230/#269) |
| Assets and networks | NIGHT funding is qualified on the standalone `undeployed` network only; additional networks/assets require separate acceptance (#243) |
| Merchant recipe | One configured verified payer ACC and JubJub unshielded grant; disclosed forwarding fields, not arbitrary contract acceptance or a production privacy protocol (#275) |
| Images | Intended backend publication remains Linux/amd64. Actual release digests/startup checks must be recorded before this page claims publication |

Concrete fund-loss, broken-installation or artifact-integrity regressions block
publication. Open feature/interoperability issues remain documented limitations of
this supported-subset preview rather than an implicit promise of a complete product.
