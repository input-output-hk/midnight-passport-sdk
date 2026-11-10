# RC9: hardening and release validation

<span id="rc9-candidate-hardening-and-release-validation"></span>


`0.1.0-rc9` publishes nine private GitHub npm packages (`next`) and three public
Linux/amd64 backend images. [Install exact versions](/getting-started/installation).
The [source release](https://github.com/input-output-hk/midnight-passport-sdk/releases/tag/sdk-v0.1.0-rc9),
[private publisher release](https://github.com/input-output-hk/midnight-passport-sdk-publisher/releases/tag/sdk-v0.1.0-rc9)
and [signed publication receipt](https://github.com/input-output-hk/midnight-passport-sdk/releases/download/sdk-v0.1.0-rc9/rc9-publication-receipt.json)
record actual source, package SHA-256/SRI, access, attestations and image digests.

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

The package set remains nine implemented libraries and three backend images.
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

## Images

Use matching versions and immutable digests. Linux-prepared pinned contract
mounts and deliberate wallet, state and operator policy remain required.

| Image (`ghcr.io/input-output-hk/`) | Digest |
| --- | --- |
| `midnight-passport-keys:0.1.0-rc9` | `sha256:c3d50d885a05e12ea9b360b8bce4be568936185261e0a38016380d9a4e658729` |
| `midnight-passport-service:0.1.0-rc9` | `sha256:4175aadf1759c195f248175a0278c2c623833df79326a6c7a0aad891d3564543` |
| `midnight-passport-funding:0.1.0-rc9` | `sha256:be7b55b9772d71fc142b76b9ab5915d9841b834c88542ae5ecbf965cf5161647` |

<span id="before-rc9-becomes-the-current-install"></span>

## Verification scope

Verified all nine actual registry packages: private visibility, exact `0.1.0-rc9`/`next`, SHA-256/SRI, source-equivalent archive contents and 18 source/publisher attestations. A fresh registry consumer passed public imports, strict Node/DOM/Worker examples, six software/generated-contract crypto cases, eight synthetic interruption cases, a browser build and single-circuit restore/export, with unchanged installed inputs and temporary auth removed.

Source-native qualification passed 28 populated lifecycle cases across P-256/JubJub, including six original-operation resumptions. The actual pulled Linux/amd64 service/funding images passed create/activate/read/reopen, NIGHT deposits from 0→10→20 smallest units, same-ID replay without extra credit and an unavailable-token refusal before submission. That image flow used a source SDK client and synthetic JubJub credentials; it is separate from registry-installed native or job-backed image interruption qualification. Key HTTP checks verified all 52 verifier hashes, selected prover/range bytes/CORS and one-circuit regeneration. Inputs and owned cleanup were verified for each lane.

Source-native, software credentials, synthetic browser, mounted local image,
actual registry installation and pulled-image results keep their distinct recorded
inputs. None establishes a real passkey provider, total-loss restoration or full Lace.

The next stability iteration includes [CI latency](https://github.com/input-output-hk/midnight-passport-sdk/issues/271),
[bounded read retries](https://github.com/input-output-hk/midnight-passport-sdk/issues/274)
and [a reusable mounted-image lane](https://github.com/input-output-hk/midnight-passport-sdk/issues/313).
The wider [0.1.0 milestone](https://github.com/input-output-hk/midnight-passport-sdk/milestone/1)
and [0.2.0 capabilities](https://github.com/input-output-hk/midnight-passport-sdk/milestone/2)
retain their unmet acceptance.
