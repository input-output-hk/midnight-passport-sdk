---
layout: default
title: Preview RC4 release notes
permalink: /release-notes-rc4/
---

## 0.1.0-rc4 preview scope

This release contains the nine implemented `@input-output-hk/mn-passport-*`
packages on GitHub Packages and three Node container images: keys, service,
and funding. All packages share one version and the `acc-s3r1.1` binding from
Passport source revision `6458ed5`. The pinned Compact compiler manifest SHA-256
is `77fb9c17b0d59047456c43115d9a58f5cb99a226ee73b6b974fd724930c3153f`.
Prover keys are restored from the packaged ZKIR and checked against the committed
key manifest; they are not included in npm tarballs.

The account API supports the implemented P-256 and JubJub account, device,
viewing-key, grant, and owner call paths through injected host ports. The
browser, service, and Midnight adapters compose those ports; the Node images
serve pinned keys, proving and sponsorship routes, and wallet-backed ACC
funding respectively. The funding image needs its own dedicated wallet and
persistent state. Deploy the proving service behind a controlled ingress.

## Withdrawal safety boundary

Shielded owner withdrawal binds one qualified, chain-matched coin and its
Merkle index to the authorisation and proof witness. **The requested amount
must equal that coin's value.** A partial spend is rejected before signing;
the SDK does not capture or republish change. Use a v9 value-capable wallet
through `createMidnightWalletPorts` to balance and submit this call. The remote
Passport sponsor is fee-only and rejects shielded offers before proving.
A live P-256 exact-value withdrawal passed on the pinned localnet. A JubJub
live proof and Lace-hosted value route have not been validated.

## Compatibility and deferred work

The [compatibility matrix](https://github.com/input-output-hk/midnight-passport-sdk/blob/passport-acc-prototype/docs/compatibility.md)
pins the binding, runtime, API versions, and Lace source check. The source
check compiles against Lace PR #2845 at `cdfa9cfd81a0adcc0a7224aa624f18e52494f602`;
it does not establish full Lace compatibility or a Lace-hosted runtime flow.
These items are deferred to the next RC:

- [#201](https://github.com/input-output-hk/midnight-passport-sdk/issues/201):
  settle partial-spend change and reconcile spent ACC outputs.
- [#202](https://github.com/input-output-hk/midnight-passport-sdk/issues/202):
  complete the value-capable JubJub proof and Lace-hosted route, witness and consent.
- [#81](https://github.com/input-output-hk/midnight-passport-sdk/issues/81),
  [#80](https://github.com/input-output-hk/midnight-passport-sdk/issues/80), and
  [#79](https://github.com/input-output-hk/midnight-passport-sdk/issues/79):
  prove the packaged SDK inside Lace and finish its host and key seams.
- [#82](https://github.com/input-output-hk/midnight-passport-sdk/issues/82):
  cover all pinned ACC circuits with typed helpers.

The five RC1 scaffold package records remain historical; RC4 publishes only
the nine implemented packages. Installation requires a GitHub Packages token
with `read:packages` and package access. See [Packages]({{ '/packages/' | relative_url }})
and [Releasing]({{ '/releasing/' | relative_url }}).
