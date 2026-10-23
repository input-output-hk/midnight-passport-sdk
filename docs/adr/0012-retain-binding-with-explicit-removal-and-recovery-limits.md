# ADR 0012: retain the binding with explicit removal and recovery limits

Date: 2026/10/20. Status: accepted for this local stability slice. Refs #228, #229.

## Decision

Keep `acc-s3r1.1` immutable at source
`6458ed5fe6a4843912328bbf11112b97e33abf45`, Compact 0.35.0, runtime 0.20.0,
compiler manifest `77fb9c17b0d59047456c43115d9a58f5cb99a226ee73b6b974fd724930c3153f`.
Support the implemented owner/device/grant subset with **entry removal**, and keep
total-loss recovery and complete compromised-key revocation unavailable as SDK
capabilities. Correct the demo/API claim; preserve all roster and exact-value spend
refusals. A successful test of a known limitation is evidence of its boundary,
not a declaration that the contract implements a stronger security property.

Do not replace generated code, keys or the registry pointer with the reviewed
candidate. Do not automatically update deployed verifiers, move funds or infer
that an existing account has the service's default recovery configuration.
No breaking binding or public API is introduced in this slice, so the 0.1.0
stability path remains available for this supported subset. A required new binding
or breaking public API moves its delivery to **0.2.0-rc1** under the version policy.

## What changed upstream

Exact reviewed source: `cd346383c89b9ac3b328122b0053d66a2ce6215e`.
The three production inputs are `account.compact`, `account-p256.compact` and
`webauthn.compact`. Only the first differs. Its executable change adds
`devices.resetToDefault()` during `recover_finalise`; the remaining changes in
that file are explanatory comments. P-256 and WebAuthn inputs are byte-identical.
Circuit signatures, exported structs and ledger declarations compare equal.
A separate Compact 0.35.0 `--skip-zk` build produces **byte-identical generated
TypeScript declarations**, but different JavaScript. This is stronger ABI evidence
than source-name equality, and still is not verifier, ledger-storage or proof/node
compatibility certification.

Caller-bound grant source and the strict WebAuthn profile are unchanged by this
production diff. The newer viewing-envelope research is client/experiment work;
no new codec/domain bytes are adopted here. Existing suite-2 vectors and the
versioned P-256 registration remain pinned. Other experimental Compact files in
the repository are outside this production import graph.

See [source evidence](../review/stability-foundation/source-audit.json) and
[finalisation comparison](../review/stability-foundation/finalisation-comparison.json).
These describe public upstream behavior already documented in its C13/C14 plans
and recovery fix; newly obtained private consumer details are not included.

## Reachability and lifecycle

| Account state/origin | What is known | Supported conclusion |
| --- | --- | --- |
| New reference-service account | Backend generates a fresh birth JubJub recovery key, passes its public key, a zero 64-byte wrap and a three-day window; the secret is not returned or persisted by this path | No supported total-loss recovery material is delivered to the user. This is not proof of secure memory erasure or that no party ever knew the scalar |
| Account opened by address or directory | Live device membership/envelope and selected binding are checked; creation may have happened elsewhere | The service's constructor policy cannot be assumed. The address and schema tags do not prove the recovery secret was discarded |
| Pending recovery | A retained recovery scalar can submit; an enrolled surviving device can veto within the window | SDK exposes neither recovery submission nor finalisation. Audit/operator handling is separate; never silently finalise |
| Legacy finalisation already happened | Epoch and `device_count` advance, but old/future entries can remain in the actual set | Count/epoch alone are not proof of complete retirement or of corrected verifier code |
| Maintenance retired | Deployment requested retirement by default in the demo; actual deployment receipt/authority state is authoritative | No assumption that this account can be patched in place |
| Maintenance retained | The deploying operator may still have upgrade authority | Not permission to patch: independently qualify keys, verifier changes, authority, compatibility and consent first |

The generated-contract regressions use real software signatures and actual circuit
execution to distinguish wrong recovery keys, pending exclusivity, veto timing,
old current-epoch entries, future-epoch entries, enrollment during the pending
window, successor authorisation and successor recovery-key installation. They
perform no proofs and submit no transactions. Both owner arms are exercised;
the recovery gate itself remains JubJub as defined by the contract.

## Entry removal and viewing exclusion

The ACC set stores opaque rolling commitments. It does not maintain a unique
identity per signing key. Removing one element need not remove another element
for that key at a different counter or epoch. The SDK's complete/unique roster
requirements refuse unsupported ambiguity; those client checks cannot impose a
unique-identity invariant on arbitrary direct contract callers.

The supported sealed flow excludes the selected reader from fresh viewing/roster
generations, checks surviving readers/grants and removes the exact selected entry.
A read grant to that same reader is a separate delivery channel and must be
revoked/reconciled before removal. The JubJub path now has the same pre-publication
refusal as P-256. Rotation cannot erase a secret, ciphertext opening or plaintext
already learned. It is not complete signing-key revocation or retroactive secrecy.

## Why not adopt the fix immediately

The corrected candidate demonstrates atomic retirement in offline execution for
both owner arms, including future entries and pending enrollment, while retaining
successor access. Candidate JavaScript SHA-256:
`afdc3aaa5bb426329122427ed65876bd820fc5bb452c02cb4eb48a7b97ed5697`.
It is deliberately not a registered SDK binding. New/full key hashes, proof/node
acceptance, finality, maintenance authorization and the **15,000-byte verifier-wave
budget** have not been qualified for it in this slice. The fix also does not add
a contract-maintained identity for ordinary individual-device removal.

A release must not advertise total-loss recovery/full compromised-device
revocation on this retained binding. If either becomes a required supported use
case, the binding/migration gate reopens; retaining this limitation is not a
substitute for implementing the required contract correction.

## Follow-up gates

1. Upstream contract identity/schema decision for full individual-key revocation.
2. A separately named binding and full artifact provenance if a new deployment is adopted.
3. Fresh key generation/hash checks, real proof/node scenarios and verifier sizing.
4. Explicit authority/migration path for each existing account; preserve user funds.
5. Recovery/viewing continuity and durable interruption handling under #240/#230.

The JubJub removal path also requires exactly one registered target reader before
preparing a new roster, matching the P-256 refusal boundary. Without an identified
target reader, the SDK cannot establish that a read-grant recipient is distinct.
A focused regression verifies no chain call, inbox publication or ACC key switch
on this refusal.

## Interrupted removal and historical-envelope trust — 2026/10/23

The original historical-registration fallback was withdrawn after review. An envelope
addressed to a reader can carry a sender-chosen earlier secret; decryption alone does
not establish that its public key was ever a ledger `enc_key`. Such metadata cannot
authenticate a removal target or exclude a grant to that target's actual reader.

Both arms now require one unique target registration in the current ledger-matching
roster. If a legacy removal switches the key and loses the target registration before
its final call settles, a new legacy invocation refuses with `DeviceRosterInvalid`.
Use an original protected mutation continuation when available, or retain state for
operator reconciliation. Never infer identity from unanchored history or clear a
pending journal to retry. Missing/unregistered targets remain unsupported rather than
risking delivery of the fresh viewing key to an excluded reader. General durable
mutation journals are tracked in #230; complete identity revocation still needs a new
contract binding. This changes no on-chain wire format.
