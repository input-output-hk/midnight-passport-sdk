---
layout: default
title: Reuse Passport in an application
permalink: /partner-integration/
---

## Choose the layer you need

The SDK supplies reusable Passport account components for Lace and other partners.
A partner may use the contract and proving assets while retaining its own account
orchestration, or compose the higher-level account APIs with its own ports. The
existing [package map]({{ '/packages/' | relative_url }}) identifies those layers.
There is no requirement to install every adapter or replace a host's UI and consent
policy. Upstream Passport defines the contract behavior.

| Need | Reusable components | Your application supplies |
| --- | --- | --- |
| Call an existing supported ACC | `contract`: generated module, declarations, inventory and pinned assets | ACC address, a compatible client/prover and valid authorization for the operation |
| Build a Compact contract that calls ACC | Contract package's compiler dependency export, described below | Your application circuit and its own deployment/proving assets |
| Create/open/manage a supported account | `account`, `keys`, selected adapters | Persistence, key origin, network, consent and supported host services |
| Host proving assets | Contract restore command and key-service image | Verified persistent cache, resource limits and deployment policy |
| Sponsor or fund operations | Optional service/client composition | Explicit fee-only versus value-wallet policy and supported network configuration |

## Which contract calls which?

**Application → ACC** is a useful integration model. Your application circuit
calls a supported operation on the user's deployed ACC. Your contract constrains
the business action; the ACC verifies the signature, freshness and grant scope
and retains custody of the user's assets.

**ACC → application** is a separate option for custom account builds whose circuits
call an application. It requires the outgoing call in that account build, matching
assets and consent, and an explicit deployment/maintenance decision. It is not a
prerequisite for consuming these packages.

The client executes and proves the composed call tree before submission. Importing
a generated module into a client does not copy an existing ACC's ledger. Including
ACC source in another Compact contract creates different contract logic, not
authority over an existing user's ACC. Proving keys are not spending credentials.

