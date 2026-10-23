---
layout: default
title: ZK keys and distribution
permalink: /keys/
---

The ACC build produces three kinds of public artefact: ZKIR, verifier keys and prover keys. The compiler's `contract-manifest.json` records a SHA-256 hash and size for each file. A client or service must pin the manifest hash independently of the server that supplies the bytes.

### Account viewing secrets and recovery

In Lace's JubJub Passport flow, a fresh random 32-byte account viewing secret determines the ACC's X25519 `enc_key`. The secret is sealed into 192-byte on-chain device envelopes. Each enrolled passkey derives a network-specific X25519 reader key with the MIP-0015 domain `lace-passport:reader:v1`; that reader opens its envelope during a key session. The PRF-derived JubJub signer, reader key, account viewing secret, and wallet HD seed have separate roles. `recipeDeviceKeyring` implements the typed viewing-key port: it creates and delivers envelopes, opens coin descriptions under live and recent secrets, re-encrypts coins during rotation, opens device and grant records, and seals a read grant to its recipient's X25519 key. The account create/open and host-backed rotation flows use this port. Grant-aware rotation and a chain-backed holding-verification adapter are implemented. Complete host sources and durable grant openings are required; interrupted-rotation recovery remains a preview limit.

At Lace PR #2845 merged head `502b0794cc7bcfc76342230193fef4ebb63cae1c`, device envelopes (`0xd1`), JubJub registrations (`0xd2`) and grant records (`0xd3`) use suite `0x02`. The envelope recipient tag covers the entire sealed entry except its tag and the AEAD associated data excludes that tag; grant records use an HMAC tag over the same frame. The SDK writes that suite and opens both suite `0x02` and its earlier suite `0x01` records, so existing sealed SDK accounts remain readable. The 192-byte coin description keeps its separate custody suite `0x01`. Exact Lace known-answer bytes are checked in `tests/keys-lace-suite2-interop.test.mjs`; synthetic localnet cross-product opening has passed at the pinned Lace head. Real passkey-provider and complete hosted-flow qualification remain limited; see the Lace handover guide.

If one enrolled device is lost, another enrolled device can open its own envelope and rotate the account secret while excluding the lost reader. A synced passkey may also be usable on a replacement device if its provider restores the same credential and PRF outputs. If all enrolled authorising devices and their recoverable passkeys are lost, the envelopes alone do not provide an account recovery path. When adding a device while read grants are live, `addDevice` rotates the viewing and roster keys before sealing to the joiner, so it can refuse enrollment if a live grantee or surviving device cannot receive the new secret. The browser's P-256 create/open flow now also generates a random ACC secret and checks its sealed device envelope against the live `enc_key`; accounts made with the earlier passkey-derived `lace-passport:acc-enc:v1` recipe are explicitly refused by the new browser composition until migrated.

The keyring seals the current P-256 registration as a 192-byte suite `0x02` type `0xd5` record. Its authenticated plaintext contains a 32-byte X25519 reader key, canonical compressed 33-byte P-256 key, 32-byte RP id hash and 21-byte origin. It uses HKDF info `mn-passport:device-registration:p256-policy:v1`; the 118-byte plaintext leaves 44 zero padding bytes after the encrypted payload. The earlier type `0xd4` stores only the reader and P-256 key and remains readable, but lacks the policy needed to resolve another live P-256 device. JubJub registrations retain Lace's type `0xd2` and 32-byte compressed key. The P-256 registration is an SDK wire-format extension; Lace PR #2845 currently decodes only the JubJub `0xd2` record. The [wire-format decision](https://github.com/input-output-hk/midnight-passport-sdk/blob/passport-acc-prototype/docs/adr/0009-versioned-p256-device-registration.md) specifies type, suite, padding and downgrade behavior. The P-256 browser flow publishes its envelope and registration with `append_inbox_with_p256` before reporting the account active. It can resume publication after an interrupted create. The local demo now supplies chain-backed holding and grant sources for its supported owner flows; the two-browser ceremony still needs manual localnet validation.

