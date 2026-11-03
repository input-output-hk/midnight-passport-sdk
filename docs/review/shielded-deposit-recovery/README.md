# Original shielded deposit recovery — review map

Tracking [#261](https://github.com/input-output-hk/midnight-passport-sdk/issues/261), under #257/#262.
Additive ports preserve the one-shot API. The [engineer contract](../../site/shielded-deposit-recovery.md)
defines journal ownership, privacy, canonical evidence and retained-unknown behaviour.

Review in this order:

1. `shielded-deposit-recovery.ts`: immutable bounded identity/codec; exact original inbox prefix,
   atomic preparation/dispatch admission, read-only unknown lookup and canonical transaction
   confirmation. No automatic re-send or re-seal; same historical confirmed receipt.
2. Shared input validation and the additive `ports.recovery` dispatch in `shielded-deposit.ts`.
   `resumeShieldedDeposit` requires the original state; unmanaged legacy calls are one-shot only.
3. `keys/shielded-deposit-journal.ts`: dedicated key domain and authenticated ID/revision/context,
   snapshotted writes, immutable intent/transaction and monotonic phase transitions. Existing
   service file byte store supplies atomic crash-durable private filesystem publication.
4. `tests/shielded-deposit-recovery.test.mjs` and its synthetic world/child: actual randomised seal,
   encrypted disk and fresh process exits; one sender effect across loss boundaries. Conflict,
   concurrency, exact-entry/prefix/finality, rotation, mutation, clock and corruption refusals. Real exits include the dispatch-fence unknown and the durably saved submitted state.
5. API/engineer/prototype/app docs: no native adapter, HTTP shielded faucet, demo funding change,
   real-provider acceptance, broad wallet lock or published RC6 export claim.

[Local gate](local-gate.json) records exact test counts against the stated base. It is not a
native proof or installed-registry receipt. Tests own and delete only their synthetic temporary
roots; they never touch retained localnet accounts, wallets or unknown mutation histories.

The dispatch fence intentionally has an unknown window before wallet invocation. Missing sender
proof cannot authorise a replay. Restoring an earlier journal revision or creating a new journal
for a legacy request is unsupported. The host must retain the actual sender's records and use
real canonical evidence with I/O deadlines; a matching inbox or truthy object cannot suffice.

## Independent quality audit correction

The bounded audit found that a post-admission host lookup/finality/storage exception could escape
with a misleading pre-send error code. The runner now normalises journal reads and all port
failures after dispatch admission to safe nonretryable `MutationUnsettled`; it never exports raw
host diagnostics. Five targeted fault cases preserve original journal evidence, one sender effect,
and the original receipt on later recovery. A sixth case covers intermediate clock regression.
The pinned contract source only appends inbox entries; the exact-prefix guard matches that binding.
Large-inbox/operator no-send/rollback follow-ups remain explicitly #269. No live proof or provider
acceptance is inferred from these inspected/fast synthetic cases.

## Claude review hardening — 2026/11/03

The independent review of `d15d17f` reported no blocking defect. We nevertheless tightened
the public host-port boundary: only literal boolean `true` admits dispatch, malformed sender
lookup results retain the unknown fence, and uncertain one-shot outcomes use nonretryable
`MutationUnsettled` with original IDs instead of raw host errors. Targeted regressions exercise
five invalid CAS acknowledgements, seven malformed lookup shapes after an actual process exit,
and four one-shot sender/observer failures. No resend, no-send transition or native adapter was added.

Broader journal/codec consolidation stays separate from this safety change: changing persisted
canonical ordering or authenticated bytes needs its own migration design. Pre-send fenced
unknowns and rollback policy remain #269; key-source session UX remains #245.

The follow-up exact-head review also identified raw exceptions from initial admission CAS and
the initial clock port. Both now refuse safely; tests cover a write failing before and after
persistence and a throwing admission clock. Re-reading the account before dispatch is deliberate:
sealing and durable preparation can yield while the key changes. Each observed inbox prefix must
be rechecked because this port provides no trustworthy observation-height cache key. Do not
remove either check as an optimisation. The prior-record journal read validates immutable intent
and legal phase transitions; ciphertext-only byte-store CAS cannot replace it.

A further review identified loss of an observed transaction ID when the submitted-state CAS
acknowledgement failed. The runner now retains a validated sender/lookup ID in all later safe
errors, including false acknowledgements followed by unknown lookup. Four targeted cases cover
throw/false acknowledgements from direct sender and process-restart lookup, with original
request/transaction IDs, no raw diagnostics and no additional sender effect.
