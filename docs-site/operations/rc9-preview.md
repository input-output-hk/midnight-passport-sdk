# RC9 candidate: hardening and release validation

**Status: preparation, not published.** The current install remains
[`0.1.0-rc8`](/getting-started/installation). This page describes the proposed
`0.1.0-rc9` increment after the merged signing/funding and quality work.
[Release tracker #311](https://github.com/input-output-hk/midnight-passport-sdk/issues/311)
records the actual acceptance and publication state.

## Changes since RC8

- Browser/account adapters add an opt-in PRF-only JubJub creation profile and an
  explicitly approved routine reader/wallet-key handoff. The direct P-256 profile
  and its strict signing/enrollment checks are preserved.
- The demo compares `passkey` and `jubjub` signing modes and keeps repeated
  NIGHT/custom-token funding availability separate from an operation's busy state.
- Account operations, demo controllers/presentation and the native reference
  boundary have focused modules. Bounded JSON/decimal admission rejects malformed
  or oversized observations before expensive conversion/ledger decoding.
- The developer site now uses VitePress with separate library and demo paths.
  Release checks exercise the installed package graph without borrowing workspace
  outputs or silently accepting unknown runtime feature-probe files.

There are still nine published-package candidates and three backend images.
Binding `acc-s3r1.1`, Passport source `6458ed5`, Compact `0.35.0`, runtime `0.20.0`
and the existing key derivation recipes remain unchanged. Framework choice and
host consent/persistence/wallet policy remain the consumer's responsibility.

## Supported use cases and boundaries

| Scenario | Public SDK surface | Reference host choice | Evidence to require |
| --- | --- | --- | --- |
| Create, log in and reopen by address | Account/browser adapters, credential/key and chain ports | Explicit retirement choice, canonical origin and verified routine adoption | Both signing arms; cancellation/wrong credential/no-PRF; declared native/provider tier |
| Read ACC state and private holdings | Account state/holdings and verified reader/indexer ports | Public refresh vs routine reader lease | Live state/commitment checks; incomplete/stale data refusal |
| Fund an ACC | Authenticated service/faucet adapter and value-capable backend | Allowlisted standalone funding wallet; fixed bounded deposits | NIGHT/custom token, repeated deposits, same-ID uncertain-result handling |
| Withdraw or use a bounded grant | Account methods and supported grant/value ports | Exact recipient/asset/caps/expiry; fresh critical approval | Positive/refused scope, expiry/revoke/unknown outcomes; no owner fallback |
| Manage devices, grants and viewing keys | Optional owner methods and complete live rosters/openings | Fresh owner review and retained operation evidence | Enrolled survivor and reader preservation, declared interruption windows |
| Connect a separate Midnight wallet | Wallet adapter/host ports | Lazy worker startup and independent balance refresh | No automatic ACC authority; stale/failed read and cleanup controls |

A distributed circuit or a compiling port is not a qualified product flow. The
[package API map](/packages/api), [authorization guide](/guides/authorization) and
[testing tiers](/operations/quality) explain the reusable contract separately from
[the demo's behavior](/demo/signing-activity).

## Limits retained

- Shielded withdrawal still requires an exact-value coin; partial spend/change is refused.
- Login does not automatically enroll another owner, issue a grant or connect a wallet.
  Critical operations require fresh approval; a scoped transfer remains within its
  separately approved bounds. Local key disposal does not revoke on-chain authority.
- Device-entry removal is not complete compromised-key revocation. Total-loss and
  cross-provider credential recovery are not qualified features.
- Real Google/iCloud prompt counts, full Lace adoption, native merchant
  application→ACC atomicity, all-circuit typed coverage and wider networks are not claimed.
- The default demo and opt-in durable host composition have different guarantees.
  Preserve unknown original IDs; timeout or missing local records is not no-send evidence.

## Before RC9 becomes the current install

Freeze a GPG/DCO-signed candidate, pass the full source/coverage/browser gates and
independent review, then verify its exact installed packages and changed native
bridge. Check valid Linux-prepared mounted service/funding functionality separately
from image build and startup-refusal tests. Verify actual private registry visibility,
SHA-256/SRI and source/publisher attestations, three image digests, public key
HTTP/hash/restore behavior and deployed documentation. Publish a signed receipt
before updating the current-version instructions. Older receipts keep their original pins.
