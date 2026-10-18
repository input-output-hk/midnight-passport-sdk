# RC5 release qualification and Lace handover

Target: `0.1.0-rc5`, GitHub Packages `next`, private package access for the Lace
consuming repositories. Preparation date: 2026-10-19 (Asia/Kuala_Lumpur).
Source baseline: prototype integration `95588a3ca1a2578ab2b066957f02c8087cda4d5a`.
This document is a preparation record, not a published release announcement.

## Goal and scope

Deliver a reproducible preview that Lace engineers can install, evaluate and diagnose.
Ship the nine implemented packages (`protocol`, `keys`, `account`, `adapter-webauthn`,
`adapter-midnight-js`, `adapter-service`, `adapter-browser`, `contract`, `service`),
plus the key-serving, proving/sponsorship and wallet-funding images. Keep the pinned
`acc-s3r1.1` binding from upstream `6458ed5` and its existing compiler/key manifests.

The handover includes package/API docs, package responsibilities, a minimal consumer path,
container requirements, a demo setup recipe, compatibility evidence and explicit limitations.
No empty scaffold packages, new contract revision or additional feature is required for RC5.

Preparation stays local: no branch pushes, PRs, release tags, registry writes or GitHub issue
changes. Review/merge and publication are separate steps for the following work session.
All local commits require a verified GPG signature, DCO and a passing repository gate.

## Acceptance gates

- [x] Review the exact final source and run lint, format, build, package/app tests and type checks.
- [x] Pack nine RC5 tarballs; install/type-check/import and browser-build a clean consumer.
- [x] Compare hashes across two clean builds, keeping package count aligned with the packer.
- [x] Qualify all three Linux/amd64 images with pinned artifacts and non-root execution.
- [x] Run the service image with a Linux dependency mount: manifest, readiness, public URLs,
      deployed ACC, activation and chain read.
- [x] Run the funding image against that localnet: confirmed deposit, balance read and replay
      of the same request ID without a second transfer.
- [x] Render Pages and verify internal links; ensure the compatibility matrix and candidate
      notes agree with the evidence.
- [x] Assemble final local artifact hashes, image IDs, test receipts and deferred-issue list.

Registry visibility, downloaded package bytes/attestations, immutable GHCR digests and deployed
Pages can only be verified after publication. Local IDs are not published manifest digests.

## Lace evaluation boundary

The pinned Lace source is merged PR #2845 head
`502b0794cc7bcfc76342230193fef4ebb63cae1c`. The runtime evidence uses synthetic credentials
and simulated hosted windows on localnet. See [the consumer report](../lace-consumer-report.md)
for each supported direction and consent boundary. It is not a claim of full Lace compatibility
or real passkey-provider coverage. The P-256 registration record is an SDK extension;
Lace's pinned decoder handles JubJub registrations.

Shielded withdrawals retain the exact-value guard. Partial spending/change recovery is deferred
under #201; complete typed circuit coverage remains #82. Outstanding live/value-host evidence
remains tracked under #202. Localnet NIGHT funding is not qualified for other networks.
Services need controlled ingress; CORS is not caller authentication. Proof inputs are visible to
the proving service under the current prototype trust model. Losing every enrolled/recoverable
passkey is not repaired by the ACC address or public envelopes.

## Tomorrow's review and publication sequence

1. Review the local qualification changes and evidence. Create PRs only when authorized; merge
   into `passport-acc-prototype` after exact-head CI and self-review.
2. Confirm the selected version is unused and the private publisher still accepts the source
   tag/commit. Grant the Lace team's users and consuming repositories package read access;
   do not change private visibility accidentally or commit authentication tokens.
3. Run the release dry run at the reviewed prototype commit. Record the source SHA and workflow.
4. Create GPG-signed annotated `sdk-v0.1.0-rc5`, `keys-v0.1.0-rc5`,
   `service-v0.1.0-rc5` and `funding-v0.1.0-rc5` tags at that same commit. Pushing these
   tags triggers publication: do this only during the approved publication session.
