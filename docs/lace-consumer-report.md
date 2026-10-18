# Lace Passport consumer report — local SDK candidate

Status: local integration candidate, 2026-10-17. This report tracks SDK issue #81 and does not change Lace.

| Pin | Value |
| --- | --- |
| Lace Passport | merged PR [#2845](https://github.com/input-output-hk/lace-platform/pull/2845), `502b0794cc7bcfc76342230193fef4ebb63cae1c` |
| SDK package candidate | nine packed `0.1.0-dev.10` tarballs, local only |
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

## Remaining runtime acceptance

The source compile and SDK-only node probes do not prove a Lace-created ACC reopening through SDK flows, an SDK-created ACC signing in through Lace, or an SDK account flow using the live Lace hosted signer. Run those two cross-product directions and one grant or device call on the same `undeployed` localnet, then record transaction hashes, ACC address, SDK commit, package tarball hashes and signer consent output here. Do not claim full Lace compatibility before those checks. A lost passkey cannot be reconstructed from the ACC address; a surviving enrolled device can use its sealed envelope.
