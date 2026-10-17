# Lace Passport consumer report — local SDK candidate

Status: local integration candidate, 2026-10-17. This report tracks SDK issue #81 and does not change Lace.

| Pin | Value |
| --- | --- |
| Lace Passport | merged PR [#2845](https://github.com/input-output-hk/lace-platform/pull/2845), `502b0794cc7bcfc76342230193fef4ebb63cae1c` |
| SDK package candidate | nine packed `0.1.0-dev.11` tarballs, local only |
| ACC | `acc-s3r1.1`, Passport source `6458ed5fe6a4843912328bbf11112b97e33abf45` |
| Compiler manifest SHA-256 | `77fb9c17b0d59047456c43115d9a58f5cb99a226ee73b6b974fd724930c3153f` |
| Localnet | `undeployed` |

## Checks completed

- `scripts/smoke-lace-source-consumer.mjs` compiles Lace's exact contract seam, generated ACC ledger declaration and gated-call handle from the pinned merged head against nine installed SDK tarballs. Seven direct Midnight runtime versions match. The check rejects changed Lace source or tarball hashes.
- `scripts/smoke-release-tarballs.mjs` loads all nine package entry points, checks Lace-shaped host types, builds a scratch browser app and restores a manifest-verified prover key. Compact runtime 0.20.0 serves the current ACC; Compact 0.16.0 enters only through `compact-js`'s explicit Ledger 8 alias.
- `tests/keys-lace-suite2-interop.test.mjs` checks exact Lace suite-2 envelope, JubJub registration and grant-record bytes in both directions. The SDK retains suite-1 reads. P-256 `0xd5` registration is an SDK extension that Lace does not currently parse.
- SDK localnet evidence covers P-256 owner to JubJub device enrollment, address recovery, JubJub-initiated mixed-roster rotation and reopening from both devices (`experiments/acc-0.35/results/sdk-mixed-device-recovery-node.json`), P-256 sealed-key rotation/removal (`experiments/acc-0.35/results/sdk-p256-sealed-device-node.json`) and a hosted ACC call handle (`experiments/acc-0.35/results/sdk-shielded-deposit-node.json`). The mixed-roster rotation was confirmed by transaction `563af58573bf3465a7e37a5794594a2147921f45332386a6a4db46c245ac7b3b` on `undeployed`. These use SDK flows, not Lace's signer page.

## Package fit

| SDK package | Lace use today | Integration seam |
| --- | --- | --- |
| `mn-passport-contract` | ACC binding, manifest pins, generated module and small key bundle | Check Lace's compiled ACC hash and network binding before using its generated handle. |
| `mn-passport-keys` | PRF recipe, reader and suite-2 record interoperability | Keep Lace's signer-held PRF, reader and viewing secret behind its `PassportEncryptionKey` ceremony. P-256 `0xd5` needs an explicit Lace parser if adopted. |
| `mn-passport-protocol`, `mn-passport-account` | Typed account API and reusable create/open/grant/device flows | Map Lace's branded address, epoch, counter and flow consent values; keep host source reads chain-backed. |
| `mn-passport-adapter-browser` | `hostedJubjubAuthoriser` and browser composition | Supply Lace tagged constructors and a lossless flow-descriptor converter. Rotation and owner withdrawal lack Lace consent descriptors in this adapter. |
| `mn-passport-adapter-midnight-js` | Circuit prover, sponsor and hosted ACC handle | Inject Lace's handle and prove/submit service; bind to the same ledger version and manifest. |
| `mn-passport-adapter-service`, `mn-passport-service` | Optional Passport deployment/proving and key HTTP services | Lace may keep its own backend; these packages do not require Lace adoption. |
| `mn-passport-adapter-webauthn` | P-256 browser path | Lace currently uses a hosted JubJub signer; this adapter is for the SDK's P-256 demo. |

The [local diagnostic evidence](../experiments/lace-consumer/results/2026-10-17-hosted-signer.json)
records candidate tarball hashes and labels the patched run separately.

## Runtime findings and acceptance still open

The actual Lace hosted signer was exercised through its real request client, server,
authoriser, encryption-key port and handlers in a disposable checkout. WebAuthn was replaced
with synthetic test PRF outputs, and the window transport was simulated. This is a protocol
integration experiment, not a test of Lace's deployed browser signer page.

| Finding | Evidence | Current SDK response |
| --- | --- | --- |
| Create consent excludes `open-inbox`. | Unmodified signer rejects the SDK's pre-activation sealed-registration validation with `flow-scope`, after deployment and before activation/publication. | Retain validation and report the incompatibility. No scope widening or skipped validation in SDK code. |
| Enrollment with `reader` but no rotation excludes `open-inbox`. | A nonempty roster read is rejected with `flow-scope` in that session. | Do not claim the SDK enrollment flow works through the unmodified hosted signer. |
| Sign-in filters device registrations out of inbox results. | A valid sealed registration returns `null`, while its keyring opens successfully. | Ordinary keyring validation can tolerate filtered output; the SDK's address-recovery flow additionally requires a unique registration, so it needs a reviewed host adapter before use with this signer. |
| Empty inbox batches do no work in Lace's remote encryption port. | Invalid keyring plus `entries: []` resolves without a signer request; a nonempty request rejects it. | Fixed P-256 and JubJub opening to validate a real sealed entry, and refuse an empty ACC inbox. Regressions exercise this batching behavior with a wrong live key. |
| Equal runtime versions can still have different physical module identities. | The isolated npm tree first failed contract-context construction, then failed transcript partitioning with `expected instance of LedgerParameters`. | Added `check-midnight-runtime-identity.mjs` to both packed consumer checks; reject separate current Compact/ledger copies before deploying. |

All four no-chain consent/transport checks pass against the **unmodified** signer source at
the pinned Lace head. Their green result confirms the limitations above, not successful SDK
interoperability. Run them with an installed Lace checkout:

```sh
LACE_CHECKOUT=/path/to/lace-platform nix develop -c node scripts/check-lace-signer-consent.mjs
```

The runner pins HEAD, refuses modified signer source and existing diagnostic files, runs Nx
without its result cache, and removes the temporary diagnostic test afterward. Local execution
used an isolated sparse checkout with optional Nx discovery plugins and coverage disabled;
normal full-checkout CI configuration was not tested. The fixture lives in
`experiments/lace-consumer/signer-consent.diagnostic.test.ts` for review.

A diagnostic **patched** run admitted `open-inbox` in creation only, and unified the disposable
checkout's current Compact/ledger modules. It then deployed ACC
`19eded3b9236fdf5e5d57b060a3a82733a70e024b9da2d3ae0d2a5cfa2fe714f`, activated it in
transaction `0134fe2120ac5729591afc7e923449a21a09a89043cb6dc539c7583e80057dd8`, and
published its two sealed entries in transactions
`576dde762782ff71f926ad642e8e6da4c3d810938ab174a95b8a7132662a6cd5` and
`7ec11ac6d3538b5b4b2787c0cafee989d435552429940d40be75429810210b26`.
This used the earlier local `0.1.0-dev.10` tarballs. Its later Lace sign-in failed because the
diagnostic passed the observable record store where Lace expects its promise adapter;
that harness error is not a product finding. This run establishes neither an unmodified Lace
create nor a completed cross-product sign-in. The scope edit is removed and is not proposed
as an upstream change. No production compatibility claim follows from the patched run.

Lace's default signer session is five minutes; this experiment explicitly allowed 25 minutes.
A production host must decide how long an approved proving session may remain open.

### Next acceptance work

Issues #79 and #81 remain incomplete. Before their runtime criteria can pass, define a host
contract for sealed-key validation and roster access that preserves Lace's consent boundaries.
Consider an explicit validation operation returning only the required proof of ownership, or
split SDK flow phases into appropriately scoped sessions. Neither approach may silently widen
consent, expose the viewing secret, or report success without validating the live envelope.
Lace owns any integration or signer API changes; this SDK branch does not change Lace.

Then run both cross-product directions on the same binding/network: a Lace-created JubJub ACC
opening through SDK flows, and an SDK-created ACC signing in through Lace, followed by one
grant/device call through the hosted signer. Record exact source/package hashes, ACC address,
transactions and consent outcomes. Keep the exact-value guard on shielded withdrawals.
A lost passkey cannot be reconstructed from the ACC address; a surviving enrolled device can
use its sealed envelope.