Before a JubJub rotation delivers a new account secret, `resolveJubjubReaders` matches each opened registration to a live on-chain device commitment at its current epoch and use counter. It excludes removed devices and drops conflicting reader/device claims. A registration in the inbox does not by itself grant access to the new secret. `rotateViewingKey` also requires a host to identify verified, distinct holdings from chain outputs; it refuses grant records until those readers can receive a fresh seal. The package flow has focused binding tests and a mixed-device localnet probe; a Lace-hosted consumer run remains open.
The account package also exports `resolveRegisteredReaders` for mixed JubJub/P-256 rosters. It uses the registration's authenticated P-256 policy to derive each candidate ACC commitment, then retains only unique reader-to-live-entry matches. Earlier `0xd4` P-256 registrations have no policy and are dropped. Both owner arms use this resolver for mixed rotation when the key port supplies the P-256 decoder, and refuse a live device without a unique registered reader. Rotation also refuses any surviving read grant whose recipient cannot receive a fresh seal. Removal excludes the target from both the fresh viewing and roster keys.
After a P-256 owner enrolls a second device, that passkey can call `openAccountAt(address)` with the ACC address supplied by its host. The flow verifies the selected credential and policy, locates its live ACC device entry, and opens an inbox envelope against the current ledger `enc_key`; it does not rely on a directory hint or expose the raw viewing secret. The demo's **Open by ACC address** action now exposes this path for either supported authoriser arm. It requires an already-enrolled passkey and a known address; it does not discover accounts or recover a lost passkey. P-256 rotation is available to hosts that supply verified holdings and a complete live read-grant source.
`removeDevice` uses a fresh roster key as well as a fresh viewing secret, excludes the target
reader before sealing, and refuses a surviving reader that shares a key with the target. It then
calls the owner's `remove_device_with_jubjub` or `remove_device_with_p256` circuit and confirms the target left the live ACC set. The operation
spans several chain transactions; an interruption may require the owner to resume from its new
sealed keyring before trying removal again.

These proving artefacts belong to `mn-passport-contract`. The separate `mn-passport-keys` package derives ACC secret material from a host-provided key source; it is not a package of prover keys. See [Problems and package boundaries]({{ '/problems/' | relative_url }}) for the distribution and serving responsibilities.

For the first `0.1.0-rc1` binding, the selected source is Passport revision `6458ed5` (P-256 plus caller-pinned grants, on-chain spec version 3). The generator `scripts/build-acc-binding-v2.mjs` verifies the full source revision and the hashes of both imported Compact files, compiles with the canonical Compact 0.35.0 invocation, and checks every output against the compiler manifest. Its generated JSON records the compiler and Nix toolchain, manifest hash, and SHA-256 and size of every circuit's ZKIR, prover and verifier keys. `pnpm run package:acc-s3r1.1` copies the pinned generated JavaScript and types into the contract package, where consumers can import `@input-output-hk/mn-passport-contract/bindings/acc-s3r1.1` with Compact runtime `0.20.0`. The package also contains the `acc-s3r1.1` ZKIR/verifier bundle and readable key manifest. Restore its keys with `nix develop -c node packages/contract/bin/restore-acc-keys.mjs --binding acc-s3r1.1 --output /path/to/cache`. The earlier `acc-45721e1` key bundle remains packaged for prototype archive work; the SDK registry supports only `acc-s3r1.1`.

For `acc-s3r1.1`, the 52 circuits have **4,984,299 bytes of text ZKIR**, **1,597,918 bytes of binary ZKIR**, **132,804 bytes of verifier keys**, and **12,175,495,280 bytes of prover keys**. The ZKIR/verifier bundle is **1,380,821 bytes compressed**. The release contract tarball is **2,886,756 bytes compressed** and **5,252,279 bytes unpacked**, including the earlier prototype bundle. These are measured build outputs, not limits for later bindings.

| Option                                                           | Advantage                                                                  | Cost and limit                                                                                                                                                                                             |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Git LFS for `.prover` files                                      | Prebuilt keys are immediately available after download.                    | Every clone or CI fetch can transfer roughly 11 GiB. LFS charges the repository owner for stored versions and download bandwidth. It is a repository distribution mechanism, not an npm installation path. |
| Pinned ZKIR in the contract package, keys restored at the prover | A small, versioned source artefact; no 11 GiB Git checkout or npm tarball. | The prover spends CPU, memory and startup time compiling each key. A service needs a persistent key cache.                                                                                                 |

