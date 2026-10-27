# Durable host-job outcomes — first #233 slice

Local source follows merged PR #251 at `6399b30`. No new package or release.

## Review order

1. `host-jobs.ts`: immutable native call/deploy descriptor, identity digest and
   service pins; acceptance before acknowledgement; one queued-to-running claim;
   asynchronous work; unknown/missing/late original handling; monotonic committed
   outcomes, event ring, expiry and drain semantics.
   Reconciliation pins original input bytes as well as the intent digest; a
   different existing host input must stay unresolved without another send.
2. `host-job-store.ts`: encrypted immutable revisions, AAD/domain/ID binding,
   cross-instance admission reservation and no uncertain/terminal identity eviction.
   Uses the existing POSIX byte CAS primitive. No callback or authority generation.
3. `host-job-route.ts`: opt-in authenticated operator RPC and asynchronous `202`;
   GET never drives work. Original native journal and wallet policies remain required.
4. `host-jobs*.test.mjs`: actual Node HTTP and encrypted files; two killed-process
   boundaries; fake chain drivers; same-ID conflicts, stale updates, lost writes,
   shared capacity, expiry, wrong keys/corruption, and shutdown while CAS is held.
5. `docs/site/service-jobs.md`: supported subset, explicit lifecycle, protocol,
   operator topology, resource bounds and no callback-durability claim.

## Safety invariants

The job coordinator never re-executes running/unknown work. Missing host state is
not proof of no send. A late original may still finish once; stale observations
cannot replace newer state. Host constructor/prepared bytes, revision fences and
transaction milestones remain in the existing host journal. A status wrapper does
not supply owner authority, renew TTL, replace an intent or permit partial spends.
Completed TTL hides a public outcome only; IDs/capacity and encrypted historical
revisions are retained. No automatic deletion, compaction or key migration.

## Acceptance limits

This first slice supports existing host call/deploy effects. It does not make
legacy arbitrary proof/deploy callbacks restartable, add an automatic worker
scanner, enable the new route by default, prove a distributed wallet lock or
qualify native proofs/images/providers. Those remain explicit #233/#234/#231
follow-ups. Broad issues stay open. Validation receipts will record exact source
and tests; existence of the API or an unavailable input never becomes a pass.