Upstream records both [ACC-as-callee experiments](https://github.com/midnightntwrk/passport/blob/fc19e471536febb2133f20e817847251622dcdf5/experiments/cross-contract-calls/README.md)
and [caller-bound grant spends](https://github.com/midnightntwrk/passport/blob/fc19e471536febb2133f20e817847251622dcdf5/contract/GRANTS-CALLER.md).
Those recorded upstream runs do not qualify a new SDK integration by themselves.

## Compiler dependency export — RC7

`mn-passport-export-compact` is published in RC7 under
[#275](https://github.com/input-output-hk/midnight-passport-sdk/issues/275).
It is **not in the older `0.1.0-rc6` package**. Install the exact `0.1.0-rc7`
contract package and verify the signed publication receipt.

From a consumer with the RC7 `mn-passport-contract` package installed and the
repository's pinned Nix shell active:

```sh
pnpm exec mn-passport-export-compact \
  --binding acc-s3r1.1 \
  --manifest-sha256 77fb9c17b0d59047456c43115d9a58f5cb99a226ee73b6b974fd724930c3153f \
  --output "$PWD/passport-dependency"

compact compile --skip-zk \
  --compact-path "$PWD/passport-dependency" \
  merchant.compact "$PWD/merchant"
```

The output parent must exist and the selected output must be new. Export produces
`account/compiler`, `account/contract`, `account/keys` and `account/zkir`, plus a
receipt. It verifies the independently pinned compiler manifest, generated module,
declarations, contract metadata and all 52 circuits' bundled inputs before writing.
It includes verifier keys and ZKIR, not the large prover keys or upstream sources.
It never imports the generated code during export or changes a deployed account.

Changed/missing/extra bundled inputs and existing destinations refuse. The compiler
visible `account` directory appears only after checked writes complete; an I/O
failure may leave a retained incomplete output. Do not use or overwrite it. An
export receipt records file identity; it is not publisher provenance or proof that
an arbitrary on-chain address runs that build. Verify installed package provenance
and deployed operation keys independently.

`--skip-zk` is compilation/debugging only. Native proving needs the application's
own generated keys plus the ACC proving keys from the verified restore/cache path.
This example uses default v2 encoding for the caller: the pinned v3 backend cannot
forward curve-point arguments. Both sides use Compact 0.35.0/runtime 0.20.0.

## Reference merchant application

The [application example](https://github.com/input-output-hk/midnight-passport-sdk/tree/passport-acc-prototype/examples/application-acc)
contains the Compact source, a client preparation helper and an executable offline
consumer check. Use the matching `sdk-v0.1.0-rc7` source example.

Its deployer configures **one verified ACC**, an asset, a decoded merchant
`UserAddress`, a positive price and payment capacity. `pay(approval)` invokes that
ACC's `withdraw_unshielded_with_grant_jubjub` with the configured amount/recipient
and advances its own counter. A capacity refusal occurs after the nested call, to
exercise composition failure. The example is deliberately a terminal for one
configured ACC; it is not an unrestricted merchant accepting arbitrary contract
implementations by structural interface alone.

The owner issues a grant to a separate JubJub holder, pinning the merchant contract
as caller and the intended asset/recipient/caps. The client helper reads the actual
merchant policy and live grant, checks the caller commitment, requests explicit
review, rereads for changes and prepares a signature. It submits nothing. The host
must preserve the original operation/transaction evidence and verify both payment
and application state before reporting success. Never treat a timeout as no send.

### Security boundaries

- Check the deployed ACC module/operation keys and maintenance policy before
  configuring the application; a circuit name/interface is not proof of semantics.
- Use decoded `UserAddress.bytes`, not a wallet signing public key.
- A caller pin checks the immediate claiming contract address. It does not replace
  the grantee signature or identify the browser, transaction root or calling circuit.
  Review the application's claim/forwarding policy and any upgrade authority.
- The signature approves this withdrawal's payload. It does not approve unrelated
  order ownership, arbitrary business arguments or a generic login/authentication.
- The reference forwards disclosed authorization/scope fields. It is not a
  privacy-preserving production dApp or a shielded/witness composition recipe.
- The supported high-level holder arm here is JubJub. P-256 owner flows and other
  distributed circuits retain their separate support status.

## Recorded local native result — 2026-11-05

The [redacted native receipt](https://github.com/input-output-hk/midnight-passport-sdk/blob/passport-acc-prototype/docs/review/partner-contracts/native-acceptance.json)
records signed source `eb240f6` and four installed candidate packages at
`0.1.0-dev.20261105.merchant.5`. Until this local tranche is merged, use that
receipt in the reviewed checkout. This is not a new published release.

The proof-backed composed payment credited a fresh merchant wallet **4 base units
of NIGHT**, changed the reused ACC from 8 to 4 and incremented the merchant count
once. Six transactions reached canonical finality. Wrong caller, invalid signature,
module-fingerprint substitution, replay, revocation, indexed-chain expiry and the
business guard after the ACC sub-call refused during construction. Full serialized
ACC/both-merchant snapshots remained unchanged; those cases sent no transaction
and prove no malicious-proof bypass or node rollback behavior.

A preceding payment was already successful (ACC12→8, original merchant1,
recipient4), but its live balance observation timed out. The failed full suite was
preserved and reconciled read-only. The passing continuation used a new merchant,
grant, recipient and payment intent; it did not repeat that successful payment or
fund the ACC again. A wallet timeout is not evidence of no send. Software wallet
reconnect is not passkey-provider recovery or full Lace compatibility. The exact
binding, caller-only key hashes and installed-byte audit are in the review map.

## Acceptance and next steps

Fast export and payment-preparation guards belong in required CI. Actual compiler
and installed-package execution are a separate local/opt-in lane. Offline execution
checks generated ACC constraints and candidate state changes with software keys;
it does not establish node admission or native rollback. Native proof/node and real
provider acceptance remain pending unless explicitly recorded for the exact build.

The [adoption execution plan](https://github.com/input-output-hk/midnight-passport-sdk/blob/passport-acc-prototype/docs/partner-adoption-plan.md)
orders remaining work: real consumer adoption, precise capabilities, consent and
recovery, reproducible operations and provider qualification. RC8 is the current published preview; exact-value shielded withdrawals, entry-removal and total-loss recovery
limitations remain unchanged. See [qualification]({{ '/qualification/' | relative_url }})
and [consumer integration]({{ '/consumer-integration/' | relative_url }}).
