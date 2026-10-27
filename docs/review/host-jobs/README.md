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

## Reference-service/consumer continuation — #233, 2026/10/27

Derived decisions: ADR0013; baseline signed source655b1cb. Review in this order:

1. `apps/passport-service/src/host-config.ts`: opt-in settings, owned independent
   key/token files, disjoint journal roots, same executor and budget wrapper,
   shared wallet queue, active HTTP/job drain before key close.
2. `packages/service/src/host-jobs.ts`, `host-job-route.ts`: additive public identity
   hash and optional expected identity guard before any start/reconcile scheduling.
3. `packages/adapter-service/src/host-jobs.ts`: fixed scalar canonical WebCrypto
   hashes, wire guards, one accept/start, read-only polls, explicit same-ID resume,
   no missing-job replacement or legacy fallback, bounded request/body/delay and
   strict result kind/digest validation. Tokens are for trusted operator hosts.
4. `chain.ts`, `v1-chain.ts`, `queue.ts`: legacy/v1 balance/submit join the shared
   sponsor queue; drain does not reserve capacity or fail because that queue is full.
   Individual calls are serialised, not a whole balance-then-submit session.
5. Reference `shutdown.ts`/`main.ts`: idempotent SIGINT/SIGTERM, finish HTTP and
   async jobs/queued wallet work, 30-second failed-exit deadline preserving original
   uncertainty. No journal deletion or no-send claim on timeout.
6. `remote-host-jobs.test.mjs`, `host-jobs-config.test.ts`, `host-jobs-e2e.test.ts`,
   `shutdown.test.ts`: real transport, policy sharing, withheld proofs, malicious
   receipts, lost POSTs, cancellation, held body/fetch, caller mutation, full queue
   and graceful/forced shutdown. Eight both-arm call/deploy process-kill boundaries
   plus a forced deadline restart. Fake chain drivers are explicit throughout.
7. `scripts/packed-host-jobs-smoke.mjs` and the existing release-tarball consumer:
   imports/types/browser bundle plus actual loopback calls/deployments from the
   installed package graph, using encrypted journals and synthetic receipts.

Known limits remain: callback jobs volatile; no automatic worker scanner,
distributed wallet lock/persistent spending ceiling, terminal no-send repair,
immutable-history compaction, native proof/image/provider or complete #233/Lace
acceptance. Asynchronous reconcile may report an older unknown snapshot while its
approved work runs; GET can collect its later result without another POST. Client
and service versions must both implement identitySha256. Published RC5 unchanged.
