---
pageClass: comparison-page standards-page
---

# Standards and upstream design

Read normative text at its source. The proposal statuses use the [canonical repository at `02fce36`](https://github.com/midnightntwrk/midnight-improvement-proposals/tree/02fce36cfa44541305310dc25fd38f399dbe8d92) and the [MIP-0033 Draft at `4a85a87`](https://github.com/midnightntwrk/midnight-improvement-proposals/blob/4a85a87b4e4c5d59ee88a5786a8ecb11f5dc5c6f/mips/mip-0033-scoped-grants.md). The [conformance map](/architecture/conformance) records which capabilities have SDK evidence. The SDK's published `0.1.0-rc9` behavior is pinned separately to [its release source](https://github.com/input-output-hk/midnight-passport-sdk/tree/sdk-v0.1.0-rc9) and `acc-s3r1.1` binding.

| Document | Problem addressed | SDK capability | Implementation boundary |
| --- | --- | --- | --- |
| [MIP-0012 · native asset custody](https://github.com/midnightntwrk/midnight-improvement-proposals/blob/02fce36cfa44541305310dc25fd38f399dbe8d92/mips/mip-0012-native-asset-custody.md) (Proposed) | Contract holds Midnight-native assets | ACC deposit/withdraw binding | Exact supported circuits and asset paths only; shielded withdrawal needs exact-value coin. |
| [MIP-0013 · account authorisation](https://github.com/midnightntwrk/midnight-improvement-proposals/blob/02fce36cfa44541305310dc25fd38f399dbe8d92/mips/mip-0013-account-authorisation.md) (Proposed) | Multi-key account authority | P-256/JubJub owner and device flows | ACC enrollment and host consent are separate checks. |
| [MIP-0015 · wallet-derived deterministic secrets](https://github.com/midnightntwrk/midnight-improvement-proposals/blob/02fce36cfa44541305310dc25fd38f399dbe8d92/mips/mip-0015-wallet-derived-deterministic-secrets.md) (Proposed) | Reproducible secret derivation | PRF/key recipes in `keys` | Provider must restore the credential and PRF outputs; no universal recovery guarantee. |
| [MIP-0020 · prover-key regeneration](https://github.com/midnightntwrk/midnight-improvement-proposals/blob/02fce36cfa44541305310dc25fd38f399dbe8d92/mips/mip-0020-prover-key-regeneration.md) (Proposed) | Restore prover keys from bundled ZKIR | Contract package and restore CLI | Public artifacts need independent manifest/hash verification and a persistent cache. |
| [MIP-0021 · domain separation](https://github.com/midnightntwrk/midnight-improvement-proposals/blob/02fce36cfa44541305310dc25fd38f399dbe8d92/mips/mip-0021-domain-separation.md) (Proposed) | Separate cryptographic uses by domain | Reader, wallet, owner, and session derivations | Use the pinned recipe and binding; a domain label is not itself proof of broad conformance. |
| [MIP-0022 · account recovery](https://github.com/midnightntwrk/midnight-improvement-proposals/blob/02fce36cfa44541305310dc25fd38f399dbe8d92/mips/mip-0022-account-recovery.md) (Proposed) | Recovery paths for custody accounts | Existing-device removal and known-address opening | Lost-all-credentials recovery is not implemented by the released SDK. |
| [MIP-0030 · ECDSA account authorisation](https://github.com/midnightntwrk/midnight-improvement-proposals/blob/02fce36cfa44541305310dc25fd38f399dbe8d92/mips/mip-0030-ecdsa-account-authorisation.md) (Draft) | ECDSA/P-256 authority | Supported browser P-256 signing and registration | Exact assertion/profile support and provider qualification are bounded. |
| [MIP-0007 · name service](https://github.com/midnightntwrk/midnight-improvement-proposals/blob/02fce36cfa44541305310dc25fd38f399dbe8d92/mips/mip-0007-name-service-registry-and-resolver.md) (Proposed) | Canonical names and resolution | Checked naming port and standalone Midnames demo | An online registry, namespace and recovered name authority need separate evidence. |
| [MIP-0033 · scoped grants and dApp connection](https://github.com/midnightntwrk/midnight-improvement-proposals/blob/4a85a87b4e4c5d59ee88a5786a8ecb11f5dc5c6f/mips/mip-0033-scoped-grants.md) (Draft at this pin) | Scoped delegation and dApp connection | Supported grant operations and bounded browser/agent source flows | The browser and agent routes have profile-specific limits and need separate interoperability evidence. |

Relevant problem statements include [MPS-0018 · multi-key custody](https://github.com/midnightntwrk/midnight-improvement-proposals/blob/02fce36cfa44541305310dc25fd38f399dbe8d92/mps/mps-0018-asset-custody-model.md), [MPS-0027 · domain separation](https://github.com/midnightntwrk/midnight-improvement-proposals/blob/02fce36cfa44541305310dc25fd38f399dbe8d92/mps/mps-0027-domain-separation.md), and [MPS-0039 · contract artifacts](https://github.com/midnightntwrk/midnight-improvement-proposals/blob/02fce36cfa44541305310dc25fd38f399dbe8d92/mps/mps-0039-lightweight-contract-interaction.md). [MPS-0012](https://github.com/midnightntwrk/midnight-improvement-proposals/blob/02fce36cfa44541305310dc25fd38f399dbe8d92/mps/mps-0012-account-aliasing.md) discusses human-readable aliases. These are context, not an SDK feature checklist.

The [earlier Passport scoped-grants text](https://github.com/midnightntwrk/passport/blob/e0e4e0e6272399d71dfaaa7cae0689ab4e2363f3/docs/mps-mip/mips/mip-xxxx-scoped-grants.md)
is the historical draft used for some source wire profiles. The numbered Draft
above is the canonical comparison point for future adoption. Verify exact
request and proof bytes before changing an existing wire profile.

The application-contract integration calls into a deployed ACC. The calling
contract supplies its own claim policy, and the grantee signature and ACC grant
checks still apply. The [reference caller-bound design](https://github.com/midnightntwrk/passport/blob/e0e4e0e6272399d71dfaaa7cae0689ab4e2363f3/contract/GRANTS-CALLER.md)
describes this call direction.

For the wider design, use [upstream Passport architecture](https://midnightntwrk.github.io/passport/), its [plan](https://midnightntwrk.github.io/passport/site/plan.html), [planning documents](https://github.com/midnightntwrk/passport/tree/e0e4e0e6272399d71dfaaa7cae0689ab4e2363f3/docs/plans), and [MIP mapping](https://github.com/midnightntwrk/passport/blob/e0e4e0e6272399d71dfaaa7cae0689ab4e2363f3/docs/plans/MIPS.md). The [upstream SDK](https://github.com/midnightntwrk/midnight-passport-sdk) and this fork have different release and qualification histories.

## Dormant account recovery

The source-preview regression reproduces a limitation in the published
`acc-s3r1.1` binding. If an account is recovered before its initial activation,
the original JubJub or P-256 device can still open the retained bootstrap
commitment after finalisation. The test uses generated contract code and
software keys. The upstream finaliser clears the commitment when it installs
the successor. Applying that change to an existing deployment requires
checking its verifier, current ledger state and maintenance authority.
[Upstream recovery analysis](https://github.com/midnightntwrk/passport/blob/8f635a10dde17d55d26bb72439a3a23e6e159295/contract/DORMANT-RECOVERY.md)
