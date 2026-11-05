# Upstream Passport review — 4 November 2026

Read-only sub-agent research requested by the owner. This records adoption candidates, not release
acceptance. No upstream commits were imported, no issues edited, and no native environment touched.

## Sources and scope

Passport `main` was [fc19e471536febb2133f20e817847251622dcdf5](https://github.com/midnightntwrk/passport/commit/fc19e471536febb2133f20e817847251622dcdf5),
merged 2 November: 64 commits after our immutable ACC source `6458ed5`. Upstream SDK `main` was
[cd1f26d658f268acc2f6df5e383bf2601cbe3055](https://github.com/midnightntwrk/midnight-passport-sdk/commit/cd1f26d658f268acc2f6df5e383bf2601cbe3055),
28 October. PR status below is a dated snapshot, not a continuously updated promise.

Our milestone remains reusable packages for Lace and other partners, with application contracts
calling an existing ACC. Keep both JubJub/P-256 supported subsets, `acc-s3r1.1`, exact-value shielded
withdrawals and evidence-specific compatibility. These findings do not justify replacing partner
orchestration, enabling partial spends or claiming full Lace/provider/total-loss recovery support.

## Adopt in the current milestone

### Extend the requirements/evidence map

[Passport PR169](https://github.com/midnightntwrk/passport/pull/169), merged 27 October at
`eb7c51f6aabdf40376085d477f15eb3575eee6ef`, extends the
[security promises](https://github.com/midnightntwrk/passport/blob/fc19e471536febb2133f20e817847251622dcdf5/docs/plans/PROMISES.md#security-properties)
with P5′ and P11–P16. Issue #244 currently names P1–P10. The next requirements-map update should
cover every new property explicitly, including unsupported states, with source-specific evidence.

Prioritize transaction authorization/state binding, snapshot-specific value reports, retained
funds-reconstruction material, remote-prover disclosure and upgrade authorization. A partial balance
is a lower bound only at its identified snapshot with relevant debits accounted for. A stale value
can exceed today's spendable balance; “partial” does not make it a safe current lower bound.

| SDK work | Acceptance to add | Existing backlog |
| --- | --- | --- |
| Transaction intent/consent | Account, live authority, state, scope, expiry and replay binding | #230, #237, #246 |
| Holdings reports | Account, asset, finalized snapshot; complete/partial/stale semantics | #237, #238 |
| Interruption/recovery | Retain original coin descriptions, openings and viewing generations; no replacement unknowns | #230, #239, #269 |
| Proving privacy | Enumerate prover, transport and logging disclosures; distinguish remote/local execution | #234, #235, #244 |
| Maintenance/upgrades | Identify actual authority and authorization assumptions, including deployment defaults | #228, #237, #244 |

These are proposed acceptance additions, not findings that each existing implementation is unsafe,
and not a blanket conformance claim. P5′ and all P11–P16 still need individual mapping in #244.

### Audit public input contracts against recent hardening

[PR197](https://github.com/midnightntwrk/passport/pull/197), merged 2 November, implements
`ffa5f299b6ad81c6824d0b7c92c51178cf2e05c1`: nonzero canonical signer scalars, strict hex/lengths,
uint128 coin bounds and zero-agreement refusal. [PR199](https://github.com/midnightntwrk/passport/pull/199)
is **proposed**, 3 November, head `966f5d32cb497f2e659e0c983810b104a54c2575`: reject oversized identifiers
instead of truncation, exact pasted grant-credential length, validation before randomness and fresh
receipt preservation. Neither changes the Compact schema.

Our SDK already has substantial equivalent validation. Audit every public JS boundary and add
negative controls where missing; do not copy reference clients wholesale. Assert refusal before
randomness/key use/submission and errors that do not reflect pasted secrets. Map to #237/#238/#262;
create a separate focused issue only for an uncovered implementation gap. Proposed199 behavior
must remain attributed as proposed even when independently appropriate for our SDK.

### Concrete local gaps found during the follow-up audit

The bounded inspection confirmed two implementation gaps. The public account `fromHex` error
included the first16input characters (and its old test required that disclosure). Direct shielded
deposit admission used `.slice()` on Uint8Array inputs, which aliases Node Buffers: mutation during
a held chain/journal read could change admitted coin bytes. Local fixes now use a fixed codec error
and independent byte snapshots at admission. Regressions cover ordinary arrays and Buffers,
one-shot/journalled deposits and same-ID resume before protected journal I/O. The host review
example uses the same owned-byte rule. These changes need no binding or persisted-format change.
Map the bounded fixes to #246/#230/#237/#262; they do not complete the broader input audit.

Other sampled grant/opening/keyring/coin parser boundaries already validate exact lengths and
scope; this is not comprehensive cryptographic or real-provider acceptance. No actual secrets or
native transactions were used to establish either counterexample.

### Refresh upstream evidence attribution

[PR195](https://github.com/midnightntwrk/passport/pull/195) (23 October) and
[PR196](https://github.com/midnightntwrk/passport/pull/196) (2 November) expand
[grant/recovery evidence](https://github.com/midnightntwrk/passport/blob/fc19e471536febb2133f20e817847251622dcdf5/contract/GRANTS-COMPLETION.md).
Useful controls include older-schema refusal, P-256 software-authenticator paths, grant expiry/cap/
recipient/replay/revocation negatives, and retirement/epoch invalidation. Attribute these to their
upstream source and native environment. They are not our package/binding release acceptance.
Successful P-256 shielded grant spending/forwarding remain outside that run; the grants document
is still a local Draft, and key reuse is not clean regeneration evidence. Map #228/#237/#238/#242.

## Recovery profiles need an explicit decision

Upstream SDK [PR38](https://github.com/midnightntwrk/midnight-passport-sdk/pull/38), merged
28 October, is documentation only. Its
[proposed ADR0006](https://github.com/midnightntwrk/midnight-passport-sdk/blob/cd1f26d658f268acc2f6df5e383bf2601cbe3055/docs/adr/0006-guardian-recovery-scheme-in-kernel.md)
keeps recovery secrets/reconstruction/signatures in the trusted boundary, sealed authenticated
transport and local commitment checks. Legacy symmetric recovery wraps require a fresh secret/
session with the full guardian roster after each viewing-key rotation; P-256 is not directly the
successor gate.

Passport's [viewing-key sharing plan](https://github.com/midnightntwrk/passport/blob/fc19e471536febb2133f20e817847251622dcdf5/docs/plans/viewing-key-sharing.md),
merged through PR187, instead proposes quorum public-reader envelopes for offline guardian refresh,
retained generations and successor retrieval. Encodings/schema are undecided. These are distinct,
unfinished profiles. Record a choice and freshness semantics under #240/#244 before implementation.
Do not combine the offline-envelope proposal with legacy wrapping and claim recovery continuity.
Neither design recovers a passkey-derived ordinary HD wallet automatically.

The production Compact diff since6458 still contains the previously assessed `recover_finalise`
`devices.resetToDefault()` correction; production P-256/WebAuthn inputs are unchanged. Our ADR0012
binding decision stands. Adopting the correction needs a new identified binding, artifacts,
maintenance/migration policy and our own qualification. It does not establish complete individual
key revocation.

## Watch; do not adopt silently

| Upstream item | Dated status and SDK decision |
| --- | --- |
| [PR198 private device registry](https://github.com/midnightntwrk/passport/pull/198), head `5e998bcfa531de63d76d44aa750f1d89dfb67327` | Open experiment/amendment: eight-slot private roster, no P-256/assets/grants/native admission. Private-state withholding is a production blocker. Track #229/#240/#244. |
| [PR188 EVM approvals](https://github.com/midnightntwrk/passport/pull/188), `c20d05dc58ba50d862eddefd9f937e7fe394a120` | Open draft, 16 additional circuits/new68-circuit account and artifacts. Track #82/#244; no cross-chain custody claim. |
| [PR189 Solana approvals](https://github.com/midnightntwrk/passport/pull/189), `2839f151c6fb8b917ac31a284e2a799c9be2e67a` | Open draft, new-binding boundary; real browser-wallet acceptance pending. |
| [PR194 asset policies](https://github.com/midnightntwrk/passport/pull/194), `da97f541afa045bd0fd4cc63a0fd2cedbabc7f8d` | Isolated ACC→registry→policy experiment; authenticated discovery/combined native submission absent. Optional future composition, not a prerequisite for application→ACC #275. |
| [PR190 BIP340](https://github.com/midnightntwrk/passport/pull/190) | Merged isolated verifier experiment; Passport integration deferred and PR191 withdrawn. No current adoption. |

## Execution recommendation

Finish the current local #246 deposit consent/reconciliation example and review. Then take an
independent **security requirements and public input contracts** slice: extend #244's map, audit
negative public-input cases and document snapshot/disclosure/maintenance/recovery boundaries.
Native merchant #275 remains blocked/deferred because the owner reserves the shared stack for
another session. No upstream architecture proposal or offline test completes that native goal.
