# Lace Passport consumer report — local SDK candidate

Status: local integration candidate, 2026-10-17. This report tracks SDK issue #81 and does not change Lace.

| Pin | Value |
| --- | --- |
| Lace Passport | merged PR [#2845](https://github.com/input-output-hk/lace-platform/pull/2845), `502b0794cc7bcfc76342230193fef4ebb63cae1c` |
| SDK package candidate | nine packed `0.1.0-dev.12` tarballs, local only |
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

## Hosted scope findings and integration boundaries

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

The proposed [host-flow decision](adr/0010-lace-hosted-flow-boundaries.md) records the
recommended integration, alternatives and exact remaining acceptance evidence.

### Host integration decision

The generic SDK hosted creation and sealed enrollment paths need a host contract for
sealed-key validation and roster access that preserves Lace's consent boundaries. The local
integration below instead retains native Lace orchestration and verifies both recognition
directions plus an authorising-only hosted mutation.
Consider an explicit validation operation returning only the required proof of ownership, or
split SDK flow phases into appropriately scoped sessions. Neither approach may silently widen
consent, expose the viewing secret, or report success without validating the live envelope.
Lace owns any integration or signer API changes; this SDK branch does not change Lace.

Both recognition directions and a hosted authorising-device call passed as recorded below.
Keep exact source/package hashes, ACC addresses, transaction records and consent outcomes
with that evidence. Keep the exact-value guard on shielded withdrawals.
A lost passkey cannot be reconstructed from the ACC address; a surviving enrolled device can
use its sealed envelope.


## Cross-product recognition: SDK-created ACC to Lace hosted sign-in

A subsequent unmodified-source run passed on `undeployed` using the nine hash-verified
`0.1.0-dev.11` tarballs. SDK account creation used Lace's **local** passkey authoriser and
viewing-key ports, with synthetic test PRF outputs. The resulting ACC
`544ca45c8b320cf234b62c1d3bc8cce023ff7782ec91a452720a72ca5221f15b` was then recognised by
Lace's real `signIn` flow through its hosted signer request client/server and handlers over
simulated windows. The SDK subsequently reopened the same account through the local key ports.
Neither the signer source nor its consent scopes was changed for this run.

[The run record](../experiments/lace-consumer/results/2026-10-17-cross-signin.json) pins all
three activation/publication transactions and the package hashes. The diagnostic fixture is
`experiments/lace-consumer/sdk-cross-signin.localnet.test.ts`, intended to be copied into the
pinned Lace checkout's `packages/module/passport-account/test/remote/` directory. It requires
installed hash-verified SDK tarballs, the current physical runtime identity checks, an operating
Passport localnet/service, `PASSPORT_LACE_HOSTED_E2E=1` and `PASSPORT_CONTRACT_DIR`. Run it with
Lace's root Nx test target and `--skip-nx-cache`; its explicit timeout is 30 minutes. As with the
other diagnostic, the sparse-checkout run disabled optional Nx plugins and coverage.

This proves the SDK-created → Lace recognition direction only. The stored record in the run
used the older label `0.1.0-lace.1`; the cryptographic compiler manifest was independently pinned
to `acc-s3r1.1`. The repeatable fixture uses the current Lace record label `0.1.0-lace.2`.
The protocol test uses synthetic credentials and does not exercise a real signer browser page.
Lace-created → SDK recognition and one hosted grant/device mutation still remain open.


## Authorising-only device scope correction

A live `0.1.0-dev.11` test reached hosted add-device consent but was refused because the SDK
requested `device-public-key` inside an authorising-only session. That scope admits signing
and commitment operations, not public-key disclosure. The SDK helper now uses the pinned
account hint to derive the challenge and locate the live owner entry, then verifies the signed
response's public key and counter before submission. It does not change the signer scope.
Regressions reject a signature from another owner and allow a host that refuses public-key
requests. The updated packed candidate is `0.1.0-dev.12`; live validation passed as recorded below.
The operation intentionally adds spend authority only, without delivering a viewing secret.


### Hosted authorising-device result

The updated `0.1.0-dev.12` packed candidate passed the live test with unmodified Lace signer
handlers. ACC `3c58c204e3bc0f2183985027145d014f51dd11ff9529926ea06cccc4163c6925`
accepted `add_device_with_jubjub` transaction
`17d58884f813e8fe4b14c8950efac070325574b69b53031b7a007a5c35433631`.
The test verified the joining commitment in the live device set, device count 2 and nonce 3;
a subsequent Lace hosted sign-in recovered both devices and owner use counter `3`.

[The run record](../experiments/lace-consumer/results/2026-10-17-hosted-authorising-device.json)
includes activation/publication transactions, exact package hashes and limitations. The fixture
is `experiments/lace-consumer/sdk-hosted-authorising-device.localnet.test.ts`; run it like the
cross-sign-in fixture above. It uses an explicit authorising-only API and therefore delivers no
viewing secret or sealed reader registration. That operation requires spend-authority consent,
even though this test transfers no funds. It is not evidence for full reader enrollment.

The nine candidate tarballs also passed install, type/entrypoint, physical runtime identity,
browser build and hash-verified prover restoration checks. The full local repository gate
passed with 523 tests passing and 5 skipped in the root suite, plus app checks. Nothing was
published. The reverse direction subsequently passed as recorded below; generic SDK hosted creation
and sealed enrollment remain the consent limitations listed earlier. Do not claim full Lace compatibility.


## Reverse recognition: Lace-created ACC opened by packed SDK

The unmodified Lace `createAccount` flow completed hosted creation of ACC
`e4e3c7759a6736949f41f2c412c7e9980c0a2f0f1a1745ffcda72167adc73dbb` on `undeployed`.
Its native circuit prover downloaded and verified artifacts through the SDK service's key HTTP
layout. A directly configured public-genesis wallet sponsored deployment/maintenance through
a localnet-only diagnostic worker; the service's call-only sponsor policy was unchanged.
Serialized bytes cross the wallet process boundary, keeping its ledger objects separate.

The packed `0.1.0-dev.12` SDK then opened that address with no prior SDK directory hint, using
Lace's local key-origin ports over the same synthetic test credential. It validated the live
entry and sealed registration and reported one device. This proves the reverse-recognition
criterion of #79, alongside the SDK-created → Lace hosted sign-in result above. It does not
make the generic SDK create flow compatible with Lace's hosted creation scope.

[The evidence record](../experiments/lace-consumer/results/2026-10-17-lace-created-sdk-open.json)
contains all six indexed deployment, maintenance, activation and publication transactions and
the installed package hashes. Lace installs its supported JubJub circuit set in three waves;
the SDK demo's broader verifier set uses ten waves. The contract/compiler pin is the same.
The fixture `experiments/lace-consumer/lace-native-sdk-open.localnet.test.ts` runs in the pinned
Lace test directory with the same Nx setup described above; additionally set `PASSPORT_SDK_ROOT`
to this checkout for its `localnet-sponsor-worker.mjs`. That worker accepts only serialized
balancing requests against fixed localhost endpoints and the public standalone genesis wallet.
It is diagnostic infrastructure, not a deployable sponsor API. It requires the pinned compiled
reference checkout's installed `tsx` and wallet dependencies.

Both recognition directions and the authorising-only hosted device operation now have passing
localnet evidence. Generic SDK hosted creation, sealed reader enrollment and hosted address
recovery remain the explicitly documented consent limitations. No real-provider browser or
production deployment compatibility claim follows from these synthetic-credential tests.


## Sealed P-256 read-grant revocation acceptance

The final localnet probe passed on ACC
`072b07567c9ab7eb57ca536249ec5b789f65e05485de5d8a45be88e0e761a75d`.
It issued a read grant, enrolled a second P-256 device while preserving the grantee's access,
then rotated the viewing key and revoked the grant in transaction
`668371a715dd7c20f2f10988fad053507841710fa2012a818f218a2558de5e1c`.
The live grant was inactive, the previously valid grantee seal was refused against the current
ACC key, and both enrolled devices reopened after revocation. No token transfer was involved.

[The result](../experiments/acc-0.35/results/sdk-p256-read-grant-revoke-node.json) records every
transaction and the contract/compiler pins; the reusable probe is adjacent to the other SDK
localnet scripts. This closes the missing local revocation evidence in #161. The full
[five-issue acceptance audit](local-backlog-acceptance.md) identifies each requirement and its
evidence, with the exact supported integration paths and remaining compatibility limits.