**Release path:** `mn-passport-contract` packages the generated module, [key manifest](https://github.com/input-output-hk/midnight-passport-sdk/blob/passport-acc-prototype/packages/contract/resources/acc-s3r1.1.key-manifest.json), ZKIR and small verifier keys. `.prover` files stay out of Git and npm. Run `mn-passport-restore-keys` in a service build or deployment step, then cache the verified keys by manifest hash. A hosted proving service can also distribute a prebuilt, manifest-pinned bundle from object storage for faster cold starts. Git LFS remains useful for a team snapshot, but the SDK delivery path uses pinned ZKIR.

The [Passport key service image](https://github.com/input-output-hk/midnight-passport-sdk/blob/passport-acc-prototype/apps/passport-key-service/README.md) packages that restore path as a standalone Node HTTP service. It generates missing prover keys into a persistent volume, verifies the cache before readiness, and streams keys with HTTP ranges. Its image is released through GitHub Container Registry without the sponsor wallet. It supplies key bytes to a proof server; it is not itself a transaction prover. The default profile serves all 52 circuits. `PASSPORT_KEY_PROFILE=jubjub-owner-v1` restores ten JubJub owner/deposit circuits, and `/v1/profile` reports that restricted set. `PASSPORT_KEY_CORS_ORIGINS` allows exact browser origins to fetch pinned artefacts, including a ranged prover download. Lace PR #2845's compiled ACC bytes and circuit hashes match this SDK's `acc-s3r1.1` binding; Lace's separate binding label does not change the byte pins.

The key image also serves the same verified files at `/v1/zk/acc-s3r1.1`. To advertise it in the Passport service's `/v1/config`, set `PASSPORT_PUBLIC_ZK_BASE_URL=https://<key-host>/v1/zk/acc-s3r1.1`. The consuming app must independently pin that exact URL as its `artefactUrl`; the demo accepts `VITE_PASSPORT_ARTEFACT_URL` at build time. The account service still needs its local pinned contract tree for proving. A restricted key profile serves only its declared circuits, so select `all` for consumers that need the complete binding.

The readable JSON lists SHA-256 and size for every circuit's ZKIR, binary ZKIR, prover and verifier files. It also records the compiler version and commit, the `zkir-v3` command, and hashes of the Nix Compact recipe and `flake.lock` used to select the toolchain. The restore command requires the pinned Compact 0.35.0 Nix shell. It checks the readable JSON against a hash pinned in package code, verifies it against the compiler manifest, then checks bundled inputs and regenerated `.prover`/`.verifier` files before moving keys into the output directory. It rejects mismatched existing files. A service may also pass `--manifest-sha256` from its deployment configuration. Never take that pin from the artefact host being checked.

```sh
nix develop -c node packages/contract/bin/restore-acc-keys.mjs \
  --binding acc-s3r1.1 \
  --output /persistent/cache/keys
```

Consumers can invoke `mn-passport-restore-keys` from the installed contract package. `--circuit deposit_unshielded` restores only one circuit; `--circuits deposit_unshielded,deposit_shielded` restores an explicit subset. `--source /path/to/managed/account` or `--bundle /path/to/bundle` selects another input and may be combined with an independent `--manifest-sha256` pin. Re-running the command verifies cached files and skips compilation when they match. The service should refuse to start if its key cache and the package's manifest disagree.

The [bundle builder](https://github.com/input-output-hk/midnight-passport-sdk/blob/passport-acc-prototype/scripts/build-acc-key-bundle.mjs) verifies every input against the compiler manifest before compressing it. The restore CLI verifies the full bundle against an independent manifest pin. The [regeneration check](https://github.com/input-output-hk/midnight-passport-sdk/blob/passport-acc-prototype/experiments/acc-0.35/regen-check.sh) rebuilt all 52 circuits for `acc-s3r1.1` and compared both keys byte for byte with the original Compact output. A later compiler or binding needs its own full check before publication.

### Release constraints

GitHub Packages caps an npm version tarball below 256 MB, so the full key set cannot be packed there. The release contract package measures about 5.25 MB unpacked and 2.89 MB compressed. This exceeds the earlier 5 MB unpacked design estimate because it includes both bindings; the release inspector enforces the registry's tarball limit and rejects any `.prover` file.

## Device-entry removal boundary

`removeDevice` removes one opaque entry and excludes its reader from fresh sealed
keys. It cannot certify complete compromised-key revocation or erase prior viewing
knowledge. Ambiguous rosters and grants to the removed reader must be reconciled
before removal. Total-loss recovery remains unavailable on the retained binding.
See [Qualification and safety boundaries]({{ '/qualification/' | relative_url }}).

The optional registration-history port returns diagnostic metadata from readable
envelopes. Earlier secrets are not anchored to prior ledger keys. Neither removal-target
authentication nor fresh-key recipient selection trusts that history. A new legacy
removal invocation may therefore require operator reconciliation after a key switch;
an original protected mutation can retain its verified target snapshot.

## Local durability milestone

The opt-in owner continuation API and authenticated published-grant reconstruction
are described in [Mutation durability and grant recovery]({{ '/durability/' | relative_url }}).
These additions are local, unreleased work. Default demo owner buttons still need
transaction reconciliation after interruption; a journal alone does not supply
durable remote submissions. Another enrolled reader cannot invent the issuing
reader's grant opening.
