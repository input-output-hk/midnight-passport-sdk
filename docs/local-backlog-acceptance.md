# Local backlog acceptance audit

Candidate: nine `0.1.0-dev.12` packages; local only. Date: 2026-10-17.
This audit covers issues #25, #205, #79, #161 and #81. It does not authorise a push or release.

| Issue / requirement | Evidence | Status |
| --- | --- | --- |
| #25 actual browser WebAuthn/PRF path | `apps/passport-dapp/e2e/virtual-authenticator.e2e.ts`: CDP CTAP2 resident credential, user verification and PRF. Full localnet run created ACC `3ae05ff57a8ad4fd76a9e8e3cef3041200882c1b06d6d058c4f4a3cc5c26469a`, rotated, reloaded/reopened, refused an unrelated wallet credential, connected the pinned wallet and rotated again; 19 assertions. The test checks creation event-log stages and ceremony counts. | Passed locally. |
| #25 negatives and limits | Same one-command test defaults to no-PRF refusal before deployment and cancellation; full chain path is opt-in. `AGENTS.md`, `apps/README.md` and `docs/prototype/` document invocation and real-provider limits. | Passed; synthetic authenticator does not establish Google/iCloud behavior. |
| #205 build cache exclusion | All nine package file lists exclude `dist/.tsbuildinfo`; release pack inspection rejects caches. | Implemented and checked. |
| #205 independent reproducibility | `scripts/check-release-reproducibility.mjs` installs/builds/packs in two distinct clean paths; all nine dev.12 SHA-256 hashes match. `.github/workflows/publish.yml` runs it before provenance attestation. | Passed locally; publisher verification remains a release gate, not a claim of a new publication. |
| #79 key derivation and secret boundary | PRF/JubJub, suite-2 interop and device-keyring tests; typed `AccountViewingKey` ports. Account flows receive public keys, opened data and ciphertexts, not viewing/reader secrets. Local key-origin implementations zero temporary secret copies. | Implemented and tested. |
| #79 both cross-product directions | `experiments/lace-consumer/results/2026-10-17-cross-signin.json`, `2026-10-17-hosted-authorising-device.json` and `2026-10-17-lace-created-sdk-open.json`: SDK ACC recognised by unmodified Lace hosted sign-in; native Lace hosted-created ACC opened by SDK address recovery with local key-origin ports. Same network and binding. | Passed in synthetic-credential protocol tests. |
| #79 recovery limits | `docs/site/keys.md`, `docs/prototype/keys.md`, consumer report: surviving enrolled devices can open their envelopes; ACC address does not recreate a lost passkey. | Documented; localnet P-256 and mixed-device evidence recorded. |
| #161 versioned registration | ADR 0009 and key tests: authenticated `0xd5` P-256 policy registration, canonical compressed SEC1 encoding, suite/size/padding/downgrade checks, legacy JubJub support. | Implemented and tested. |
| #161 P-256 and mixed recovery/rotation | `sdk-p256-sealed-device-node.json` and `sdk-mixed-device-recovery-node.json`: live membership, sealed openings, surviving device recovery, removal/refusal and mixed-roster rotation. Deterministic-key legacy accounts explicitly refused. | Passed locally. |
| #161 read-grant issue and preservation | `sdk-p256-read-grant-enroll-node.json`: issue read grant, open seal, rotate during enrollment, open new seal, refuse old seal against new key and open from joining device. Unit tests cover incomplete roster/opening refusals and revoke/revoke-all. | Passed, including the additional live read-grant revocation below. |
| #161 read-grant revocation on localnet | `sdk-p256-read-grant-revoke-node.json` records the issue/enrollment flow followed by rotation/revoke, inactive live grant, old seal refusal and both surviving device openings. ACC `072b07567c9ab7eb57ca536249ec5b789f65e05485de5d8a45be88e0e761a75d`; revoke transaction `668371a715dd7c20f2f10988fad053507841710fa2012a818f218a2558de5e1c`. | Passed locally. |
| #81 exact source types and package installation | `smoke-lace-source-consumer.mjs` pins merged Lace `502b0794cc7bcfc76342230193fef4ebb63cae1c`; dev.12 types pass with seven direct Midnight versions matched. `smoke-release-tarballs.mjs` passes nine entrypoints, types, browser build, physical runtime identities and manifest-verified prover restoration. | Passed locally. |
| #81 runtime flow and report | Native Lace hosted creation, hosted sign-in and SDK authorising-only device addition have confirmed localnet results in the consumer report. The device test checks live commitment, two devices, nonce and subsequent healed sign-in. | Passed for those exact flows; no full compatibility claim. |
| Signed local delivery | GPG signatures, DCO sign-offs and `Assisted-by: AI` trailers on commits; full repository gate before each commit. | Preserved; no push/PR/publication. |

## Intentional integration limits

The generic SDK create flow needs validation requests excluded from Lace's creation scope;
non-rotating sealed enrollment needs roster reads excluded from its scope; hosted sign-in hides
device registrations needed by SDK address recovery. Lace retains its flow orchestration. The
working reverse test uses native Lace hosted creation and SDK recovery with local key-origin
ports. An authorising-only device entry does not deliver a viewing secret. These distinctions
are recorded in [the consumer report](lace-consumer-report.md) and ADR 0010.

The circuit HTTP prover and transaction prover are different interfaces. The direct localnet
sponsor in the native Lace test is diagnostic infrastructure; no service sponsorship policy was
relaxed. The exact-value shielded-spend guard remains in place. Browser chunk warnings and a
successful Vite build do not establish every SDK flow in a deployed browser signer page.

## Outcome

All five issues meet their local acceptance requirements for the exact supported paths above.
The goal does not include publication or a claim of full Lace compatibility. The documented
hosted scope limits remain integration boundaries, with passing evidence obtained through
Lace-owned orchestration and the supported SDK ports. No push or PR was created.