5. Verify all nine private package versions and `next` tags; compare downloaded tarballs to
   the publisher's signed attestation, then run the clean consumer smoke from registry bytes.
6. Pull each GHCR image by manifest digest, run startup and network smokes, and record access,
   platform and immutable digests. No local image ID can substitute for this step.
7. Publish/update Pages with verified installation examples and evidence links. Check rendered
   API pages, compatibility matrix and release notes at the deployed URLs.
8. Hand Lace engineers the release URLs, exact versions/digests, access instructions, known
   limitations and the short evaluation recipe. Reconcile only issues whose criteria passed.

Do not declare the release complete until steps 5–7 pass. Fix concrete fund-loss,
installation or artifact-integrity failures before publishing.

## Local qualification command

With the separately prepared image-backed services ready on loopback, run:

```sh
PASSPORT_RC_LOCALNET=1 MN_NETWORK_ID=undeployed \
PASSPORT_SERVICE_URL=http://127.0.0.1:18787 \
PASSPORT_FUNDING_URL=http://127.0.0.1:18789 \
PASSPORT_FUNDING_TOKEN_FILE=/private/path/funding-token \
PASSPORT_RC_EVIDENCE=/private/path/rc5-network.json \
nix develop -c node scripts/qualify-rc-localnet.mjs
```

This creates a disposable sealed JubJub ACC with synthetic, process-local credentials and
transfers 10 base units of public genesis NIGHT to it. It reopens the account, confirms the balance increase,
then replays the identical request ID and checks the same response and unchanged balance.
It does not test real passkeys or permit non-loopback/non-localnet operation. Do not rerun an
uncertain funding outcome with a new request ID; inspect the saved request and reservation first.
The probe's secret key material is not written to its evidence file, so its synthetic account
is disposable after the process exits.

For custom service ports, publish the same external and internal port and set the application's
port variable to that value: the Host guard deliberately rejects translated port headers. The
RC5 image healthchecks now follow `PASSPORT_SERVICE_PORT` / `PASSPORT_FUNDING_PORT` too.
Container mounts are the pinned contract tree read-only, a Linux-installed `node_modules`
volume read-only, separate writable service/funding state, and read-only funding credentials.
The funding service reads the service's deployment allowlist. Use a dedicated localnet token;
never place it, wallet state, seeds or PRF material in a PR or image.

## Local result and review slices

The mounted Linux/amd64 service/funding flow passed: synthetic sealed JubJub create,
activation, ledger read, reopen, NIGHT balance `0 → 10`, and same-ID replay with the same
transaction and unchanged balance. Both images report healthy on custom matching ports.
The key image verifies all 52 cached circuits and freshly regenerates one small circuit
with pinned prover/verifier hashes. Missing writable compiler home and CA certificates were
found during that fresh-generation check and fixed in its Nix image configuration.

[The local receipt](rc5-local-receipt.json) contains package hashes, local image IDs,
public transaction evidence and exact limitations. It supersedes the earlier preparation
snapshot under `docs/review/rc5/`. The latest Lace type smoke runs on RC5 tarballs; runtime
recognition/consent results remain the separately documented pinned-source probes.

Local review scope for tomorrow: (1) small healthcheck/queue/release-count fixes in `31c5161`,
(2) key-image writable-home/CA fix, and (3) handover docs, qualification harness and evidence.
The final source CI, registry publication, team/repository access, registry-byte attestation,
pulled image digests and deployed Pages remain tomorrow's gates.

Suggested PR order (branches are local only):

1. `codex/rc5-release-fixes` → `passport-acc-prototype`: healthcheck ports, queue synchronization
   and shared package-count consumer gate (`31c5161`).
2. `codex/rc5-lace-handover` → `codex/rc5-release-fixes`: key-image home/CA fix, qualification
   harness, Lace source smoke, corrected docs and receipt. Retarget to the prototype after
   the first PR merges, then rerun exact-head CI.

The mounted probe uses public genesis funds and synthetic credentials; existing user/demo
processes and the shared localnet are preserved. Temporary qualification containers can be
stopped after logs are captured; persistent state, local images and receipts are retained.
